/**
 * LanceDB implementation of the execution-trace port (`IExecutionTraceStore`).
 *
 * Traces carry no vectors, so this is the simplest backend slice: one row per
 * execution, keyed by a stable id, with the whole `StoredExecutionTrace` kept as
 * a JSON string. Reads that run before any write treat the absent table as empty
 * rather than creating it, so a cold start never touches the disk for a read.
 *
 * The in-process per-execution mutation lock mirrors `ExecutionTraceStore` so
 * concurrent forwards in this process serialize exactly as the Qdrant path does;
 * cross-process durability comes from the SDK's MVCC plus `withCommitRetry`.
 */
import crypto from 'node:crypto';
import type { ExecutionTrace, RewardRecord } from '../../../types/memory.js';
import { logger } from '../../../utils/structured-logger.js';
import type { IExecutionTraceStore } from '../IExecutionTraceStore.js';
import type { StoredExecutionTrace, TrainingPair } from '../types.js';
import { openLanceConnection, type LanceConnection, type LanceTable } from '../lancedb-connection.js';
import { withCommitRetry } from '../commit-retry.js';

const TRACE_TABLE = 'execution_traces';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable primary key for an execution: reuse UUIDs, hash anything else to a UUID shape. */
function toRowId(executionId: string): string {
  if (UUID_REGEX.test(executionId)) return executionId;
  return crypto
    .createHash('md5')
    .update(executionId)
    .digest('hex')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

/** Escape a string for a LanceQL equality literal. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

interface TraceRow {
  id: string;
  execution_id: string;
  adapter_id: string;
  data: string;
  [key: string]: unknown;
}

function adapterIdFromUri(adapterUri: string): string {
  return adapterUri.split('/').pop() ?? adapterUri;
}

export class LanceExecutionTraceStore implements IExecutionTraceStore {
  private connectionPromise: Promise<LanceConnection> | null = null;
  private readonly mutationChains = new Map<string, Promise<void>>();

  private getConnection(): Promise<LanceConnection> {
    if (!this.connectionPromise) {
      this.connectionPromise = openLanceConnection();
    }
    return this.connectionPromise;
  }

  /** Open the trace table, or return null when nothing has been written yet. */
  private async openTableIfPresent(): Promise<LanceTable | null> {
    const connection = await this.getConnection();
    const names = await connection.tableNames();
    if (!names.includes(TRACE_TABLE)) return null;
    return connection.openTable(TRACE_TABLE);
  }

  /** Open-or-create the trace table from a first row (schema inferred from data). */
  private async ensureTableForWrite(firstRow: TraceRow): Promise<LanceTable> {
    const connection = await this.getConnection();
    const names = await connection.tableNames();
    if (names.includes(TRACE_TABLE)) {
      return connection.openTable(TRACE_TABLE);
    }
    return connection.createTable(TRACE_TABLE, [firstRow], { mode: 'create' });
  }

  private toRow(data: StoredExecutionTrace): TraceRow {
    return {
      id: toRowId(data.execution_id),
      execution_id: data.execution_id,
      adapter_id: data.adapter_id,
      data: JSON.stringify(data)
    };
  }

  private async persist(data: StoredExecutionTrace): Promise<void> {
    const row = this.toRow(data);
    const table = await this.ensureTableForWrite(row);
    await withCommitRetry(
      () =>
        table
          .mergeInsert('id')
          .whenMatchedUpdateAll()
          .whenNotMatchedInsertAll()
          .execute([row]),
      `trace:${data.execution_id}`
    );
  }

  private async withMutationLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.mutationChains.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => gate);
    this.mutationChains.set(key, next);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release?.();
      if (this.mutationChains.get(key) === next) {
        this.mutationChains.delete(key);
      }
    }
  }

  async startExecution(params: {
    executionId: string;
    adapterId: string;
    adapterUri: string;
    activationQuery?: string;
  }): Promise<void> {
    const { executionId, adapterId, adapterUri, activationQuery } = params;
    await this.withMutationLock(`execution:${executionId}`, async () => {
      const existing = await this.getExecution(executionId);
      const resolvedActivationQuery = activationQuery ?? existing?.activation_query;
      if (existing && existing.adapter_id !== adapterId) {
        throw new Error(
          `Execution ${executionId} already belongs to adapter ${existing.adapter_id}; refusing to reassign it to ${adapterId}`
        );
      }
      const stored: StoredExecutionTrace = {
        execution_id: executionId,
        adapter_id: adapterId,
        adapter_uri: adapterUri,
        ...(resolvedActivationQuery ? { activation_query: resolvedActivationQuery } : {}),
        ...(existing?.reward ? { reward: existing.reward } : {}),
        traces: existing?.traces ?? []
      };
      await this.persist(stored);
    });
  }

  async appendTrace(trace: ExecutionTrace): Promise<void> {
    const adapterId = adapterIdFromUri(trace.adapter_uri);
    await this.withMutationLock(`execution:${trace.execution_id}`, async () => {
      const existing = await this.getExecution(trace.execution_id);
      if (existing && existing.adapter_uri !== trace.adapter_uri) {
        throw new Error(
          `Execution ${trace.execution_id} already points at ${existing.adapter_uri}; refusing to append a trace for ${trace.adapter_uri}`
        );
      }
      const stored: StoredExecutionTrace = existing ?? {
        execution_id: trace.execution_id,
        adapter_id: adapterId,
        adapter_uri: trace.adapter_uri,
        ...(trace.activation_query ? { activation_query: trace.activation_query } : {}),
        traces: []
      };
      const key = `${trace.layer_index}:${trace.layer_uri}`;
      const tracesByKey = new Map(stored.traces.map((t) => [`${t.layer_index}:${t.layer_uri}`, t]));
      tracesByKey.set(key, trace);
      await this.persist({
        ...stored,
        traces: Array.from(tracesByKey.values()).sort((a, b) => a.layer_index - b.layer_index)
      });
    });
  }

  async setReward(executionId: string, reward: RewardRecord): Promise<void> {
    await this.withMutationLock(`execution:${executionId}`, async () => {
      const existing = await this.getExecution(executionId);
      if (!existing) {
        logger.warn(`[LanceExecutionTraceStore] Skipping reward for missing execution ${executionId}`);
        return;
      }
      await this.persist({ ...existing, reward });
    });
  }

  async getExecution(executionId: string): Promise<StoredExecutionTrace | null> {
    const table = await this.openTableIfPresent();
    if (!table) return null;
    const rows = (await table
      .query()
      .where(`execution_id = ${sqlLiteral(executionId)}`)
      .limit(1)
      .toArray()) as unknown as TraceRow[];
    const row = rows[0];
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.data) as StoredExecutionTrace;
      parsed.traces = (parsed.traces ?? []).sort((a, b) => a.layer_index - b.layer_index);
      return parsed;
    } catch {
      return null;
    }
  }

  async listAdapterExecutions(adapterId: string): Promise<string[]> {
    const table = await this.openTableIfPresent();
    if (!table) return [];
    const rows = (await table
      .query()
      .where(`adapter_id = ${sqlLiteral(adapterId)}`)
      .select(['execution_id'])
      .toArray()) as unknown as Array<{ execution_id: string }>;
    return rows.map((row) => row.execution_id).filter(Boolean);
  }

  async buildTrainingPairsForAdapter(adapterId: string, includeReward: boolean = true): Promise<TrainingPair[]> {
    const executionIds = await this.listAdapterExecutions(adapterId);
    const pairs: TrainingPair[] = [];
    for (const executionId of executionIds) {
      const execution = await this.getExecution(executionId);
      if (!execution) continue;
      for (const trace of execution.traces) {
        pairs.push({
          id: `${execution.execution_id}:${trace.layer_index}`,
          execution_id: execution.execution_id,
          adapter_uri: execution.adapter_uri,
          layer_uri: trace.layer_uri,
          layer_index: trace.layer_index,
          timestamp: trace.created_at,
          instruction: {
            tensor_in: trace.tensor_in,
            ...(execution.activation_query ? { activation_query: execution.activation_query } : {}),
            layer_instructions: trace.layer_instructions ?? ''
          },
          response: {
            ...(trace.tensor_out ? { tensor_out: trace.tensor_out } : {}),
            ...(trace.trace ? { trace: trace.trace } : {}),
            ...(trace.raw_solution !== undefined ? { raw_solution: trace.raw_solution } : {})
          },
          ...(includeReward && execution.reward ? { reward: execution.reward } : {})
        });
      }
    }
    return pairs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async deleteExecution(executionId: string): Promise<void> {
    await this.withMutationLock(`execution:${executionId}`, async () => {
      const table = await this.openTableIfPresent();
      if (!table) return;
      await withCommitRetry(
        () => table.delete(`id = ${sqlLiteral(toRowId(executionId))}`),
        `trace-delete:${executionId}`
      );
    });
  }
}
