// squadrules-compat-surface: dual-emits the kairos_local_artifact_dir JSON field expected by existing clients
import type { InferenceContractDefinition, Memory } from '../types/memory.js';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { getAdapterName, getInferenceContract, getLayerCount, getLayerIndex } from '../services/memory/memory-accessors.js';
import { spaceIdToDisplayName } from '../utils/space-display.js';
import { getSpaceContextFromStorage } from '../utils/tenant-context.js';
import { extractMemoryBody } from '../utils/memory-body.js';
import { buildChallenge, type ProofOfWorkSubmission } from './next-pow-helpers.js';
import { forwardRuntimeStore } from '../services/forward-runtime-store.js';
import { proofOfWorkStore } from '../services/proof-of-work-store.js';
import type { ForwardOutput, ForwardSolution } from './forward_schema.js';
import { KAIROS_LOCAL_ARTIFACT_DIRS } from '../config.js';
import { buildLayerUri, parseSquadrulesUri } from './kairos-uri.js';
import { buildLocalArtifactDirFields } from './local-artifact-dir-contract.js';
import { buildEvidenceHint, buildEmptySolutionTemplate } from './forward-helpers.js';

export function extractUuid(uri: string): string {
  return uri.split('/').pop()?.split('?')[0] ?? '';
}
export function buildForwardUiSummary(memory: Memory): {
  activation_space_name?: string;
  context_adapter_name?: string;
  current_layer_label?: string;
  adapter_layer_index?: number;
  adapter_layer_count?: number;
} {
  const activation_space_name = memory.space_id
    ? spaceIdToDisplayName(memory.space_id, getSpaceContextFromStorage().spaceNamesById)
    : undefined;
  const adapterTitle = getAdapterName(memory)?.trim();
  const context_adapter_name = adapterTitle || undefined;
  const layerLabel = memory.label?.trim();
  const current_layer_label = layerLabel || undefined;
  const adapter_layer_index = getLayerIndex(memory);
  const adapter_layer_count = getLayerCount(memory);
  return {
    ...(activation_space_name ? { activation_space_name } : {}),
    ...(context_adapter_name ? { context_adapter_name } : {}),
    ...(current_layer_label ? { current_layer_label } : {}),
    adapter_layer_index,
    adapter_layer_count
  };
}

export function buildCurrentLayerView(memory: Memory, uri: string) {
  return {
    uri,
    content: extractMemoryBody(memory.text),
    mimeType: 'text/markdown' as const
  };
}
function currentLayer(memory: Memory, executionId: string) {
  return {
    uri: buildLayerUri(memory.memory_uuid, executionId),
    content: extractMemoryBody(memory.text),
    mimeType: 'text/markdown' as const
  };
}
export function normalizeContract(memory: Memory): InferenceContractDefinition | undefined {
  return getInferenceContract(memory);
}
function summarizeContract(contract: InferenceContractDefinition): string {
  if (contract.type === 'tensor') {
    const outputName = contract.tensor?.output.name ?? 'tensor';
    const outputType = contract.tensor?.output.type ?? 'unknown';
    return `Produce tensor ${outputName} (${outputType})`;
  }
  if (contract.type === 'shell') {
    return `Execute shell command: ${contract.shell?.cmd ?? contract.cmd ?? 'unknown command'}`;
  }
  if (contract.type === 'mcp') {
    const tool = contract.mcp?.tool_name ?? 'unknown tool';
    const args = contract.mcp?.arguments;
    const argsBit = args !== undefined ? ` (arguments: ${JSON.stringify(args)})` : '';
    return `Call MCP tool: ${tool}${argsBit}`;
  }
  if (contract.type === 'user_input') {
    return `Collect user input: ${contract.user_input?.prompt ?? 'confirmation required'}`;
  }
  return `Provide a verification comment (${contract.comment?.min_length ?? 10}+ chars)`;
}

