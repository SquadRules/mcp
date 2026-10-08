/**
 * Embedded LanceDB record store.
 *
 * Satisfies the `IVectorRecordStore` port and the read/admin surface the tools
 * reach through `qdrantService`, so a single instance can back both injected
 * slots on the embedded path (selected by `isQdrantConfigured`). Reads,
 * read-modify-write mutations, semantic search (JS cosine) and the markdown-to-
 * points writers (`storeAdapter` / `storeArtifact`) are all implemented, reusing
 * the backend-neutral parse/build helpers so the store matches the Qdrant path's
 * contract. Search-ranking and train parity are validated against the Qdrant
 * integration suite when the store is wired and exercised end-to-end.
 */
import type { Memory } from '../../../types/memory.js';
import { getQdrantCollection } from '../../../config.js';
import { logger } from '../../../utils/structured-logger.js';
import { openLanceConnection, type LanceConnection } from '../lancedb-connection.js';
import type { IVectorRecordStore } from '../IVectorRecordStore.js';
import type {
  ArtifactResolveOutcome,
  GetMemoryOptions,
  LayerRecord,
  MemorySearchResult,
  SlugResolveOutcome,
  StoreAdapterOptions
} from '../types.js';
import type { StoreArtifactOptions } from '../../memory/store-adapter.js';
import { LanceRecordEngine } from './lance-records-engine.js';
import { LanceRecordReader } from './lance-records-reads.js';
import { LanceRecordMutator } from './lance-records-mutations.js';
import { LanceRecordSearch } from './lance-records-search.js';
import { LanceRecordWriter } from './lance-records-writes.js';

const COLLECTION_LABEL = getQdrantCollection('squadrules');

export class LanceVectorRecordStore implements IVectorRecordStore {
  private readonly engine = new LanceRecordEngine();
  private readonly reader = new LanceRecordReader(this.engine);
  private readonly mutator = new LanceRecordMutator(this.engine);
  private readonly search = new LanceRecordSearch(this.engine);
  private readonly writer = new LanceRecordWriter(this.engine, this.search);
  private connectionPromise: Promise<LanceConnection> | null = null;

  private connection(): Promise<LanceConnection> {
    if (!this.connectionPromise) this.connectionPromise = openLanceConnection();
    return this.connectionPromise;
  }

  // --- lifecycle ---
  async init(): Promise<void> {
    await this.connection();
    logger.debug('LanceDB record store ready');
  }

