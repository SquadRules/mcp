import { authoringContextSchema } from './authoring-context.js';
import { isAuthoringAdapterSlug } from '../utils/adapter-alias.js';
import { resolveExportAdapter } from './export-resolve-adapter.js';
import crypto from 'node:crypto';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { getTenantId } from '../utils/tenant-context.js';
import { resolveAdapterNextLayer, resolveAdapterPreviousLayer, buildAndPinLayerManifest } from '../services/adapter-navigation.js';
import { executionTraceStore } from '../services/execution-trace-store.js';
import { forwardRuntimeStore } from '../services/forward-runtime-store.js';
import { getAdapterId, getInferenceContract, getLayerIndex } from '../services/memory/memory-accessors.js';
import { proofOfWorkStore } from '../services/proof-of-work-store.js';
import { structuredLogger } from '../utils/structured-logger.js';
import {
  GENESIS_HASH,
  handleProofSubmission,
  tryUserInputElicitation,
  type HandleProofResult,
  type ProofOfWorkSubmission
} from './next-pow-helpers.js';
import { buildMissingProofPayload } from './next-missing-proof-payload.js';
import {
  ensurePreviousProofCompleted,
  tryApplySolutionToPreviousStep,
  tryApplySolutionToPreviousStepWhenSolutionMatchesPrevious
} from './next-previous-step.js';
import { updateStepQuality } from './next.js';
import { type ForwardInput, type ForwardOutput } from './forward_schema.js';
import { assertWireAdapterUri, buildAdapterUri, buildLayerUri, parseSquadrulesUriOrThrow } from './squadrules-uri.js';
import {
  buildForwardView,
  buildCurrentLayerView,
  loadMemoryForParsedUri,
  mapLayerPayloadShapeToForwardView,
  mapProofSolution,
} from './forward-view.js';
import { appendExecutionTrace, solutionToTensorValue } from './forward-trace.js';
import { SquadrulesError } from '../types/index.js';

