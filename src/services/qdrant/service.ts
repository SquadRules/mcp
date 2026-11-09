import { QdrantConnection } from './connection.js';
import * as init from './initialization.js';
import * as store from './memory-store.js';
import * as retrieval from './memory-retrieval.js';
import { updateMemory, updateMemoryByUUID, deleteMemory } from './memory-updates.js';
import * as quality from './quality.js';
import * as resources from './resources.js';
import * as search from './search.js';
import * as protocol from './protocol.js';
import * as listing from './listing.js';
import * as rewardPropagation from './reward-propagation.js';
import { UpsertResourceItem, UpsertResourceResult } from './types.js';
import { logger } from '../../utils/structured-logger.js';
import { getQdrantUrl, QDRANT_API_KEY, getQdrantCollection, isQdrantConfigured } from '../../config.js';
import { getEmbeddedRecordStore } from '../vector-store/embedded-store-singleton.js';
import { createEmbeddedRuntime } from '../vector-store/embedded-runtime.js';

export class QdrantService {
  private conn: QdrantConnection;

  constructor(
    qdrantUrl: string = getQdrantUrl(),
    apiKey: string = QDRANT_API_KEY,
    collectionName: string = getQdrantCollection(),
    caCertPath?: string
  ) {
    this.conn = new QdrantConnection(qdrantUrl, apiKey, collectionName, caCertPath);
    logger.info(`QdrantService composed for collection=${this.conn.collectionName}`);
  }

  /* Expose underlying connection properties via safe getters so other modules can use them without
     accessing private internals directly. This avoids direct bracket-access of private fields. */
  public get client(): any {
    return this.conn.client;
  }

  public get collectionName(): string {
    return this.conn.collectionName;
  }

  public get qdrantUrl(): string {
    return this.conn.qdrantUrl;
  }

  public get apiKey(): string {
    return this.conn.apiKey;
  }

  initialize(): Promise<void> {
    return init.initializeCollection(this.conn);
  }

  storeMemory(
    label: string,
    text: string,
    domain: string,
    task: string,
    type?: string,
    tags?: string[],
    embedding?: number[],
    protocol?: { step: number; total: number; enforcement: 'sequential' | 'flexible'; skip_allowed: boolean; title?: string; memory_uuid?: string },
    uuid?: string
  ) {
    return store.storeMemory(this.conn, label, text, domain, task, type, tags, embedding, protocol, uuid);
  }

  upsertResources(items: UpsertResourceItem[]): Promise<UpsertResourceResult[]> {
    return resources.upsertResources(this.conn, items);
  }

  retrieveById(uuid: string) {
    return retrieval.retrieveById(this.conn, uuid);
  }

  getMemoryByUUID(uuid: string) {
    return retrieval.getMemoryByUUID(this.conn, uuid);
  }

  getAdapterLayers(adapterId: string, extraSpaceIds?: string[]) {
    return retrieval.getAdapterLayers(this.conn, adapterId, extraSpaceIds);
  }

  /** Exact slug lookup: first layer UUID of the protocol adapter, or null. */
  findFirstStepMemoryUuidBySlug(slug: string) {
    return retrieval.findFirstStepMemoryUuidBySlug(this.conn, slug);
  }

  findArtifactMemoryUuidBySlug(slug: string) {
    return retrieval.findArtifactMemoryUuidBySlug(this.conn, slug);
  }

  updateMemoryByUUID(uuid: string, updatesPayload: any) {
    return updateMemoryByUUID(this.conn, uuid, updatesPayload);
  }

  updateMemory(id: string, updatesPayload: any) {
    return updateMemory(this.conn, id, updatesPayload);
  }

  deleteMemory(id: string) {
    return deleteMemory(this.conn, id);
  }

  updateQualityMetrics(id: string, metrics: any) {
    return quality.updateQualityMetrics(this.conn, id, metrics);
  }

  updateQualityMetadata(id: string, qualityMetadata: any) {
    return quality.updateQualityMetadata(this.conn, id, qualityMetadata);
  }

  /** Propagate reward metrics from the completion layer to the adapter head. */
  propagateRewardToAdapterHead(stepPointId: string, metricsUpdate: Record<string, unknown>): Promise<string | null> {
    return rewardPropagation.propagateRewardToAdapterHead(this.conn, stepPointId, metricsUpdate);
  }

  trackPendingValidation(id: string, modelId: string, protocolStep?: number) {
    return quality.trackPendingValidation(this.conn, id, modelId, protocolStep);
  }

  searchMemory(query: string, limit?: number, domain?: string) {
    return search.searchMemory(this.conn, query, limit, domain);
  }

  findProtocolSteps(protocolId: string) {
    return protocol.findProtocolSteps(this.conn, protocolId);
  }

  findProtocolStep(domain: string, type: string, task: string, step: number) {
    return protocol.findProtocolStep(this.conn, domain, type, task, step);
  }

  createOrUpdateAlias(aliasName: string = 'current') {
    return init.createOrUpdateAlias(this.conn, aliasName);
  }

  getCollections() {
    return init.getCollections(this.conn);
  }

  dropCollection(name: string) {
    return init.dropCollection(this.conn, name);
  }

  listItemsByCategory(domain: string, type: string, task: string) {
    return listing.listItemsByCategory(this.conn, domain, type, task);
  }

  getDomainOverview(domain: string) {
    return listing.getDomainOverview(this.conn, domain);
  }
}

// Backend-selected default. Constructing `QdrantService` resolves `getQdrantUrl()`
// (throws when `QDRANT_URL` is unset) and would crash import for the ~dozens of
// modules that reach for `qdrantService` even on the embedded path. So on the
// LanceDB path this is the PROCESS-DEFAULT runtime's facade, bound by
// `createEmbeddedRuntime` to the same store object the default boot uses.
//
// It is not a fallback for a runtime that owns its own store: `bootLocalRuntime`
// returns the facade it bound, `createServer`/`startStdioTransport`/
// `startHttpTransport` take it as an argument, and tools are registered with it.
// Modules that run before a runtime exists (navigation helpers, the delete tool)
// resolve this default, which is that same runtime's store.
export const qdrantService: QdrantService = isQdrantConfigured
  ? new QdrantService()
  : createEmbeddedRuntime(getEmbeddedRecordStore()).qdrantService;