export function mapProofSolution(solution: ForwardSolution): ProofOfWorkSubmission {
  const evidence = solution.evidence;
  const e =
    evidence !== null && evidence !== undefined && typeof evidence === 'object' && !Array.isArray(evidence)
      ? (evidence as Record<string, unknown>)
      : undefined;
  const nonce = solution.nonce ?? (e && typeof e['nonce'] === 'string' ? e['nonce'] : undefined);
  const proofHash = solution.proof_hash ?? (e && typeof e['proof_hash'] === 'string' ? e['proof_hash'] : undefined);
  const base: ProofOfWorkSubmission = {
    type: solution.type as ProofOfWorkSubmission['type'],
    ...(nonce ? { nonce } : {}),
    ...(proofHash ? { proof_hash: proofHash } : {})
  };

  if (solution.type === 'shell' && e && typeof e['exit_code'] === 'number') {
    base.shell = {
      exit_code: e['exit_code'],
      ...(typeof e['stdout'] === 'string' ? { stdout: e['stdout'] } : {}),
      ...(typeof e['stderr'] === 'string' ? { stderr: e['stderr'] } : {}),
      ...(typeof e['duration_seconds'] === 'number' ? { duration_seconds: e['duration_seconds'] } : {})
    };
  } else if (solution.type === 'mcp' && e && typeof e['tool_name'] === 'string') {
    const outcomeSuccess = solution.outcome === undefined ? true : solution.outcome === 'success';
    base.mcp = {
      tool_name: e['tool_name'],
      ...(e['arguments'] !== undefined ? { arguments: e['arguments'] } : {}),
      result: e['response'] !== undefined ? e['response'] : (e['result'] ?? null),
      success: typeof e['success'] === 'boolean' ? e['success'] : outcomeSuccess
    };
  } else if (solution.type === 'user_input' && e && typeof e['confirmation'] === 'string') {
    base.user_input = {
      confirmation: e['confirmation'],
      ...(typeof e['timestamp'] === 'string' ? { timestamp: e['timestamp'] } : {})
    };
  } else if (solution.type === 'comment' && e) {
    const commentText = typeof e['text'] === 'string' ? e['text'] : typeof e['comment'] === 'string' ? e['comment'] : undefined;
    if (commentText) base.comment = { text: commentText };
  }

  if (base.shell === undefined && solution.shell) {
    base.shell = {
      exit_code: solution.shell.exit_code,
      ...(solution.shell.stdout !== undefined ? { stdout: solution.shell.stdout } : {}),
      ...(solution.shell.stderr !== undefined ? { stderr: solution.shell.stderr } : {}),
      ...(solution.shell.duration_seconds !== undefined ? { duration_seconds: solution.shell.duration_seconds } : {})
    };
  }
  if (base.mcp === undefined && solution.mcp) base.mcp = solution.mcp;
  if (base.user_input === undefined && solution.user_input) {
    base.user_input = {
      confirmation: solution.user_input.confirmation,
      ...(solution.user_input.timestamp !== undefined ? { timestamp: solution.user_input.timestamp } : {})
    };
  }
  if (base.comment === undefined && solution.comment) base.comment = solution.comment;
  return base;
}

export type LoadMemoryForParsedUriResult = {
  memory: Memory | null;
  slug_disambiguation_note?: string;
};

export async function loadMemoryForParsedUri(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  parsed: ReturnType<typeof parseSquadrulesUri>
): Promise<LoadMemoryForParsedUriResult> {
  if (parsed.kind === 'layer') {
    const memory = await memoryStore.getMemory(parsed.id);
    return { memory };
  }
  if (!qdrantService) {
    throw new Error('Adapter resolution requires qdrantService');
  }
  if (parsed.idKind === 'slug') {
    const outcome = await qdrantService.findFirstStepMemoryUuidBySlug(parsed.id);
    if (!outcome.layerUuid) {
      return { memory: null };
    }
    const memory = await memoryStore.getMemory(outcome.layerUuid);
    return {
      memory,
      ...(outcome.disambiguation_note ? { slug_disambiguation_note: outcome.disambiguation_note } : {})
    };
  }
  const layers = await qdrantService.getAdapterLayers(parsed.id);
  const firstLayer = layers[0]?.uuid;
  if (firstLayer) {
    const memory = await memoryStore.getMemory(firstLayer);
    return { memory };
  }
  const memory = await memoryStore.getMemory(parsed.id);
  return { memory };
}
async function challengeReuseOptions(memory: Memory): Promise<{ existingNonce: string } | undefined> {
  if (!memory.memory_uuid) return undefined;
  const existing = await proofOfWorkStore.getNonce(memory.memory_uuid);
  return existing != null ? { existingNonce: existing } : undefined;
}
async function buildContractResponse(
  memory: Memory,
  executionId: string,
  proofHash?: string
): Promise<{ contract: ForwardOutput['contract']; tensorIn?: Record<string, unknown> }> {
  const storedContract = normalizeContract(memory);
  if (!storedContract) {
    const reuse = await challengeReuseOptions(memory);
    const fallback = await buildChallenge(memory, undefined, reuse);
    if (proofHash) {
      fallback.proof_hash = proofHash;
    }
    return { contract: fallback };
  }

  if (storedContract.type === 'tensor') {
    const requiredInputs = storedContract.tensor?.required_inputs ?? [];
    const tensorIn = executionId
      ? await forwardRuntimeStore.requireTensorInputs(executionId, requiredInputs)
      : {};
    return {
      contract: {
        type: 'tensor',
        required: storedContract.required,
        description: summarizeContract(storedContract),
        tensor: storedContract.tensor
      },
      tensorIn
    };
  }

  const reuse = await challengeReuseOptions(memory);
  const challenge = await buildChallenge(memory, storedContract, reuse);
  if (proofHash) {
    challenge.proof_hash = proofHash;
  }
  return { contract: challenge };
}

