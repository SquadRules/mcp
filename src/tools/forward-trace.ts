import crypto from 'node:crypto';
import type { Memory, TensorValue } from '../types/memory.js';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import { getAdapterId, getInferenceContract, getLayerIndex } from '../services/memory/memory-accessors.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { resolveAdapterNextLayer } from '../services/adapter-navigation.js';
import { executionTraceStore } from '../services/execution-trace-store.js';
import { forwardRuntimeStore } from '../services/forward-runtime-store.js';
import { proofOfWorkStore } from '../services/proof-of-work-store.js';
import { extractMemoryBody } from '../utils/memory-body.js';
import { structuredLogger } from '../utils/structured-logger.js';
import type { ForwardOutput, ForwardSolution } from './forward_schema.js';
import { buildAdapterUri, buildLayerUri } from './squadrules-uri.js';
import { buildForwardView } from './forward-view.js';

function traceFireAndForget(op: Promise<void>): void {
  op.catch((err) => {
    structuredLogger.warn(
      `[trace] Persistence failed, data lost: ${err instanceof Error ? err.message : String(err)}`
    );
  });
}

function tensorProofHash(executionId: string, layerId: string, tensor: TensorValue): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        execution_id: executionId,
        layer_id: layerId,
        tensor_name: tensor.name,
        tensor_value: tensor.value
      })
    )
    .digest('hex');
}

export function solutionToTensorValue(solution: ForwardSolution): TensorValue | undefined {
  const evidence = solution.evidence;
  const hasEvidence =
    evidence !== null && evidence !== undefined && typeof evidence === 'object' && !Array.isArray(evidence);
  const e = hasEvidence ? (evidence as Record<string, unknown>) : undefined;
  if (solution.tensor) {
    return solution.tensor;
  }
  if (solution.type === 'tensor' && e && typeof e['name'] === 'string' && 'value' in e) {
    return { name: e['name'], value: e['value'] };
  }
  if (solution.comment) {
    return { name: 'comment', value: solution.comment.text };
  }
  if (solution.type === 'comment' && e) {
    const commentVal = typeof e['text'] === 'string' ? e['text'] : typeof e['comment'] === 'string' ? e['comment'] : undefined;
    if (commentVal) return { name: 'comment', value: commentVal };
  }
  if (solution.user_input) {
    return { name: 'user_input', value: solution.user_input.confirmation };
  }
  if (solution.type === 'user_input' && e && typeof e['confirmation'] === 'string') {
    return { name: 'user_input', value: e['confirmation'] };
  }
  if (solution.shell) {
    return { name: 'shell_result', value: solution.shell };
  }
  if (solution.type === 'shell' && e && typeof e['exit_code'] === 'number') {
    return {
      name: 'shell_result',
      value: {
        exit_code: e['exit_code'],
        ...(typeof e['stdout'] === 'string' ? { stdout: e['stdout'] } : {}),
        ...(typeof e['stderr'] === 'string' ? { stderr: e['stderr'] } : {}),
        ...(typeof e['duration_seconds'] === 'number' ? { duration_seconds: e['duration_seconds'] } : {})
      }
    };
  }
  if (solution.mcp) {
    return { name: 'mcp_result', value: solution.mcp };
  }
  if (solution.type === 'mcp' && e && typeof e['tool_name'] === 'string') {
    return {
      name: 'mcp_result',
      value: {
        tool_name: e['tool_name'],
        ...(e['arguments'] !== undefined ? { arguments: e['arguments'] } : {}),
        ...(e['response'] !== undefined ? { response: e['response'] } : {}),
        ...(e['result'] !== undefined ? { result: e['result'] } : {}),
        ...(typeof e['success'] === 'boolean' ? { success: e['success'] } : {})
      }
    };
  }
  return undefined;
}

export async function appendExecutionTrace(
  executionId: string,
  memory: Memory,
  solution: ForwardSolution,
  activationQuery?: string,
  tensorIn: Record<string, unknown> = {},
  tensorOut?: TensorValue
): Promise<void> {
  const adapterId = getAdapterId(memory);
  traceFireAndForget(executionTraceStore.appendTrace({
    execution_id: executionId,
    adapter_uri: buildAdapterUri(adapterId),
    layer_uri: buildLayerUri(memory.memory_uuid, executionId),
    layer_index: getLayerIndex(memory),
    created_at: new Date().toISOString(),
    ...(activationQuery ? { activation_query: activationQuery } : {}),
    layer_instructions: extractMemoryBody(memory.text),
    tensor_in: tensorIn,
    ...(tensorOut && { tensor_out: tensorOut }),
    ...(solution.trace && { trace: solution.trace }),
    raw_solution: solution,
    merge_depth: 0
  }));
}

