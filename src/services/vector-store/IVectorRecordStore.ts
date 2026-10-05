/**
 * Port: memory / adapter / artifact record storage (the vector-bearing store).
 *
 * Split from `IExecutionTraceStore` (no vectors) so each backend implements
 * focused capabilities rather than one wide god-interface. Records are the
 * neutral `Memory`; layers are
 * `LayerRecord` (id + payload), matching the shape the tune tools already read.
 *
 * Methods marked [delegated] map onto signatures already present on the
 * injected `MemoryQdrantStore`. Methods marked [neutralize] are the target
 * contract for callers that today reach for raw `getQdrantAccess()` or
 * `QdrantService`; their return shapes mirror what those facades actually
 * return today (outcome objects, `{uuid, payload}` layers) so migrating a
 * caller is behavior-preserving and gated by the Qdrant integration suite.
 */
import type { Memory } from './types.js';
import type {
  ArtifactResolveOutcome,
  GetMemoryOptions,
  LayerRecord,
  MemorySearchResult,
  SlugResolveOutcome,
  StoreAdapterOptions,
} from './types.js';
import type { StoreArtifactOptions } from '../memory/store-adapter.js';

export interface IVectorRecordStore {
  // --- lifecycle [delegated] ---
  init(): Promise<void>;
  checkHealth(timeoutMs?: number): Promise<boolean>;

  // --- writes ---
  /** [delegated] Store an adapter chain as linked layer records. */
  storeAdapter(docs: string[], llmModelId: string, options?: StoreAdapterOptions): Promise<Memory[]>;
  /** [delegated] Store a single artifact document. */
  storeArtifact(content: string, options: StoreArtifactOptions): Promise<Memory[]>;

  // --- reads ---
  /** [delegated] Read one memory by uuid; `fresh` bypasses the read cache. */
  getMemory(memoryUuid: string, options?: GetMemoryOptions): Promise<Memory | null>;

  // --- search ---
  /** [delegated] Semantic search over memory text. */
  searchMemories(query: string, limit: number, collapse?: boolean): Promise<MemorySearchResult>;

  // --- adapter structure [neutralize: QdrantService reads] ---
  /** Layers of one adapter, optionally widened across extra spaces. */
  getAdapterLayers(adapterId: string, extraSpaceIds?: string[]): Promise<LayerRecord[]>;
  /** Exact slug lookup of an adapter's first-layer entry point. */
  findFirstStepMemoryUuidBySlug(slug: string): Promise<SlugResolveOutcome>;
  /** Exact slug lookup of an artifact point (null when ambiguous). */
  findArtifactMemoryUuidBySlug(slug: string): Promise<ArtifactResolveOutcome>;
  /** Apply a payload patch to one memory (idempotent upsert of changed fields). */
  updateMemory(memoryUuid: string, patch: Record<string, unknown>): Promise<void>;
  /** Delete one memory by uuid. */
  deleteMemory(memoryUuid: string): Promise<void>;

  // --- enumeration / bulk ops [neutralize: replaced raw getQdrantAccess()] ---
  /** Every layer point in one space. `paginate` walks all pages. */
  scrollSpace(spaceId: string, options?: { paginate?: boolean; limit?: number }): Promise<LayerRecord[]>;
  /** Artifact layer points attached to an adapter, across searchable spaces. */
  listAdapterArtifacts(adapterId: string): Promise<LayerRecord[]>;
  /** First-layer footer points for the refining/creation protocol slugs. */
  findProtocolFooterLayers(refineSlug: string, createSlug: string): Promise<LayerRecord[]>;
  /** Protocol version already stored for an app-space adapter slug, or undefined. */
  getStoredAdapterVersion(slug: string): Promise<string | undefined>;
  /** Attach a payload patch (e.g. content hash) to a set of layer points. */
  setPayloadOnLayers(layerIds: string[], patch: Record<string, unknown>): Promise<void>;
  /** Delete app-space points matching a slug. */
  deleteAppSpaceBySlug(slug: string): Promise<void>;
  /** Delete app-space points matching an adapter id. */
  deleteAppSpaceByAdapterId(adapterId: string): Promise<void>;
}