function finalContract(): ForwardOutput['contract'] {
  return {
    type: 'comment',
    required: false,
    description: 'Execution complete. Call reward to finalize.'
  };
}

export type BuildForwardViewOptions = {
  final?: boolean;
  message?: string;
  proofHash?: string;
  errorCode?: string;
  retryCount?: number;
  mustObey?: boolean;
  contractOverride?: ForwardOutput['contract'];
  tensorInOverride?: Record<string, unknown>;
  slugDisambiguationNote?: string;
};

export async function buildForwardView(
  memory: Memory,
  executionId: string,
  options?: BuildForwardViewOptions
): Promise<ForwardOutput> {
  const { contract, tensorIn } = options?.contractOverride
    ? { contract: options.contractOverride, tensorIn: options.tensorInOverride }
    : options?.final
      ? { contract: finalContract(), tensorIn: undefined }
      : await buildContractResponse(memory, executionId, options?.proofHash);
  const layer = currentLayer(memory, executionId);
  const final = options?.final === true;
  const meta = await forwardRuntimeStore.getExecution(executionId);
  const slugNote = options?.slugDisambiguationNote ?? meta?.slug_disambiguation_note;
  const nextCall = final
    ? {
        kind: 'reward' as const,
        args: {
          uri: layer.uri,
          outcome_template: {
            outcome: 'success' as const
          }
        }
      }
    : {
        kind: 'forward' as const,
        args: {
          uri: layer.uri,
          solution_template: buildEmptySolutionTemplate(contract.type)
        }
      };
  return {
    must_obey: options?.mustObey ?? true,
    current_layer: layer,
    contract,
    next_call: nextCall,
    ...(tensorIn && Object.keys(tensorIn).length > 0 ? { tensor_in: tensorIn } : {}),
    ...buildForwardUiSummary(memory),
    ...buildLocalArtifactDirFields(KAIROS_LOCAL_ARTIFACT_DIRS),
    next_action: final
      ? `call reward with ${layer.uri} and outcome (success or failure) and feedback to complete the adapter`
      : `call forward with ${layer.uri} and solution.type="${contract.type}", outcome="success", evidence${buildEvidenceHint(contract.type)}, and include nonce/proof_hash from contract`,
    execution_id: executionId,
    ...(options?.proofHash && { proof_hash: options.proofHash }),
    ...(options?.message ? { message: options.message } : {}),
    ...(options?.errorCode && { error_code: options.errorCode }),
    ...(options?.retryCount !== undefined && { retry_count: options.retryCount }),
    ...(slugNote ? { slug_disambiguation_note: slugNote } : {})
  };
}
export async function mapLayerPayloadShapeToForwardView(
  memoryStore: MemoryQdrantStore,
  executionId: string,
  nextExecutionResult: LayerPayload
): Promise<ForwardOutput> {
  const currentLayerId = nextExecutionResult.current_step?.uri
    ? extractUuid(nextExecutionResult.current_step.uri)
    : '';
  const displayMemory = currentLayerId ? await memoryStore.getMemory(currentLayerId) : null;
  if (!displayMemory || !nextExecutionResult.current_step) {
    throw new Error('Layer payload did not include a resolvable current layer');
  }
  const final = nextExecutionResult.next_action.includes('reward');
  const displayContract = normalizeContract(displayMemory);
  const options: BuildForwardViewOptions = {
    final,
    ...(nextExecutionResult.message
      ? {
          message: nextExecutionResult.message
            .replaceAll('protocol', 'adapter')
            .replaceAll('Protocol', 'Adapter')
        }
      : {}),
    ...(nextExecutionResult.proof_hash ? { proofHash: nextExecutionResult.proof_hash } : {}),
    ...(nextExecutionResult.error_code ? { errorCode: nextExecutionResult.error_code } : {}),
    ...(nextExecutionResult.retry_count !== undefined ? { retryCount: nextExecutionResult.retry_count } : {}),
    mustObey: nextExecutionResult.must_obey,
    ...(!final && displayContract?.type !== 'tensor' && { contractOverride: nextExecutionResult.challenge })
  };
  return buildForwardView(displayMemory, executionId, options);
}
export interface LayerPayload {
  must_obey: boolean;
  current_step?: {
    uri: string;
    content: string;
    mimeType: 'text/markdown';
  } | null;
  challenge: ForwardOutput['contract'];
  next_action: string;
  proof_hash?: string;
  message?: string;
  error_code?: string;
  retry_count?: number;
}
export async function mapLayerPayloadToForwardView(
  memoryStore: MemoryQdrantStore,
  executionId: string,
  nextExecutionResult: LayerPayload
): Promise<ForwardOutput> {
  return mapLayerPayloadShapeToForwardView(memoryStore, executionId, nextExecutionResult);
}
