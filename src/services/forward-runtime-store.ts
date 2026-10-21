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

  async deleteExecution(executionId: string): Promise<void> {
    try {
      await keyValueStore.del(metaKey(executionId));
      await keyValueStore.del(manifestKey(executionId));
    } catch (error) {
      logger.warn(
        `[ForwardRuntimeStore] Failed to delete execution ${executionId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export const forwardRuntimeStore = new ForwardRuntimeStore();

