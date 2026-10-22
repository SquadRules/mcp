import { keyValueStore } from './key-value-store-factory.js';
import { logger } from '../utils/structured-logger.js';
import type { InferenceContractType } from '../types/memory.js';

export type ProofOfWorkStatus = 'success' | 'failed';
export type ProofOfWorkType = InferenceContractType;

export interface ProofOfWorkResultRecord {
  result_id: string;
  type?: ProofOfWorkType;  // Optional for older persisted records
  status: ProofOfWorkStatus;
  executed_at: string;
  // Older shell fields retained for persisted records
  exit_code?: number;
  duration_seconds?: number;
  stdout?: string;
  stderr?: string;
  // Type-specific result fields
  shell?: {
    exit_code: number;
    stdout?: string;
    stderr?: string;
    duration_seconds?: number;
  };
  forward?: {
    target: string;
    success: boolean;
  };
  user_input?: {
    confirmation: string;
    timestamp?: string;
  };
  comment?: {
    text: string;
  };
}

/** TTL for nonce (1 hour). */
const NONCE_TTL_SEC = 3600;
/** TTL for proof hash (7 days, same as result). */
const HASH_TTL_SEC = 604800;
/** TTL for retry counter (60s). Bounds retry window and cleanup; refreshed on each increment. */
const RETRY_TTL_SEC = 60;
/** Max retries before escalating to must_obey: false. */
export const MAX_RETRIES = 3;

export class ProofOfWorkStore {
  private readonly prefix = 'pow:result:';
  private readonly noncePrefix = 'pow:nonce:';
  private readonly hashPrefix = 'pow:hash:';
  private readonly retryPrefix = 'pow:retry:';

  private buildKey(uuid: string): string {
    return `${this.prefix}${uuid}`;
  }

  private nonceKey(uuid: string): string {
    return `${this.noncePrefix}${uuid}`;
  }

  private hashKey(uuid: string): string {
    return `${this.hashPrefix}${uuid}`;
  }

  async saveResult(memoryUuid: string, record: ProofOfWorkResultRecord): Promise<void> {
    if (!memoryUuid) return;
    try {
      // 7 days TTL (604800 seconds)
      await keyValueStore.setJson(this.buildKey(memoryUuid), record, 604800);
    } catch (error) {
      logger.error(`[ProofOfWorkStore] Failed to save result for ${memoryUuid}`, error);
    }
  }

  async getResult(memoryUuid: string): Promise<ProofOfWorkResultRecord | null> {
    if (!memoryUuid) return null;
    try {
      return await keyValueStore.getJson<ProofOfWorkResultRecord>(this.buildKey(memoryUuid));
    } catch (error) {
      logger.error(`[ProofOfWorkStore] Failed to load result for ${memoryUuid}`, error);
      return null;
    }
  }

  async setNonce(memoryUuid: string, nonce: string): Promise<void> {
    if (!memoryUuid || !nonce) return;
    try {
      await keyValueStore.set(this.nonceKey(memoryUuid), nonce, NONCE_TTL_SEC);
    } catch (error) {
      logger.error(`[ProofOfWorkStore] Failed to set nonce for ${memoryUuid}`, error);
    }
  }

  async getNonce(memoryUuid: string): Promise<string | null> {
    if (!memoryUuid) return null;
    try {
      return await keyValueStore.get(this.nonceKey(memoryUuid));
    } catch (error) {
      logger.error(`[ProofOfWorkStore] Failed to get nonce for ${memoryUuid}`, error);
      return null;
    }
  }

  async setProofHash(memoryUuid: string, hash: string): Promise<void> {
    if (!memoryUuid || !hash) return;
    try {
      await keyValueStore.set(this.hashKey(memoryUuid), hash, HASH_TTL_SEC);
    } catch (error) {
      logger.error(`[ProofOfWorkStore] Failed to set proof hash for ${memoryUuid}`, error);
    }
  }

  async getProofHash(memoryUuid: string): Promise<string | null> {
    if (!memoryUuid) return null;
    try {
      return await keyValueStore.get(this.hashKey(memoryUuid));
    } catch (error) {
      logger.error(`[ProofOfWorkStore] Failed to get proof hash for ${memoryUuid}`, error);
      return null;
    }
  }

  private retryKey(identifier: string): string {
    return `${this.retryPrefix}${identifier}`;
  }

  /**
   * Increment retry count for this challenge instance.
   * @param identifier - Step's current nonce when available, otherwise step uuid.
   */
  async incrementRetry(identifier: string): Promise<number> {
    if (!identifier) return 0;
    try {
      const count = await keyValueStore.incr(this.retryKey(identifier));
      await keyValueStore.set(this.retryKey(identifier), String(count), RETRY_TTL_SEC);
      return count;
    } catch (error) {
      logger.error(`[ProofOfWorkStore] Failed to increment retry for ${identifier}`, error);
      return 0;
    }
  }

  /**
   * Get retry count for this challenge instance.
   * @param identifier - Step's current nonce when available, otherwise step uuid.
   */
  async getRetryCount(identifier: string): Promise<number> {
    if (!identifier) return 0;
    try {
      const val = await keyValueStore.get(this.retryKey(identifier));
      return val ? parseInt(val, 10) : 0;
    } catch (error) {
      logger.error(`[ProofOfWorkStore] Failed to get retry count for ${identifier}`, error);
      return 0;
    }
  }

  /**
   * Reset retry count for this challenge instance.
   * @param identifier - Step's current nonce when available, otherwise step uuid.
   */
  async resetRetry(identifier: string): Promise<void> {
    if (!identifier) return;
    try {
      await keyValueStore.set(this.retryKey(identifier), '0', RETRY_TTL_SEC);
    } catch (error) {
      logger.error(`[ProofOfWorkStore] Failed to reset retry for ${identifier}`, error);
    }
  }
}

export const proofOfWorkStore = new ProofOfWorkStore();

