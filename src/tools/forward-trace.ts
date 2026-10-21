import type { Memory, TensorValue } from '../types/memory.js';
import { getAdapterId, getLayerIndex } from '../services/memory/memory-accessors.js';
import { executionTraceStore } from '../services/execution-trace-store.js';
import { extractMemoryBody } from '../utils/memory-body.js';
import { structuredLogger } from '../utils/structured-logger.js';
import type { ForwardSolution } from './forward_schema.js';
import { buildAdapterUri, buildLayerUri } from './squadrules-uri.js';

function traceFireAndForget(op: Promise<void>): void {
  op.catch((err) => {
    structuredLogger.warn(
      `[trace] Persistence failed, data lost: ${err instanceof Error ? err.message : String(err)}`
    );
  });
}

export function solutionToTensorValue(solution: ForwardSolution): TensorValue | undefined {
  const evidence = solution.evidence;
  const hasEvidence =
    evidence !== null && evidence !== undefined && typeof evidence === 'object' && !Array.isArray(evidence);
  const e = hasEvidence ? (evidence as Record<string, unknown>) : undefined;
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
