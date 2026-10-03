// squadrules-compat-surface: dual-emits the kairos_local_artifact_dir JSON field expected by existing clients
import type { MemoryQdrantStore } from '../services/memory/store.js';
import { z } from 'zod';
import { nextInputSchema, nextOutputSchema } from './next_schema.js';

export type NextInput = z.infer<typeof nextInputSchema>;
export type NextOutput = z.infer<typeof nextOutputSchema>;
import type { QdrantService } from '../services/qdrant/service.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { resolveAdapterNextLayer, resolveAdapterPreviousLayer } from '../services/adapter-navigation.js';
import { getInferenceContract } from '../services/memory/memory-accessors.js';
import type { Memory, ProofOfWorkDefinition } from '../types/memory.js';
import { redisCacheService } from '../services/redis-cache.js';
import { extractMemoryBody } from '../utils/memory-body.js';
import { proofOfWorkStore } from '../services/proof-of-work-store.js';
import { buildChallenge, handleProofSubmission, GENESIS_HASH, type ProofOfWorkSubmission, type HandleProofResult } from './next-pow-helpers.js';
import { tryApplySolutionToPreviousStep, tryApplySolutionToPreviousStepWhenSolutionMatchesPrevious, ensurePreviousProofCompleted } from './next-previous-step.js';
import { buildMissingProofPayload } from './next-missing-proof-payload.js';
import { modelStats } from '../services/stats/model-stats.js';
import { kairosQualityUpdateErrors } from '../services/metrics/mcp-metrics.js';
import { buildLayerUri, parseSquadrulesUri } from './kairos-uri.js';
import { KAIROS_LOCAL_ARTIFACT_DIRS } from '../config.js';
import { buildLocalArtifactDirFields } from './local-artifact-dir-contract.js';

async function loadMemoryWithCache(memoryStore: MemoryQdrantStore, uuid: string): Promise<Memory | null> {
  const cached = await redisCacheService.getMemoryResource(uuid);
  if (cached) {
    return cached;
  }
  const memory = await memoryStore.getMemory(uuid);
  if (memory) {
    await redisCacheService.setMemoryResource(memory);
  }
  return memory;
}

function normalizeLayerUri(value: string): { uuid: string; uri: string; executionId?: string } {
  const parsed = parseSquadrulesUri(value);
  if (parsed.kind !== 'layer') {
    throw new Error('Invalid SQUADRULES URI. next expects a layer URI.');
  }
  return {
    uuid: parsed.id,
    uri: parsed.raw,
    ...(parsed.executionId ? { executionId: parsed.executionId } : {})
  };
}

function buildCurrentStep(memory: Memory | null, requestedUri: string, executionId?: string) {
  const uri = memory ? buildLayerUri(memory.memory_uuid, executionId) : requestedUri;
  const content = memory ? extractMemoryBody(memory.text) : '';
  return {
    uri,
    content,
    mimeType: 'text/markdown' as const
  };
}

async function buildNextPayload(
  memory: Memory | null,
  requestedUri: string,
  nextStepId: string | null,
  proof?: ProofOfWorkDefinition,
  executionId?: string
) {
  const current_step = buildCurrentStep(memory, requestedUri, executionId);
  const challenge = await buildChallenge(memory, proof);

  const payload: any = {
    must_obey: true as const,
    current_step,
    challenge,
    ...buildLocalArtifactDirFields(KAIROS_LOCAL_ARTIFACT_DIRS)
  };

  if (nextStepId) {
    payload.next_action = `call forward with ${buildLayerUri(nextStepId, executionId)} and solution.type="${challenge.type}" plus solution.${challenge.type}`;
  } else {
    payload.message = 'Adapter layers complete. Call reward to finalize.';
    payload.next_action = `call reward with ${requestedUri} and outcome (success or failure) and feedback to complete the adapter`;
  }

  return payload;
}

