import type { AuthoringContext } from '../tools/authoring-context.js';
import { keyValueStore } from './key-value-store-factory.js';
import { logger } from '../utils/structured-logger.js';

const DEFAULT_EXECUTION_TTL_SEC = 7 * 24 * 60 * 60;

export interface ForwardExecutionMeta {
  execution_id: string;
  adapter_id: string;
  adapter_uri: string;
  activation_query?: string;
  authoring?: AuthoringContext;
  /** When forward started from an ambiguous slug URI, echoed on forward responses for this run. */
  slug_disambiguation_note?: string;
  merge_depth: number;
  created_at: string;
}

function metaKey(executionId: string): string {
  return `runtime:execution:${executionId}:meta`;
}

function manifestKey(executionId: string): string {
  return `runtime:execution:${executionId}:manifest`;
}

function tensorKey(executionId: string, tensorName: string): string {
  return `runtime:execution:${executionId}:tensor:${tensorName}`;
}

export class ForwardRuntimeStore {
  async startExecution(meta: ForwardExecutionMeta): Promise<void> {
    await keyValueStore.setJson(metaKey(meta.execution_id), meta, DEFAULT_EXECUTION_TTL_SEC);
  }

  async getExecution(executionId: string): Promise<ForwardExecutionMeta | null> {
    return keyValueStore.getJson<ForwardExecutionMeta>(metaKey(executionId));
  }

  /** Pin the ordered layer UUIDs for an execution. Built once on first forward. */
  async setLayerManifest(executionId: string, manifest: string[]): Promise<void> {
    if (!executionId || manifest.length === 0) return;
    await keyValueStore.setJson(manifestKey(executionId), manifest, DEFAULT_EXECUTION_TTL_SEC);
  }

  /** Retrieve the pinned layer manifest for an execution (null if not yet pinned). */
  async getLayerManifest(executionId: string): Promise<string[] | null> {
    if (!executionId) return null;
    return keyValueStore.getJson<string[]>(manifestKey(executionId));
  }

  async setTensor(executionId: string, name: string, value: unknown): Promise<void> {
    if (!executionId || !name) return;
    await keyValueStore.setJson(tensorKey(executionId, name), value, DEFAULT_EXECUTION_TTL_SEC);
  }

  async getTensor(executionId: string, name: string): Promise<unknown | null> {
    if (!executionId || !name) return null;
    return keyValueStore.getJson<unknown>(tensorKey(executionId, name));
  }

  async getTensorInputs(executionId: string, names: string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const name of names) {
      const value = await this.getTensor(executionId, name);
      if (value !== null) {
        result[name] = value;
      }
    }
    return result;
  }

  async requireTensorInputs(executionId: string, names: string[]): Promise<Record<string, unknown>> {
    const values = await this.getTensorInputs(executionId, names);
    const missing = names.filter((name) => !(name in values));
    if (missing.length > 0) {
      throw new Error(`Missing required tensor inputs: ${missing.join(', ')}`);
    }
    return values;
  }

  async deleteExecution(executionId: string, tensorNames: string[] = []): Promise<void> {
    try {
      await keyValueStore.del(metaKey(executionId));
      await keyValueStore.del(manifestKey(executionId));
      for (const name of tensorNames) {
        await keyValueStore.del(tensorKey(executionId, name));
      }
    } catch (error) {
      logger.warn(
        `[ForwardRuntimeStore] Failed to delete execution ${executionId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export const forwardRuntimeStore = new ForwardRuntimeStore();

