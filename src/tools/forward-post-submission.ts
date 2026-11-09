/**
 * Post-submission view construction for `forward`, extracted from `forward.ts`
 * to keep that module inside the line budget.
 *
 * Everything here answers one question — "given the step that was just completed,
 * what does the caller see next?" — and owns no state: the memory store, the
 * retrieval surface and the execution id are all supplied by the caller.
 */
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { resolveAdapterNextLayer, resolveAdapterPreviousLayer } from '../services/adapter-navigation.js';
import { getLayerIndex } from '../services/memory/memory-accessors.js';
import { proofOfWorkStore } from '../services/proof-of-work-store.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { GENESIS_HASH } from './next-pow-helpers.js';
import { buildForwardView } from './forward-view.js';
import type { ForwardOutput } from './forward_schema.js';

/** A fire-and-forget trace write must never surface as a tool failure. */
export function traceFireAndForget(op: Promise<void>): void {
  op.catch((err) => structuredLogger.warn(`[trace] Persistence failed, data lost: ${err instanceof Error ? err.message : String(err)}`));
}
export async function loadLayer(memoryStore: MemoryQdrantStore, layerId: string | undefined): Promise<Awaited<ReturnType<MemoryQdrantStore['getMemory']>>> {
  return layerId ? memoryStore.getMemory(layerId) : null;
}
export async function expectedPreviousHash(
  memory: Awaited<ReturnType<MemoryQdrantStore['getMemory']>>,
  qdrantService: QdrantService | undefined,
  executionId?: string
): Promise<string> {
  if (!memory || getLayerIndex(memory) <= 1) {
    return GENESIS_HASH;
  }
  const previous = await resolveAdapterPreviousLayer(memory, qdrantService, executionId);
  if (!previous?.uuid) {
    return GENESIS_HASH;
  }
  return (await proofOfWorkStore.getProofHash(previous.uuid)) ?? GENESIS_HASH;
}

export async function buildPostSubmissionView(params: {
  memoryStore: MemoryQdrantStore;
  currentMemory: Awaited<ReturnType<MemoryQdrantStore['getMemory']>>;
  executionId: string;
  proofHash?: string;
  qdrantService: QdrantService | undefined;
  message?: string;
}): Promise<ForwardOutput> {
  const { memoryStore, currentMemory, executionId, proofHash, qdrantService, message } = params;
  if (!currentMemory) {
    throw new Error('Layer not found while building forward response');
  }
  const next = await resolveAdapterNextLayer(currentMemory, qdrantService, executionId);
  if (!next?.uuid) {
    return buildForwardView(currentMemory, executionId, {
      final: true,
      ...(message ? { message } : { message: 'Adapter layers complete. Call reward to finalize.' }),
      ...(proofHash ? { proofHash } : {})
    });
  }
  const nextMemory = await loadLayer(memoryStore, next.uuid);
  if (!nextMemory) {
    throw new Error(`Next layer ${next.uuid} could not be loaded`);
  }
  return buildForwardView(nextMemory, executionId, {
    ...(proofHash ? { proofHash } : {}),
    ...(message ? { message } : {})
  });
}

