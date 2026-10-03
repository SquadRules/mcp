// squadrules-compat-surface: falls back to the existing on-disk config-dir path segment "kairos"
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Memory } from '../../types/memory.js';
import { logger } from '../../utils/structured-logger.js';
import { CodeBlockProcessor } from '../code-block-processor.js';
import { MemoryQdrantStoreMethods } from './store-methods.js';
import { resolveCollectionAlias } from '../../utils/qdrant-utils.js';
import { getQdrantUrl, getQdrantCollection, QDRANT_API_KEY } from '../../config.js';
import { initializeQdrantStore } from './store-init.js';
import { MemoryQdrantStoreAdapter } from './store-adapter.js';
import type { StoreArtifactOptions } from './store-adapter.js';

const DEFAULT_QDRANT_URL = getQdrantUrl();
const DEFAULT_COLLECTION = getQdrantCollection('kairos');

export interface MemoryQdrantStoreOptions {
  url?: string;
  collection?: string;
}

export class MemoryQdrantStore {
  private client: QdrantClient;
  private collection: string;
  private originalCollectionAlias?: string;
  private url: string;
  private codeBlockProcessor: CodeBlockProcessor;
  private methods: MemoryQdrantStoreMethods;
  private adapterStore: MemoryQdrantStoreAdapter;

  constructor(options: MemoryQdrantStoreOptions = {}) {
    const url = options.url || DEFAULT_QDRANT_URL;
    const apiKey = QDRANT_API_KEY;

    logger.info(
      `[MemoryQdrantStore] Initializing Qdrant client with QDRANT_URL="${url}", ` +
      `collection="${options.collection || DEFAULT_COLLECTION}", apiKeyConfigured=${!!apiKey}`
    );

    const clientOptions: Record<string, unknown> = { url };
    if (apiKey) {
      clientOptions['apiKey'] = apiKey;
    }

    this.client = new QdrantClient(clientOptions);
    // Preserve original alias requested so we can log / manage it later
    this.originalCollectionAlias = options.collection || DEFAULT_COLLECTION;
    // Resolve 'current' alias to real collection name (env-driven) so callers may pass 'current'
    this.collection = resolveCollectionAlias(options.collection || DEFAULT_COLLECTION);
    logger.info(`[MemoryQdrantStore] Resolved collection alias: requested="${this.originalCollectionAlias}" resolved="${this.collection}"`);
    this.url = url;
    this.codeBlockProcessor = new CodeBlockProcessor();
    this.methods = new MemoryQdrantStoreMethods(this.client, this.collection, this.url, this.codeBlockProcessor);
    this.adapterStore = new MemoryQdrantStoreAdapter(this.client, this.collection, this.codeBlockProcessor, this.methods);
  }

  async init(): Promise<void> {
    return initializeQdrantStore(this.client, this.collection, this.url);
  }

  async checkHealth(timeoutMs: number = 5000): Promise<boolean> {
    let timeoutId: NodeJS.Timeout | undefined;
    let raceCompleted = false;
    let healthCheckPromise: Promise<any> | undefined;
    
    try {
      // Wrap health check to handle cancellation cleanly
      healthCheckPromise = (async () => {
        try {
          const result = await this.client.getCollections();
          if (!raceCompleted && timeoutId) {
            clearTimeout(timeoutId);
          }
          return result;
        } catch (error) {
          if (!raceCompleted && timeoutId) {
            clearTimeout(timeoutId);
          }
          // Only throw if race hasn't completed (we won)
          if (!raceCompleted) {
            throw error;
          }
          // Otherwise ignore - timeout already won, return undefined
          return undefined;
        }
      })();
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (!raceCompleted) {
            raceCompleted = true;
            reject(new Error(`Health check timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      });
      
      await Promise.race([healthCheckPromise, timeoutPromise]);
      raceCompleted = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return true;
    } catch (error) {
      raceCompleted = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      // Suppress any unhandled rejections from the losing promise
      // by ensuring healthCheckPromise is handled
      if (healthCheckPromise) {
        healthCheckPromise.catch(() => {
          // Ignore - race already completed
        });
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        `[MemoryQdrantStore] Qdrant health check failed at "${this.url}" (collection="${this.collection}"): ${errorMessage}`
      );
      return false;
    }
  }

  async storeAdapter(
    docs: string[],
    llmModelId: string,
    options: { forceUpdate?: boolean; protocolVersion?: string; forkNewAdapter?: boolean } = {}
  ): Promise<Memory[]> {
    return this.adapterStore.storeAdapter(docs, llmModelId, options);
  }

  async storeArtifact(content: string, options: StoreArtifactOptions): Promise<Memory[]> {
    return this.adapterStore.storeArtifact(content, options);
  }

  async getMemory(memory_uuid: string, options?: { fresh?: boolean }): Promise<Memory | null> {
    if (options?.fresh) {
      return this.methods.getMemoryFresh(memory_uuid);
    }
    return this.methods.getMemory(memory_uuid);
  }

  async searchMemories(query: string, limit: number, collapse: boolean = true): Promise<{ memories: Memory[], scores: number[] }> {
    return this.methods.searchMemories(query, limit, collapse);
  }

  /**
   * Get Qdrant client and collection for direct access (used by boot injection)
   */
  getQdrantAccess(): { client: QdrantClient; collection: string } {
    return { client: this.client, collection: this.collection };
  }
}