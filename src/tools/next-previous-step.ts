// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
/**
 * MISSING_PROOF fix: when the requested step has no stored inference contract, apply the solution to the previous step.
 * Shared by the forward bridge and the older HTTP next route.
 */

import type { Memory } from '../types/memory.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { resolveAdapterPreviousLayer } from '../services/adapter-navigation.js';
import { getInferenceContract } from '../services/memory/memory-accessors.js';
import { proofOfWorkStore } from '../services/proof-of-work-store.js';
import { handleProofSubmission, GENESIS_HASH, type ProofOfWorkSubmission, type HandleProofResult } from './next-pow-helpers.js';
import { buildLayerUri } from './kairos-uri.js';

export type PreviousProofBlock = {
  message: string;
  error_code: string;
  next_action?: string;
};

export type TryApplyToPreviousResult =
  | { applied: true; outcome: HandleProofResult; prevMemory: Memory }
  | { applied: false };

/**
 * If the requested step has no stored inference contract and the previous step has required proof, validate and store
 * the solution against the previous step. Returns { applied: true, outcome, prevMemory } when applied
 * (caller must then check ensurePreviousProofCompleted and build response), or { applied: false }.
 */
export async function tryApplySolutionToPreviousStep(
  memory: Memory,
  solution: ProofOfWorkSubmission,
  loadMemory: (uuid: string) => Promise<Memory | null>,
  qdrantService: QdrantService | undefined
): Promise<TryApplyToPreviousResult> {
  if (getInferenceContract(memory)) return { applied: false };
  const prevInfo = await resolveAdapterPreviousLayer(memory, qdrantService);
  const prevMemory = prevInfo?.uuid ? await loadMemory(prevInfo.uuid) : null;
  const prevContract = prevMemory ? getInferenceContract(prevMemory) : undefined;
  if (!prevMemory || !prevContract?.required) return { applied: false };

  const prevIsStep1 = !prevMemory.adapter || prevMemory.adapter.layer_index <= 1;
  const expectedPrevHash = prevIsStep1
    ? GENESIS_HASH
    : (await (async () => {
        const previous = await resolveAdapterPreviousLayer(prevMemory, qdrantService);
        return previous?.uuid ? await proofOfWorkStore.getProofHash(previous.uuid) : null;
      })()) ?? GENESIS_HASH;

  const outcome = await handleProofSubmission(solution, prevMemory, {
    expectedPreviousHash: expectedPrevHash
  });
  return { applied: true, outcome, prevMemory };
}

/**
 * PROOF_HASH_MISMATCH fix: when the client calls forward with the URI from next_action (the next
 * step), they are submitting the solution for the step we just showed (the previous step). If the
 * requested step has an inference contract but the previous step has none stored yet and the solution type
 * matches the previous step's challenge, apply the solution to the previous step and return applied.
 * This prevents PROOF_HASH_MISMATCH because we expect the hash from the previous response, not
 * the hash of the previous step (which is not stored yet).
 */
export async function tryApplySolutionToPreviousStepWhenSolutionMatchesPrevious(
  requestedMemory: Memory,
  solution: ProofOfWorkSubmission,
  loadMemory: (uuid: string) => Promise<Memory | null>,
  qdrantService: QdrantService | undefined
): Promise<TryApplyToPreviousResult> {
  if (!getInferenceContract(requestedMemory)) return { applied: false };
  // Client is answering the *current* layer's stored challenge; do not route proof to previous step.
  const nonceForRequested = requestedMemory.memory_uuid
    ? await proofOfWorkStore.getNonce(requestedMemory.memory_uuid)
    : null;
  if (
    solution.nonce != null &&
    nonceForRequested != null &&
    solution.nonce === nonceForRequested
  ) {
    return { applied: false };
  }
  const prevInfo = await resolveAdapterPreviousLayer(requestedMemory, qdrantService);
  if (!prevInfo?.uuid) return { applied: false };
  const prevMemory = await loadMemory(prevInfo.uuid);
  const prevContract = prevMemory ? getInferenceContract(prevMemory) : undefined;
  if (!prevMemory || !prevContract?.required) return { applied: false };

  const storedResult = await proofOfWorkStore.getResult(prevInfo.uuid);
  if (storedResult) return { applied: false };

  const requiredType = prevContract.type || 'shell';
  const solutionType = solution.type || 'shell';
  if (solutionType !== requiredType) return { applied: false };

  const prevIsStep1 = !prevMemory.adapter || prevMemory.adapter.layer_index <= 1;
  const expectedPrevHash = prevIsStep1
    ? GENESIS_HASH
    : (await (async () => {
        const previous = await resolveAdapterPreviousLayer(prevMemory, qdrantService);
        return previous?.uuid ? await proofOfWorkStore.getProofHash(previous.uuid) : null;
      })()) ?? GENESIS_HASH;

  const outcome = await handleProofSubmission(solution, prevMemory, {
    expectedPreviousHash: expectedPrevHash
  });
  return { applied: true, outcome, prevMemory };
}