  async checkHealth(_timeoutMs?: number): Promise<boolean> {
    try {
      await this.connection();
      return true;
    } catch (error) {
      logger.warn(`[LanceVectorRecordStore] health check failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  // --- reads (delegate) ---
  async getMemory(memoryUuid: string, _options?: GetMemoryOptions): Promise<Memory | null> {
    return this.reader.getMemory(memoryUuid);
  }

  async getAdapterLayers(adapterId: string, extraSpaceIds?: string[]): Promise<LayerRecord[]> {
    return this.reader.getAdapterLayers(adapterId, extraSpaceIds) as Promise<LayerRecord[]>;
  }

  async findFirstStepMemoryUuidBySlug(slug: string): Promise<SlugResolveOutcome> {
    return this.reader.findFirstStepMemoryUuidBySlug(slug);
  }

  async findArtifactMemoryUuidBySlug(slug: string): Promise<ArtifactResolveOutcome> {
    return this.reader.findArtifactMemoryUuidBySlug(slug);
  }

  async scrollSpace(spaceId: string, options?: { paginate?: boolean; limit?: number }): Promise<LayerRecord[]> {
    return this.reader.scrollSpace(spaceId, options);
  }

  async listAdapterArtifacts(adapterId: string): Promise<LayerRecord[]> {
    return this.reader.listAdapterArtifacts(adapterId);
  }

  async findProtocolFooterLayers(refineSlug: string, createSlug: string): Promise<LayerRecord[]> {
    return this.reader.findProtocolFooterLayers(refineSlug, createSlug);
  }

  async getStoredAdapterVersion(slug: string): Promise<string | undefined> {
    return this.reader.getStoredAdapterVersion(slug);
  }

  async updateMemory(memoryUuid: string, patch: Record<string, unknown>): Promise<void> {
    return this.mutator.updateMemory(memoryUuid, patch);
  }

  async deleteMemory(memoryUuid: string): Promise<void> {
    return this.mutator.deleteMemory(memoryUuid);
  }

  async setPayloadOnLayers(layerIds: string[], patch: Record<string, unknown>): Promise<void> {
    return this.mutator.setPayloadOnLayers(layerIds, patch);
  }

  async deleteAppSpaceBySlug(slug: string): Promise<void> {
    return this.mutator.deleteAppSpaceBySlug(slug);
  }

  async deleteAppSpaceByAdapterId(adapterId: string): Promise<void> {
    return this.mutator.deleteAppSpaceByAdapterId(adapterId);
  }

  // --- qdrantService read surface (delegate) ---
  async retrieveById(uuid: string): Promise<{ uuid: string; payload: any } | null> {
    return this.reader.retrieveById(uuid);
  }

  async getMemoryByUUID(uuid: string): Promise<any | null> {
    return this.reader.getMemoryByUUID(uuid);
  }

  async findProtocolSteps(protocolId: string): Promise<Array<{ uuid: string; protocol: unknown; payload: Record<string, unknown> }>> {
    return this.reader.findProtocolSteps(protocolId);
  }

  async findProtocolStep(domain: string, type: string, task: string, step: number): Promise<{ uuid: string; payload: Record<string, unknown> } | null> {
    return this.reader.findProtocolStep(domain, type, task, step);
  }

  async updateQualityMetrics(id: string, metrics: any): Promise<void> {
    return this.mutator.updateQualityMetrics(id, metrics);
  }

  async updateQualityMetadata(id: string, qualityMetadata: { step_quality_score: number; step_quality: 'excellent' | 'high' | 'standard' | 'basic' }): Promise<void> {
    return this.mutator.updateQualityMetadata(id, qualityMetadata);
  }

  async propagateRewardToAdapterHead(stepPointId: string, metricsUpdate: Record<string, unknown>): Promise<string | null> {
    return this.mutator.propagateRewardToAdapterHead(stepPointId, metricsUpdate);
  }

  // --- admin (embedded store has no aliases / server collections) ---
  async initialize(): Promise<void> {
    await this.init();
  }

  async createOrUpdateAlias(): Promise<void> {
    logger.debug('[LanceVectorRecordStore] createOrUpdateAlias is a no-op on the embedded store');
  }

  async getCollections(): Promise<Array<{ name?: string }>> {
    return [];
  }

  async dropCollection(): Promise<void> {
    logger.debug('[LanceVectorRecordStore] dropCollection is a no-op on the embedded store');
  }

  get collectionName(): string {
    return COLLECTION_LABEL;
  }

  get qdrantUrl(): string {
    return 'embedded:lancedb';
  }

  get apiKey(): string | undefined {
    return undefined;
  }

  // --- search (JS cosine) ---
  async searchMemories(query: string, limit: number, _collapse?: boolean): Promise<MemorySearchResult> {
    return this.search.searchMemories(query, limit);
  }

  async searchAdapterTitlesBySimilarity(query: string, limit: number): Promise<MemorySearchResult> {
    return this.search.searchAdapterTitlesBySimilarity(query, limit);
  }

  // --- writers (delegate) ---
  async storeAdapter(docs: string[], llmModelId: string, options?: StoreAdapterOptions): Promise<Memory[]> {
    return this.writer.storeAdapter(docs, llmModelId, options as import('../../memory/store-adapter.js').StoreAdapterOptions);
  }

  async storeArtifact(content: string, options: StoreArtifactOptions): Promise<Memory[]> {
    return this.writer.storeArtifact(content, options);
  }
}
