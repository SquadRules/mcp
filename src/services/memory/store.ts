import { QdrantClient } from '@qdrant/js-client-rest';
import type { Memory } from '../../types/memory.js';
import { logger } from '../../utils/structured-logger.js';
import { CodeBlockProcessor } from '../code-block-processor.js';
import { MemoryQdrantStoreMethods } from './store-methods.js';
import { resolveCollectionAlias } from '../../utils/qdrant-utils.js';
import { getQdrantUrl, getQdrantCollection, QDRANT_API_KEY, SQUADRULES_APP_SPACE_ID } from '../../config.js';
import { getSearchSpaceIds } from '../../utils/tenant-context.js';
import { buildSpaceFilter } from '../../utils/space-filter.js';
import { ALLOWED_ARTIFACT_MIMES } from '../../tools/artifact-mime.js';
import { initializeQdrantStore } from './store-init.js';
import { MemoryQdrantStoreAdapter } from './store-adapter.js';
import type { StoreArtifactOptions } from './store-adapter.js';
import type { LayerRecord } from '../vector-store/types.js';

// `DEFAULT_COLLECTION` is env-driven with a built-in default (never throws), so it
// is safe at import time. The Qdrant URL, by contrast, MUST NOT be resolved here:
// `getQdrantUrl()` throws when `QDRANT_URL` is unset, which would crash import on
// the embedded LanceDB path. It is resolved lazily in the constructor, which only
// runs when this Qdrant store is actually selected by the factory.
const DEFAULT_COLLECTION = getQdrantCollection('squadrules');

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
    const url = options.url || getQdrantUrl();
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

  // --- backend-owned domain reads/writes that replace raw getQdrantAccess() at call sites ---

  /**
   * Scroll every layer point in one space as neutral `LayerRecord`s.
   * `paginate` walks all pages (bulk enumeration); when false it returns a
   * single page of `limit`, matching the shallow count view used by spaces.
   */
  async scrollSpace(spaceId: string, options: { paginate?: boolean; limit?: number } = {}): Promise<LayerRecord[]> {
    const filter = buildSpaceFilter([spaceId]);
    return this.scrollAll(filter, options.paginate ?? true, options.limit);
  }

  /** Artifact layer points attached to an adapter, across the searchable spaces. */
  async listAdapterArtifacts(adapterId: string): Promise<LayerRecord[]> {
    const filter = buildSpaceFilter(getSearchSpaceIds(), {
      must: [
        { key: 'adapter.id', match: { value: adapterId } },
        { key: 'content_type', match: { any: [...ALLOWED_ARTIFACT_MIMES] } }
      ]
    });
    return this.scrollAll(filter, true);
  }

  /** First-layer footer points for the refining/creation protocol slugs. */
  async findProtocolFooterLayers(refineSlug: string, createSlug: string): Promise<LayerRecord[]> {
    const filter = {
      must: [
        { key: 'slug', match: { any: [refineSlug, createSlug] } },
        { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } },
        { key: 'adapter.layer_index', match: { value: 1 } }
      ]
    };
    return this.scrollAll(filter, false, 10);
  }

  /** Protocol version already stored for an app-space adapter slug, or undefined. */
  async getStoredAdapterVersion(slug: string): Promise<string | undefined> {
    const filter = {
      must: [
        { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } },
        { key: 'slug', match: { value: slug } }
      ]
    };
    const page = await this.client.scroll(this.collection, {
      filter,
      limit: 1,
      with_payload: true,
      with_vector: false
    } as Parameters<QdrantClient['scroll']>[1]);
    const payload = page?.points?.[0]?.payload as Record<string, unknown> | undefined;
    const version = payload?.['protocol_version'];
    return typeof version === 'string' ? version : undefined;
  }

  /** Attach a payload patch (e.g. content_sha256) to a set of layer points. */
  async setPayloadOnLayers(layerIds: string[], patch: Record<string, unknown>): Promise<void> {
    await this.client.setPayload(this.collection, {
      payload: patch,
      points: layerIds
    } as Parameters<QdrantClient['setPayload']>[1]);
  }

  /** Delete app-space points matching a slug. */
  async deleteAppSpaceBySlug(slug: string): Promise<void> {
    await this.client.delete(this.collection, {
      filter: {
        must: [
          { key: 'slug', match: { value: slug } },
          { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } }
        ]
      }
    });
  }

  /** Delete app-space points matching an adapter id. */
  async deleteAppSpaceByAdapterId(adapterId: string): Promise<void> {
    await this.client.delete(this.collection, {
      filter: {
        must: [
          { key: 'adapter.id', match: { value: adapterId } },
          { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } }
        ]
      }
    });
  }

  private async scrollAll(
    filter: unknown,
    paginate: boolean,
    limit?: number
  ): Promise<LayerRecord[]> {
    const pageSize = limit ?? 256;
    const records: LayerRecord[] = [];
    let offset: string | number | undefined;
    do {
      const page = await this.client.scroll(this.collection, {
        filter,
        limit: pageSize,
        ...(offset !== undefined ? { offset } : {}),
        with_payload: true,
        with_vector: false
      } as Parameters<QdrantClient['scroll']>[1]);
      for (const point of page?.points ?? []) {
        records.push({ uuid: String(point.id), payload: (point.payload ?? {}) as unknown as Memory });
      }
      const next = page?.next_page_offset;
      offset = typeof next === 'string' || typeof next === 'number' ? next : undefined;
      if (!paginate) break;
    } while (offset !== undefined);
    return records;
  }

  /**
   * Get Qdrant client and collection for direct access (used by boot injection)
   */
  getQdrantAccess(): { client: QdrantClient; collection: string } {
    return { client: this.client, collection: this.collection };
  }
}