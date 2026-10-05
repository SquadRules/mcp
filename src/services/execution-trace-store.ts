import crypto from 'node:crypto';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ExecutionTrace, RewardRecord } from '../types/memory.js';
import { getQdrantUrl, isQdrantConfigured, QDRANT_API_KEY, getQdrantCollection } from '../config.js';
import { QdrantConnection } from './qdrant/connection.js';
import { logger } from '../utils/structured-logger.js';

import type { StoredExecutionTrace, TrainingPair } from './vector-store/types.js';
import type { IExecutionTraceStore } from './vector-store/IExecutionTraceStore.js';
import { LanceExecutionTraceStore } from './vector-store/lancedb/LanceExecutionTraceStore.js';

export type { StoredExecutionTrace, TrainingPair };

const TRACES_COLLECTION_SUFFIX = '_traces';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getTracesCollectionName(): string {
  return `${getQdrantCollection()}${TRACES_COLLECTION_SUFFIX}`;
}

function toPointId(executionId: string): string {
  if (UUID_REGEX.test(executionId)) return executionId;
  return crypto.createHash('md5').update(executionId).digest('hex')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

function adapterIdFromUri(adapterUri: string): string {
  return adapterUri.split('/').pop() ?? adapterUri;
}

export class ExecutionTraceStore {
  private conn: QdrantConnection;
  private readonly collectionName: string;
  private initPromise: Promise<void> | null = null;
  private readonly mutationChains = new Map<string, Promise<void>>();

  constructor(
    qdrantUrl: string = getQdrantUrl(),
    apiKey: string = QDRANT_API_KEY,
    collectionName?: string
  ) {
    this.collectionName = collectionName ?? getTracesCollectionName();
    this.conn = new QdrantConnection(qdrantUrl, apiKey, this.collectionName);
  }

  private get client(): QdrantClient {
    return this.conn.client;
  }

  private async ensureCollection(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.conn.executeWithReconnect(async () => {
        const collections = await this.client.getCollections();
        const exists = collections.collections.some((c: any) => c.name === this.collectionName);
        if (!exists) {
          logger.info(`[ExecutionTraceStore] Creating collection ${this.collectionName}`);
          await this.client.createCollection(this.collectionName, {
            vectors: {},
            on_disk_payload: true
          });
          await this.client.createPayloadIndex(this.collectionName, {
            field_name: 'adapter_id',
            field_schema: 'keyword'
          });
          await this.client.createPayloadIndex(this.collectionName, {
            field_name: 'updated_at',
            field_schema: 'keyword'
          });
          logger.info(`[ExecutionTraceStore] Collection ${this.collectionName} ready`);
        }
      });
    }
    await this.initPromise;
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

  private async withExecutionMutation<T>(executionId: string, task: () => Promise<T>): Promise<T> {
    return this.withMutationLock(`execution:${executionId}`, task);
  }

  private async upsertExecution(data: StoredExecutionTrace): Promise<void> {
    await this.conn.executeWithReconnect(async () => {
      await this.client.upsert(this.collectionName, {
        points: [{
          id: toPointId(data.execution_id),
          vector: {},
          payload: {
            execution_id: data.execution_id,
            adapter_id: data.adapter_id,
            adapter_uri: data.adapter_uri,
            ...(data.activation_query ? { activation_query: data.activation_query } : {}),
            ...(data.reward ? { reward: data.reward } : {}),
            traces: data.traces,
            updated_at: new Date().toISOString()
          }
        }]
      });
    });
  }

  async startExecution(params: {
    executionId: string;
    adapterId: string;
    adapterUri: string;
    activationQuery?: string;
  }): Promise<void> {
    await this.ensureCollection();
    const { executionId, adapterId, adapterUri, activationQuery } = params;
    await this.withExecutionMutation(executionId, async () => {
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
      await this.upsertExecution(stored);
    });
  }

  async appendTrace(trace: ExecutionTrace): Promise<void> {
    await this.ensureCollection();
    const adapterId = adapterIdFromUri(trace.adapter_uri);
    await this.withExecutionMutation(trace.execution_id, async () => {
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
      const tracesByKey = new Map(
        stored.traces.map((t) => [`${t.layer_index}:${t.layer_uri}`, t])
      );
      tracesByKey.set(key, trace);
      await this.upsertExecution({
        ...stored,
        traces: Array.from(tracesByKey.values()).sort((a, b) => a.layer_index - b.layer_index)
      });
    });
  }

  async setReward(executionId: string, reward: RewardRecord): Promise<void> {
    await this.ensureCollection();
    await this.withExecutionMutation(executionId, async () => {
      const existing = await this.getExecution(executionId);
      if (!existing) {
        logger.warn(`[ExecutionTraceStore] Skipping reward for missing execution ${executionId}`);
        return;
      }
      await this.upsertExecution({ ...existing, reward });
    });
  }

  async getExecution(executionId: string): Promise<StoredExecutionTrace | null> {
    await this.ensureCollection();
    return this.conn.executeWithReconnect(async () => {
      try {
        const points = await this.client.retrieve(this.collectionName, {
          ids: [toPointId(executionId)],
          with_payload: true,
          with_vector: false
        });
        if (!points || points.length === 0) return null;
        const payload = points[0]!.payload as Record<string, any>;
        if (!payload) return null;
        const traces = (payload['traces'] as ExecutionTrace[] ?? [])
          .sort((a, b) => a.layer_index - b.layer_index);
        return {
          execution_id: payload['execution_id'] as string,
          adapter_id: payload['adapter_id'] as string,
          adapter_uri: payload['adapter_uri'] as string,
          ...(payload['activation_query'] ? { activation_query: payload['activation_query'] as string } : {}),
          ...(payload['reward'] ? { reward: payload['reward'] as RewardRecord } : {}),
          traces
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes('Not found')) return null;
        throw error;
      }
    });
  }

  async listAdapterExecutions(adapterId: string): Promise<string[]> {
    await this.ensureCollection();
    return this.conn.executeWithReconnect(async () => {
      const executionIds: string[] = [];
      let offset: any = undefined;
      do {
        const page = await this.client.scroll(this.collectionName, {
          filter: { must: [{ key: 'adapter_id', match: { value: adapterId } }] },
          limit: 100,
          offset,
          with_payload: { include: ['execution_id'] },
          with_vector: false
        } as any);
        for (const point of page.points) {
          const eid = (point.payload as any)?.execution_id;
          if (eid) executionIds.push(eid as string);
        }
        offset = page.next_page_offset;
      } while (offset);
      return executionIds;
    });
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
    await this.ensureCollection();
    await this.withExecutionMutation(executionId, async () => {
      await this.conn.executeWithReconnect(async () => {
        await this.client.delete(this.collectionName, { points: [toPointId(executionId)] });
      });
    });
  }
}

// Backend-selected singleton: empty or unset `QDRANT_URL` selects the embedded
// LanceDB trace store, so the four always-loaded tool call sites
// (`reward`, `forward`, `forward-trace`, `export`) transparently hit the active
// engine without importing a Qdrant client at module load. `new ExecutionTraceStore()`
// is only evaluated on the Qdrant path, so `getQdrantUrl()` never throws on Lance.
export const executionTraceStore: IExecutionTraceStore = isQdrantConfigured
  ? new ExecutionTraceStore()
  : new LanceExecutionTraceStore();