export async function ensurePreviousProofCompleted(
  memory: Memory,
  loadMemory: (uuid: string) => Promise<Memory | null>,
  qdrantService: QdrantService | undefined,
  executionId?: string
): Promise<PreviousProofBlock | null> {
  if (!memory?.adapter || memory.adapter.layer_index <= 1) return null;
  const previous = await resolveAdapterPreviousLayer(memory, qdrantService);
  if (!previous?.uuid) return null;
  const prevMemory = await loadMemory(previous.uuid);
  const prevProof = prevMemory ? getInferenceContract(prevMemory) : undefined;
  if (!prevProof || !prevProof.required) return null;
  const storedResult = await proofOfWorkStore.getResult(previous.uuid);
  if (!storedResult) {
    const proofType = prevProof.type || 'shell';
    const stepLabel = prevMemory?.label || 'previous step';
    const prevStepUri = buildLayerUri(previous.uuid, executionId);
    let message = `Proof of work missing for ${stepLabel}.`;
    let next_action: string | undefined;
    if (proofType === 'shell') {
      const cmd = prevProof.shell?.cmd || prevProof.cmd || 'the required command';
      message += ` Execute "${cmd}" and report the result before continuing.`;
      next_action = `Execute "${prevProof.shell?.cmd || prevProof.cmd || cmd}", then call forward with ${prevStepUri} and solution.type="${proofType}" plus solution.evidence.`;
    } else if (proofType === 'user_input') {
      const prompt = prevProof.user_input?.prompt || 'Confirm (see step content).';
      message += ` For user_input you must obtain the user's actual reply — do not infer or invent. Submit that proof by calling forward with ${prevStepUri} and solution.evidence.confirmation.`;
      next_action = `Ask the user: "${prompt}" then call forward with ${prevStepUri} and solution.evidence.confirmation set to their reply.`;
    } else if (proofType === 'mcp') {
      const toolName = prevProof.mcp?.tool_name || 'the required tool';
      message += ` Submit that proof by calling forward with ${prevStepUri} and solution.evidence. Call the MCP tool "${toolName}" and report its real result; do not fabricate.`;
      next_action = `Call ${toolName}, then call forward with ${prevStepUri} and solution.evidence with the real result.`;
    } else if (proofType === 'comment') {
      const minLen = prevProof.comment?.min_length ?? 10;
      message += ` Submit that proof by calling forward with ${prevStepUri} and solution.evidence.text. Write a genuine summary of what was done; do not paste unrelated text.`;
      next_action = `call forward with ${prevStepUri} and solution.evidence.text as a string (min ${minLen} chars).`;
    } else {
      message += ` Complete the required ${proofType} verification before continuing.`;
      next_action = `call forward with ${prevStepUri} -- complete previous step first`;
    }
    if (!next_action) next_action = `call forward with ${prevStepUri} -- complete previous step first`;
    const block: PreviousProofBlock = { message, error_code: 'MISSING_PROOF' };
    if (next_action !== undefined) block.next_action = next_action;
    return block;
  }
  if (storedResult.status !== 'success') {
    return { message: 'Previous step proof failed. Fix and retry.', error_code: 'COMMAND_FAILED' };
  }
  return null;
}
