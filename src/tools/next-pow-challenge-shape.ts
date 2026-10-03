import type { ProofOfWorkDefinition, ProofOfWorkType } from '../types/memory.js';
import { GENESIS_HASH } from './squadrules-genesis-proof-hash.js';

/** Build challenge shape from proof only (no nonce, no store). Used by forward / next proof flow. */
export function buildChallengeShapeForDisplay(proof?: ProofOfWorkDefinition): Record<string, unknown> {
  const base: Record<string, unknown> = proof ? (() => {
    if (proof.type === 'tensor') {
      return {
        type: 'tensor',
        description: `Emit tensor output "${proof.tensor?.output.name ?? 'unnamed'}".`,
        ...(proof.tensor ? { tensor: proof.tensor } : {})
      };
    }
    const proofType: ProofOfWorkType = proof.type ?? 'shell';
    const result: Record<string, unknown> = { type: proofType, description: '' };
    if (proofType === 'shell') {
      const cmd = proof.shell?.cmd || proof.cmd || 'No command specified';
      const timeout = proof.shell?.timeout_seconds || proof.timeout_seconds || 30;
      result['description'] = `Execute shell command: ${cmd}. You MUST actually run this command and report the real exit_code/stdout/stderr; do not fabricate.`;
      result['shell'] = { cmd, timeout_seconds: timeout };
    } else if (proofType === 'mcp') {
      const toolName = proof.mcp?.tool_name || 'No tool specified';
      const argsHint =
        proof.mcp?.arguments !== undefined
          ? ` Include solution.evidence.arguments matching (subset of) ${JSON.stringify(proof.mcp.arguments)}.`
          : '';
      result['description'] = `Call MCP tool: ${toolName}.${argsHint} You MUST actually call this tool and report its real result; do not fabricate.`;
      const mcpOut: Record<string, unknown> = { tool_name: toolName, expected_result: proof.mcp?.expected_result };
      if (proof.mcp?.arguments !== undefined) mcpOut['arguments'] = proof.mcp.arguments;
      result['mcp'] = mcpOut;
    } else if (proofType === 'user_input') {
      const prompt = proof.user_input?.prompt || 'Confirm completion';
      result['description'] = `User confirmation: ${prompt}. You MUST show this prompt to the user and use only their reply as evidence.confirmation; do not assume or invent it.`;
      result['user_input'] = { prompt };
    } else if (proofType === 'comment') {
      const minLength = proof.comment?.min_length || 10;
      result['description'] = `Provide a verification comment (minimum ${minLength} characters) that genuinely summarises what was done in this step; do not paste unrelated text.`;
      result['comment'] = { min_length: minLength };
    }
    return result;
  })() : {
    type: 'comment' as ProofOfWorkType,
    description: 'Provide a verification comment describing how you completed this step. Write a genuine summary; do not paste unrelated text.'
  };
  base['proof_hash'] = GENESIS_HASH;
  return base;
}