function evaluateCondition(condition: string | undefined, tensorIn: Record<string, unknown>): boolean {
  if (!condition) {
    return true;
  }

  const containsMatch = condition.match(/^([A-Za-z0-9_]+)\s+contains\s+'([^']+)'$/i);
  if (containsMatch?.[1] && containsMatch[2]) {
    const candidate = tensorIn[containsMatch[1]];
    return typeof candidate === 'string' && candidate.includes(containsMatch[2]);
  }

  return true;
}

export async function handleTensorForward(
  memoryStore: MemoryQdrantStore,
  memory: Memory,
  executionId: string,
  solution: ForwardSolution,
  qdrantService: QdrantService | undefined
): Promise<ForwardOutput> {
  const contract = getInferenceContract(memory);
  if (!contract?.tensor) {
    throw new Error('Tensor forward requires a tensor contract');
  }
  let tensor = solution.tensor;
  if (!tensor) {
    const evidence = solution.evidence;
    const hasEvidence =
      evidence !== null && evidence !== undefined && typeof evidence === 'object' && !Array.isArray(evidence);
    const e = hasEvidence ? (evidence as Record<string, unknown>) : undefined;
    if (solution.type === 'tensor' && e && typeof e['name'] === 'string' && 'value' in e) {
      tensor = { name: e['name'], value: e['value'] } as any;
    }
  }
  if (!tensor) {
    throw new Error('Tensor forward requires tensor output (use solution.tensor or evidence.name/value).');
  }

  const tensorIn = await forwardRuntimeStore.requireTensorInputs(executionId, contract.tensor.required_inputs);
  if (!evaluateCondition(contract.tensor.condition, tensorIn)) {
    const next = await resolveAdapterNextLayer(memory, qdrantService);
    if (!next?.uuid) {
      return buildForwardView(memory, executionId, {
        final: true,
        message: 'Layer condition evaluated to false; no more layers remain.'
      });
    }
    const nextMemory = await memoryStore.getMemory(next.uuid);
    if (!nextMemory) {
      throw new Error(`Next layer ${next.uuid} could not be loaded`);
    }
    return buildForwardView(nextMemory, executionId, {
      message: 'Layer condition evaluated to false; moved to the next eligible layer.'
    });
  }

  if (tensor.name !== contract.tensor.output.name) {
    throw new Error(`Tensor name mismatch. Expected ${contract.tensor.output.name}, got ${tensor.name}`);
  }
  if (contract.tensor.output.type === 'string' && typeof tensor.value !== 'string') {
    throw new Error(`Tensor ${tensor.name} must be a string`);
  }
  if (contract.tensor.output.type === 'string[]' && !Array.isArray(tensor.value)) {
    throw new Error(`Tensor ${tensor.name} must be a string array`);
  }
  if (contract.tensor.output.min_length !== undefined && typeof tensor.value === 'string' && tensor.value.length < contract.tensor.output.min_length) {
    throw new Error(`Tensor ${tensor.name} is shorter than min_length`);
  }
  if (contract.tensor.output.max_length !== undefined && typeof tensor.value === 'string' && tensor.value.length > contract.tensor.output.max_length) {
    throw new Error(`Tensor ${tensor.name} exceeds max_length`);
  }
  if (contract.tensor.output.min_items !== undefined && Array.isArray(tensor.value) && tensor.value.length < contract.tensor.output.min_items) {
    throw new Error(`Tensor ${tensor.name} has fewer items than required`);
  }
  if (contract.tensor.output.max_items !== undefined && Array.isArray(tensor.value) && tensor.value.length > contract.tensor.output.max_items) {
    throw new Error(`Tensor ${tensor.name} exceeds max_items`);
  }

  await forwardRuntimeStore.setTensor(executionId, tensor.name, tensor.value);
  const proofHash = tensorProofHash(executionId, memory.memory_uuid, tensor);
  await proofOfWorkStore.setProofHash(memory.memory_uuid, proofHash);

  const executionMeta = await forwardRuntimeStore.getExecution(executionId);
  await appendExecutionTrace(
    executionId,
    memory,
    solution,
    executionMeta?.activation_query,
    tensorIn,
    tensor
  );

  const next = await resolveAdapterNextLayer(memory, qdrantService);
  if (!next?.uuid) {
    return buildForwardView(memory, executionId, {
      final: true,
      message: 'Adapter layers complete. Call reward to finalize.',
      proofHash
    });
  }

  const nextMemory = await memoryStore.getMemory(next.uuid);
  if (!nextMemory) {
    throw new Error(`Next layer ${next.uuid} could not be loaded`);
  }
  return buildForwardView(nextMemory, executionId, {
    message: 'Tensor stored. Continue with the next layer.',
    proofHash
  });
}
