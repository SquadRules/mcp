import type { ProofOfWorkDefinition, ProofOfWorkType } from '../types/memory.js';
import { GENESIS_HASH } from './squadrules-genesis-proof-hash.js';
import {
  buildShellChallengeArgv,
  formatShellInvocationForDisplay,
  pickShellChallengeFields
} from './shell-challenge-invocation.js';

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
      const interpreter = proof.shell?.interpreter;
      const flags = proof.shell?.flags;
      const args = proof.shell?.args;
      const workdir = proof.shell?.workdir;
      const argv = buildShellChallengeArgv(
        pickShellChallengeFields({ cmd, interpreter, flags, args, workdir })
      );
      const invocationLine = formatShellInvocationForDisplay(argv);
      let description = `Shell contract (timeout ${timeout}s): run exactly: ${invocationLine}. You MUST actually run this command and report the real exit_code/stdout/stderr; do not fabricate.`;
      const interpTrim = interpreter?.trim();
      if (interpTrim) {
        description += ` Before running, ensure the interpreter is on PATH (e.g. \`which ${interpTrim}\`); if not found, fail with a clear local error.`;
      }
      result['description'] = description;
      const shellOut: Record<string, unknown> = { cmd, timeout_seconds: timeout };
      if (interpreter !== undefined) shellOut['interpreter'] = interpreter;
      if (flags !== undefined && flags.length > 0) shellOut['flags'] = flags;
      if (args !== undefined && args.length > 0) shellOut['args'] = args;
      if (workdir !== undefined && workdir !== '') shellOut['workdir'] = workdir;
      shellOut['invocation_display'] = invocationLine;
      result['shell'] = shellOut;
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
      result['description'] = `Delegate this task to a subagent and return its actual report. Do not perform the task yourself.${context ? ` Context: ${context}` : ''}`;
      result['subagent'] = { context };
    }
    return result;
  })() : {
    type: 'comment' as ProofOfWorkType,
    description: 'Provide a verification comment describing how you completed this step. Write a genuine summary; do not paste unrelated text.'
  };
  base['proof_hash'] = GENESIS_HASH;
  return base;
}
