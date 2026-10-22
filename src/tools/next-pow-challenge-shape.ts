import type { ProofOfWorkDefinition, ProofOfWorkType } from '../types/memory.js';
import { GENESIS_HASH } from './squadrules-genesis-proof-hash.js';

/** Build challenge shape from proof only (no nonce, no store). Used by forward / next proof flow. */
export function buildChallengeShapeForDisplay(proof?: ProofOfWorkDefinition): Record<string, unknown> {
  const base: Record<string, unknown> = proof ? (() => {
    const proofType: ProofOfWorkType = proof.type ?? 'shell';
    const result: Record<string, unknown> = { type: proofType, description: '' };
    if (proofType === 'shell') {
      const cmd = proof.shell?.cmd || proof.cmd || 'No command specified';
      const timeout = proof.shell?.timeout_seconds || proof.timeout_seconds || 30;
      result['description'] = `Execute shell command: ${cmd}. You MUST actually run this command and report the real exit_code/stdout/stderr; do not fabricate.`;
      result['shell'] = { cmd, timeout_seconds: timeout };
    } else if (proofType === 'forward') {
      const target = proof.forward?.target || 'No target specified';
      result['description'] = `Forward to adapter ${target}. You MUST actually call the forward tool with this target and report the real result; do not fabricate.`;
      const fwdOut: Record<string, unknown> = { target };
      if (proof.forward?.expected_result !== undefined) fwdOut['expected_result'] = proof.forward.expected_result;
      result['forward'] = fwdOut;
    } else if (proofType === 'user_input') {
      const prompt = proof.user_input?.prompt || 'Confirm completion';
      result['description'] = `User confirmation: ${prompt}. You MUST show this prompt to the user and use only their reply as evidence.confirmation; do not assume or invent it.`;
      result['user_input'] = { prompt };
    } else if (proofType === 'comment') {
      const minLength = proof.comment?.min_length || 10;
      result['description'] = `Provide a verification comment (minimum ${minLength} characters) that genuinely summarises what was done in this step; do not paste unrelated text.`;
      result['comment'] = { min_length: minLength };
    } else if (proofType === 'subagent') {
      const context = proof.subagent?.context ?? '';
      const mcpTools = proof.subagent?.mcp;
      const toolHint = mcpTools && mcpTools.length > 0
        ? ` The subagent must call these MCP tools: ${mcpTools.map(t => t.tool_name).join(', ')}.`
        : '';
      result['description'] = `Delegate this task to a subagent and return its actual report. Do not perform the task yourself.${context ? ` Context: ${context}` : ''}${toolHint}`;
      result['subagent'] = { context, ...(mcpTools ? { mcp: mcpTools } : {}) };
    } else {
      // Unknown-type guard: stale stored type (e.g. "mcp") gets a clear message
      result['description'] = `Unsupported contract type "${proofType}". This adapter must be re-trained with a current contract type (shell, forward, user_input, comment, or subagent).`;
    }
    return result;
  })() : {
    type: 'comment' as ProofOfWorkType,
    description: 'Provide a verification comment describing how you completed this step. Write a genuine summary; do not paste unrelated text.'
  };
  base['proof_hash'] = GENESIS_HASH;
  return base;
}
