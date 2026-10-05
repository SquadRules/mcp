/**
 * Backend-neutral domain types for the vector-store abstraction.
 *
 * The ports (`IVectorRecordStore`, `IExecutionTraceStore`) and their adapters
 * speak these shapes. Concrete backends (Qdrant points,
 * Lance Arrow rows) are mapped to/from them inside each adapter, so no port
 * leaks a backend client or payload object. This file must not import a
 * backend client library.
 */
import type { Memory, ExecutionTrace, RewardRecord, TensorValue } from '../../types/memory.js';

export type { Memory, ExecutionTrace, RewardRecord, TensorValue };

/** Result of a semantic search; matches the existing `{ memories, scores }` shape. */
export interface MemorySearchResult {
  readonly memories: Memory[];
  readonly scores: number[];
}

/** Options for storing an adapter chain. */
export interface StoreAdapterOptions {
  readonly forceUpdate?: boolean;
  readonly protocolVersion?: string;
  readonly forkNewAdapter?: boolean;
}

/** Options for reading a single memory. `fresh` bypasses any read cache. */
export interface GetMemoryOptions {
  readonly fresh?: boolean;
}

/**
 * One adapter layer as the app consumes it today: point id plus payload.
 * Mirrors the inline `AdapterLayerPoint` the tune tools already use, kept
 * backend-neutral so a LanceDB row can be shaped identically to a Qdrant point.
 */
export interface LayerRecord {
  readonly uuid: string;
  readonly payload: Memory;
}

/** Outcome of resolving an adapter slug to its entry-layer point id. */
export interface SlugResolveOutcome {
  readonly layerUuid: string | null;
  readonly disambiguation_note?: string;
}

/** Outcome of resolving an artifact slug to its point id (null when ambiguous). */
export interface ArtifactResolveOutcome {
  readonly artifactUuid: string | null;
  readonly disambiguation_note?: string;
}

/** Parameters to open an execution (mirrors ExecutionTraceStore.startExecution). */
export interface StartExecutionParams {
  readonly executionId: string;
  readonly adapterId: string;
  readonly adapterUri: string;
  readonly activationQuery?: string;
}

/**
 * Persisted execution record. Relocated here from `execution-trace-store.ts`
 * so the trace port has a neutral home; the Qdrant store re-exports it.
 */
export interface StoredExecutionTrace {
  execution_id: string;
  adapter_id: string;
  adapter_uri: string;
  activation_query?: string;
  reward?: RewardRecord;
  traces: ExecutionTrace[];
}

/** A supervised-fine-tuning pair built from stored traces. Relocated as above. */
export interface TrainingPair {
  id: string;
  execution_id: string;
  adapter_uri: string;
  layer_uri: string;
  layer_index: number;
  timestamp: string;
  instruction: {
    activation_query?: string;
    tensor_in: Record<string, unknown>;
    layer_instructions: string;
  };
  response: {
    tensor_out?: TensorValue;
    trace?: string;
    raw_solution?: unknown;
  };
  reward?: RewardRecord;
}
