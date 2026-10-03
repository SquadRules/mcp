// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
/**
 * Build current_step and challenge for MISSING_PROOF response so the client gets the previous step's
 * challenge (correct nonce and proof_hash) for the next forward call.
 */

import type { Memory } from '../types/memory.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { resolveAdapterPreviousLayer } from '../services/adapter-navigation.js';
import { getInferenceContract } from '../services/memory/memory-accessors.js';
import { proofOfWorkStore } from '../services/proof-of-work-store.js';
import { buildChallenge, GENESIS_HASH } from './next-pow-helpers.js';
import { extractMemoryBody } from '../utils/memory-body.js';
import type { PreviousProofBlock } from './next-previous-step.js';
import { buildLayerUri } from './kairos-uri.js';

function buildCurrentStep(memory: Memory | null, requestedUri: string, executionId?: string) {
  const uri = memory ? buildLayerUri(memory.memory_uuid, executionId) : requestedUri;
  const content = memory ? extractMemoryBody(memory.text) : '';
  return { uri, content, mimeType: 'text/markdown' as const };
}

export type MissingProofPayload = {
  current_step: ReturnType<typeof buildCurrentStep>;
  challenge: Awaited<ReturnType<typeof buildChallenge>> & { proof_hash: string };
  next_action: string;
  retry_count: number;
};

export async function buildMissingProofPayload(
  memory: Memory,
  previousBlock: PreviousProofBlock,
  requestedUri: string,
  uuid: string,
  loadMemory: (id: string) => Promise<Memory | null>,
  qdrantService: QdrantService | undefined,
  executionId?: string
): Promise<MissingProofPayload> {
  const previous = await resolveAdapterPreviousLayer(memory, qdrantService);
  const prevMemory = previous?.uuid ? await loadMemory(previous.uuid) : null;
  const prevUri = previous?.uuid ? buildLayerUri(previous.uuid, executionId) : requestedUri;
  const isPrevStep1 = !prevMemory?.adapter || prevMemory.adapter.layer_index <= 1;
  const previousOfPrevious = prevMemory && !isPrevStep1 ? await resolveAdapterPreviousLayer(prevMemory, qdrantService) : null;
  const expectedPrevHash = isPrevStep1
    ? GENESIS_HASH
    : (previousOfPrevious?.uuid ? await proofOfWorkStore.getProofHash(previousOfPrevious.uuid) : null) ?? GENESIS_HASH;
  let challenge = await buildChallenge(prevMemory, prevMemory ? getInferenceContract(prevMemory) : undefined);
  challenge = { ...challenge, proof_hash: expectedPrevHash };
  const storedNonce = await proofOfWorkStore.getNonce(memory.memory_uuid);
  const retryCount = await proofOfWorkStore.incrementRetry(storedNonce ?? uuid);
  return {
    current_step: buildCurrentStep(prevMemory, prevUri, executionId),
    challenge,
    next_action: previousBlock.next_action ?? `retry forward with ${prevUri} -- complete previous step first`,
    retry_count: retryCount
  };
}