/** Update quality_metadata and quality_metrics for the completed step. Log and continue on error; do not fail the request. Shared by the forward bridge and the older HTTP next route. */
export async function updateStepQuality(
  qdrantService: QdrantService,
  memory: Memory,
  outcome: 'success' | 'failure',
  tenantId: string
): Promise<void> {
  try {
    const qdrantUuid = memory.memory_uuid;
    const currentPoint = await qdrantService.retrieveById(qdrantUuid);
    const payload = currentPoint?.payload as Record<string, unknown> | undefined;
    const label = (payload?.['label'] as string) || 'Knowledge step';
    const domain = (payload?.['domain'] as string) || 'general';
    const task = (payload?.['task'] as string) || 'general';
    const type = (payload?.['type'] as string) || 'context';
    const tags = Array.isArray(payload?.['tags']) ? (payload['tags'] as string[]) : [];

    const metricsUpdate = {
      retrievalCount: 1,
      successCount: outcome === 'success' ? 1 : 0,
      failureCount: outcome === 'failure' ? 1 : 0,
      lastRated: new Date().toISOString(),
      lastRater: 'forward',
      qualityBonus: outcome === 'success' ? 1 : -0.2
    };
    await qdrantService.updateQualityMetrics(qdrantUuid, metricsUpdate);

    const updatedQualityMetadata = modelStats.calculateStepQualityMetadata(
      label,
      domain,
      task,
      type,
      tags,
      outcome
    );
    await qdrantService.updateQualityMetadata(qdrantUuid, {
      step_quality_score: updatedQualityMetadata.step_quality_score,
      step_quality: updatedQualityMetadata.step_quality
    });
    structuredLogger.debug(`forward: Updated quality for ${memory.memory_uuid} outcome=${outcome}`);
  } catch (error) {
    kairosQualityUpdateErrors.inc({ tenant_id: tenantId });
    structuredLogger.warn(`forward: Quality update failed for ${memory.memory_uuid}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type _TryElicitResult = { payload: NextOutput } | { solution: ProofOfWorkSubmission };

/**
 * Shared execute: submit solution and return next step/challenge. Used by the forward bridge and the older HTTP route.
 * When tryElicit is provided, user_input elicitation may return a payload or adjusted solution.
 */
async function _executeNext(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  input: NextInput,
  tenantId: string,
  options?: { tryElicit?: (memory: Memory, solution: ProofOfWorkSubmission, requestedUri: string) => Promise<_TryElicitResult> }
): Promise<NextOutput> {
  const { uri, solution } = input;
  const { uuid, uri: requestedUri, executionId } = normalizeLayerUri(uri);
  const memory = await loadMemoryWithCache(memoryStore, uuid);

  let solutionToUse = solution;
  if (memory && options?.tryElicit) {
    const elicitResult = await options.tryElicit(memory, solution as ProofOfWorkSubmission, requestedUri);
    if ('payload' in elicitResult) return elicitResult.payload;
    solutionToUse = elicitResult.solution;
  }

  let submissionOutcome: HandleProofResult | undefined;
  if (memory) {
    const memoryContract = getInferenceContract(memory);
    if (!memoryContract && solutionToUse) {
      const prevResult = await tryApplySolutionToPreviousStep(
        memory,
        solutionToUse as ProofOfWorkSubmission,
        (id) => loadMemoryWithCache(memoryStore, id),
        qdrantService
      );
      if (prevResult.applied) {
        if (prevResult.outcome.blockedPayload) {
          if (qdrantService) await updateStepQuality(qdrantService, prevResult.prevMemory, 'failure', tenantId);
          return prevResult.outcome.blockedPayload as NextOutput;
        }
        const previousBlock = await ensurePreviousProofCompleted(
          memory,
          (id) => loadMemoryWithCache(memoryStore, id),
          qdrantService,
          executionId
        );
        if (!previousBlock && qdrantService && !prevResult.outcome.alreadyRecorded) {
          await updateStepQuality(qdrantService, prevResult.prevMemory, 'success', tenantId);
        }
        if (!previousBlock) {
          const nextFromRequested = await resolveAdapterNextLayer(memory, qdrantService);
          const nextStepId = nextFromRequested?.uuid ?? null;
          const output = (await buildNextPayload(memory, requestedUri, nextStepId, undefined, executionId)) as NextOutput;
          if (prevResult.outcome.proofHash) output.proof_hash = prevResult.outcome.proofHash;
          return output;
        }
      }
    }

    if (memoryContract && solutionToUse) {
      const prevResultWhenMatch = await tryApplySolutionToPreviousStepWhenSolutionMatchesPrevious(
        memory,
        solutionToUse as ProofOfWorkSubmission,
        (id) => loadMemoryWithCache(memoryStore, id),
        qdrantService
      );
      if (prevResultWhenMatch.applied) {
        if (prevResultWhenMatch.outcome.blockedPayload) {
          if (qdrantService) await updateStepQuality(qdrantService, prevResultWhenMatch.prevMemory, 'failure', tenantId);
          return prevResultWhenMatch.outcome.blockedPayload as NextOutput;
        }
        if (qdrantService && !prevResultWhenMatch.outcome.alreadyRecorded) {
          await updateStepQuality(qdrantService, prevResultWhenMatch.prevMemory, 'success', tenantId);
        }
        const nextFromRequested = await resolveAdapterNextLayer(memory, qdrantService);
        const nextStepId = nextFromRequested?.uuid ?? null;
        const nextMemory = nextFromRequested ? await loadMemoryWithCache(memoryStore, nextFromRequested.uuid) : null;
        const challengeProof = (nextMemory ? getInferenceContract(nextMemory) : undefined) ?? memoryContract;
        const output = (await buildNextPayload(memory, requestedUri, nextStepId, challengeProof, executionId)) as NextOutput;
        if (prevResultWhenMatch.outcome.proofHash) output.proof_hash = prevResultWhenMatch.outcome.proofHash;
        return output;
      }
    }

    const isStep1 = !memory.adapter || memory.adapter.layer_index <= 1;
    let expectedPreviousHash: string;
    if (isStep1) {
      expectedPreviousHash = GENESIS_HASH;
    } else {
      const previous = await resolveAdapterPreviousLayer(memory, qdrantService);
      const prevHash = previous?.uuid ? await proofOfWorkStore.getProofHash(previous.uuid) : null;
      expectedPreviousHash = prevHash ?? GENESIS_HASH;
    }
    submissionOutcome = await handleProofSubmission(solutionToUse as ProofOfWorkSubmission, memory, { expectedPreviousHash });
    if (submissionOutcome.blockedPayload) {
      if (qdrantService) await updateStepQuality(qdrantService, memory, 'failure', tenantId);
      return submissionOutcome.blockedPayload as NextOutput;
    }

    const previousBlock = await ensurePreviousProofCompleted(
      memory,
      (id) => loadMemoryWithCache(memoryStore, id),
      qdrantService,
      executionId
    );
    if (previousBlock) {
      if (qdrantService) await updateStepQuality(qdrantService, memory, 'failure', tenantId);
      const payload = await buildMissingProofPayload(
        memory,
        previousBlock,
        requestedUri,
        uuid,
        (id) => loadMemoryWithCache(memoryStore, id),
        qdrantService,
        executionId
      );
      return {
        must_obey: payload.retry_count < 3,
        current_step: payload.current_step,
        challenge: payload.challenge,
        ...buildLocalArtifactDirFields(KAIROS_LOCAL_ARTIFACT_DIRS),
        message: previousBlock.message,
        next_action: payload.next_action,
        error_code: previousBlock.error_code || 'MISSING_PROOF',
        retry_count: payload.retry_count
      };
    }
    if (qdrantService && !submissionOutcome.alreadyRecorded) {
      await updateStepQuality(qdrantService, memory, 'success', tenantId);
    }
  }

  const nextStepInfo = memory ? await resolveAdapterNextLayer(memory, qdrantService) : undefined;
  const nextMemory = nextStepInfo ? await loadMemoryWithCache(memoryStore, nextStepInfo.uuid) : null;
  const displayMemory = nextMemory ?? memory ?? null;
  const challengeProof = displayMemory ? getInferenceContract(displayMemory) : undefined;
  const displayUri = nextStepInfo ? buildLayerUri(nextStepInfo.uuid, executionId) : requestedUri;
  const nextFromDisplay = displayMemory ? await resolveAdapterNextLayer(displayMemory, qdrantService) : undefined;
  const nextStepId = nextFromDisplay?.uuid ?? null;
  const output = (await buildNextPayload(displayMemory, displayUri, nextStepId, challengeProof, executionId)) as NextOutput;
  if (submissionOutcome?.proofHash) output.proof_hash = submissionOutcome.proofHash;
  return output;
}