function traceFireAndForget(op: Promise<void>): void {
  op.catch((err) => structuredLogger.warn(`[trace] Persistence failed, data lost: ${err instanceof Error ? err.message : String(err)}`));
}
async function loadLayer(memoryStore: MemoryQdrantStore, layerId: string | undefined): Promise<Awaited<ReturnType<MemoryQdrantStore['getMemory']>>> {
  return layerId ? memoryStore.getMemory(layerId) : null;
}
async function expectedPreviousHash(
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

async function buildPostSubmissionView(params: {
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

export async function executeForward(
  server: any,
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  input: ForwardInput
): Promise<ForwardOutput> {
  const parsedInputUri = parseSquadrulesUriOrThrow(input.uri);
  const parsed =
    parsedInputUri.kind === 'adapter'
      ? parseSquadrulesUriOrThrow(assertWireAdapterUri(input.uri))
      : parsedInputUri;
  const loaded = await loadMemoryForParsedUri(memoryStore, qdrantService, parsed);
  const memory = loaded.memory;
  if (!memory) {
    throw new SquadrulesError('Layer or adapter not found', 'NOT_FOUND', 404);
  }
  const adapterId = getAdapterId(memory);
  const adapterUri = buildAdapterUri(adapterId);
  const executionId = parsed.kind === 'layer' && parsed.executionId ? parsed.executionId : crypto.randomUUID();

  const continuing = parsed.kind === 'layer' && Boolean(parsed.executionId);
  let authoring = input.authoring ? authoringContextSchema.parse(input.authoring) : undefined;
  if (continuing) {
    const meta = await forwardRuntimeStore.getExecution(executionId);
    if ((!meta && isAuthoringAdapterSlug(memory.slug ?? '')) || ((meta?.authoring || authoring) &&
        (!meta || meta.adapter_id !== adapterId ||
         (authoring && JSON.stringify(authoring) !== JSON.stringify(meta.authoring))))) {
      throw new SquadrulesError('Authoring operation, target, and workflow are fixed for this run. Use the returned next_call or start a new run.', 'AUTHORING_CONTEXT_MISMATCH', 400);
    }
  } else if (authoring) {
    if (!isAuthoringAdapterSlug(memory.slug ?? '')) {
      throw new SquadrulesError('authoring is only valid for squadrules://adapter/author-adapter.', 'INVALID_AUTHORING_WORKFLOW', 400);
    }
    if (authoring.operation !== 'create') {
      const target = await resolveExportAdapter(memoryStore, qdrantService, authoring.target_adapter_uri);
      if (!await memoryStore.getMemory(target.layerId)) {
        throw new SquadrulesError('Authoring target adapter not found; correct target_adapter_uri before starting.', 'NOT_FOUND', 404);
      }
      authoring = { ...authoring, target_adapter_uri: buildAdapterUri(target.adapterId) };
    }
  }

  if (!(parsed.kind === 'layer' && parsed.executionId)) {
    await forwardRuntimeStore.startExecution({
      execution_id: executionId,
      adapter_id: adapterId,
      adapter_uri: adapterUri,
      ...(authoring ? { authoring } : {}),
      merge_depth: 0,
      created_at: new Date().toISOString(),
      ...(loaded.slug_disambiguation_note
        ? { slug_disambiguation_note: loaded.slug_disambiguation_note }
        : {})
    });
    traceFireAndForget(executionTraceStore.startExecution({
      executionId,
      adapterId,
      adapterUri
    }));
    // Pin layer manifest on first forward of this execution to prevent UUID churn (#79).
    await buildAndPinLayerManifest(memory, qdrantService, executionId);
  }

  if (!input.solution) {
    return buildForwardView(memory, executionId);
  }

  const contract = getInferenceContract(memory);

  const tenantId = getTenantId();
  const tryElicit = (currentMemory: typeof memory, solution: ProofOfWorkSubmission, requestedUri: string) =>
    tryUserInputElicitation(server, currentMemory, solution, requestedUri, buildCurrentLayerView);
  const requestedUri = buildLayerUri(memory.memory_uuid, executionId);
  let solutionToUse = mapProofSolution(input.solution);
  const elicitResult = await tryElicit(memory, solutionToUse, requestedUri);
  if ('payload' in elicitResult) {
    return mapLayerPayloadShapeToForwardView(memoryStore, executionId, elicitResult.payload);
  }
  solutionToUse = elicitResult.solution;

  let submissionOutcome: HandleProofResult | undefined;
  if (!contract) {
    const previousAttempt = await tryApplySolutionToPreviousStep(
      memory,
      solutionToUse,
      (id) => memoryStore.getMemory(id),
      qdrantService,
      executionId
    );
    if (previousAttempt.applied) {
      if (previousAttempt.outcome.blockedPayload) {
        if (qdrantService) {
          await updateStepQuality(qdrantService, previousAttempt.prevMemory, 'failure', tenantId);
        }
        return mapLayerPayloadShapeToForwardView(memoryStore, executionId, previousAttempt.outcome.blockedPayload);
      }
      const previousBlock = await ensurePreviousProofCompleted(
        memory,
        (id) => memoryStore.getMemory(id),
        qdrantService,
        executionId
      );
      if (previousBlock) {
        if (qdrantService) {
          await updateStepQuality(qdrantService, memory, 'failure', tenantId);
        }
        const payload = await buildMissingProofPayload(
          memory,
          previousBlock,
          requestedUri,
          memory.memory_uuid,
          (id) => memoryStore.getMemory(id),
          qdrantService,
          executionId
        );
        return mapLayerPayloadShapeToForwardView(memoryStore, executionId, {
          must_obey: payload.retry_count < 3,
          current_step: payload.current_step,
          challenge: payload.challenge,
          message: previousBlock.message,
          next_action: payload.next_action,
          error_code: previousBlock.error_code || 'MISSING_PROOF',
          retry_count: payload.retry_count
        });
      }
      if (qdrantService && !previousAttempt.outcome.alreadyRecorded) {
        await updateStepQuality(qdrantService, previousAttempt.prevMemory, 'success', tenantId);
      }
      submissionOutcome = previousAttempt.outcome;
    }

    const executionMeta = await forwardRuntimeStore.getExecution(executionId);
    const tensorOut = solutionToTensorValue(input.solution);
    await appendExecutionTrace(
      executionId,
      previousAttempt.applied ? previousAttempt.prevMemory : memory,
      input.solution,
      executionMeta?.activation_query,
      {},
      tensorOut
    );
    return buildPostSubmissionView({
      memoryStore,
      currentMemory: memory,
      executionId,
      qdrantService,
      ...(submissionOutcome?.proofHash ? { proofHash: submissionOutcome.proofHash } : {}),
      message: submissionOutcome
        ? 'Applied the submitted solution to the pending prior layer and continued.'
        : 'Current layer has no contract; continuing.'
    });
  }

  const previousMatchAttempt = await tryApplySolutionToPreviousStepWhenSolutionMatchesPrevious(
    memory,
    solutionToUse,
    (id) => memoryStore.getMemory(id),
    qdrantService,
    executionId
  );
  if (previousMatchAttempt.applied) {
    if (previousMatchAttempt.outcome.blockedPayload) {
      if (qdrantService) {
        await updateStepQuality(qdrantService, previousMatchAttempt.prevMemory, 'failure', tenantId);
      }
      return mapLayerPayloadShapeToForwardView(memoryStore, executionId, previousMatchAttempt.outcome.blockedPayload);
    }
    if (qdrantService && !previousMatchAttempt.outcome.alreadyRecorded) {
      await updateStepQuality(qdrantService, previousMatchAttempt.prevMemory, 'success', tenantId);
    }
    const executionMeta = await forwardRuntimeStore.getExecution(executionId);
    const tensorOut = solutionToTensorValue(input.solution);
    await appendExecutionTrace(
      executionId,
      previousMatchAttempt.prevMemory,
      input.solution,
      executionMeta?.activation_query,
      {},
      tensorOut
    );
    const redirectProofHash = previousMatchAttempt.outcome.proofHash;
    return buildForwardView(memory, executionId, {
      ...(redirectProofHash ? { proofHash: redirectProofHash } : {}),
      message: 'Applied the submitted solution to the pending prior layer. Continue with the current layer.'
    });
  }

  submissionOutcome = await handleProofSubmission(solutionToUse, memory, {
    expectedPreviousHash: await expectedPreviousHash(memory, qdrantService, executionId)
  });
  if (submissionOutcome.blockedPayload) {
    if (qdrantService) {
      await updateStepQuality(qdrantService, memory, 'failure', tenantId);
    }
    return mapLayerPayloadShapeToForwardView(memoryStore, executionId, submissionOutcome.blockedPayload);
  }

  const previousBlock = await ensurePreviousProofCompleted(
    memory,
    (id) => memoryStore.getMemory(id),
    qdrantService,
    executionId
  );
  if (previousBlock) {
    if (qdrantService) {
      await updateStepQuality(qdrantService, memory, 'failure', tenantId);
    }
    const payload = await buildMissingProofPayload(
      memory,
      previousBlock,
      requestedUri,
      memory.memory_uuid,
      (id) => memoryStore.getMemory(id),
      qdrantService,
      executionId
    );
    return mapLayerPayloadShapeToForwardView(memoryStore, executionId, {
      must_obey: payload.retry_count < 3,
      current_step: payload.current_step,
      challenge: payload.challenge,
      message: previousBlock.message,
      next_action: payload.next_action,
      error_code: previousBlock.error_code || 'MISSING_PROOF',
      retry_count: payload.retry_count
    });
  }
  if (qdrantService && !submissionOutcome.alreadyRecorded) {
    await updateStepQuality(qdrantService, memory, 'success', tenantId);
  }

  const tensorOut = solutionToTensorValue(input.solution);
  const executionMeta = await forwardRuntimeStore.getExecution(executionId);
  await appendExecutionTrace(
    executionId,
    memory,
    input.solution,
    executionMeta?.activation_query,
    {},
    tensorOut
  );

  return buildPostSubmissionView({
    memoryStore,
    currentMemory: memory,
    executionId,
    qdrantService,
    ...(submissionOutcome.proofHash ? { proofHash: submissionOutcome.proofHash } : {})
  });
}
