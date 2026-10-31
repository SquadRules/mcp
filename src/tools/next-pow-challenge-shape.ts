import type { ProofOfWorkDefinition, ProofOfWorkType } from '../types/memory.js';
import { SquadrulesError } from '../types/index.js';
import { GENESIS_HASH } from './squadrules-genesis-proof-hash.js';
import {
  buildShellChallengeArgv,
  formatShellInvocationForDisplay,
  pickShellChallengeFields,
  SHELL_INTERPRETERS
} from './shell-challenge-invocation.js';

/** A subagent.mcp entry as the challenge output schema accepts it. */
interface SubagentMcpTool {
  tool_name: string;
  arguments?: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Filter a stored subagent.mcp list down to entries the challenge output
 * schema accepts. tune persists inference_contract data without the
 * train-time validator, so the stored value is untrusted: a non-array value
 * (or entries without a usable tool_name, or with a non-object arguments)
 * is skipped, not rendered and not crashed on (ADR 0029).
 */
function validSubagentMcpTools(stored: unknown): SubagentMcpTool[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (entry): entry is SubagentMcpTool =>
      isPlainObject(entry) &&
      typeof entry['tool_name'] === 'string' &&
      entry['tool_name'].trim().length > 0 &&
      (entry['arguments'] === undefined || isPlainObject(entry['arguments']))
  );
}

/** Build challenge shape from proof only (no nonce, no store). Used by forward / next proof flow. */
export function buildChallengeShapeForDisplay(proof?: ProofOfWorkDefinition): Record<string, unknown> {
  const base: Record<string, unknown> = proof ? (() => {
    const proofType: ProofOfWorkType = proof.type ?? 'shell';
    const result: Record<string, unknown> = { type: proofType, description: '' };
    if (proofType === 'shell') {
      const cmd = proof.shell?.cmd || proof.cmd || 'No command specified';
      const timeout = proof.shell?.timeout_seconds || proof.timeout_seconds || 30;
      const rawInterpreter = proof.shell?.interpreter?.trim();
      // Only an interpreter from the allowed set may reach the wire: the output
      // schema is an enum, so an unknown value would be rejected wholesale and
      // the caller would lose the whole response (ADR 0026).
      const interpreterKnown =
        !!rawInterpreter && (SHELL_INTERPRETERS as readonly string[]).includes(rawInterpreter);
      const shellOut: Record<string, unknown> = { cmd, timeout_seconds: timeout };
      if (interpreterKnown && rawInterpreter) {
        shellOut['interpreter'] = rawInterpreter;
        // The argv a contract runs is fully specified by the contract (ADR 0026):
        // render the exact invocation so the caller never guesses a wrapper.
        const shellFields = pickShellChallengeFields({
          cmd,
          interpreter: rawInterpreter,
          flags: proof.shell?.flags,
          args: proof.shell?.args,
          workdir: proof.shell?.workdir
        });
        const invocation = formatShellInvocationForDisplay(buildShellChallengeArgv(shellFields));
        shellOut['invocation_display'] = invocation;
        result['description'] =
          `Shell contract (timeout ${timeout}s): run exactly: ${invocation}. ` +
          `Capture stdout and stderr (do not suppress stderr); exit_code 0 = pass. ` +
          `Report the real exit_code/stdout/stderr; do not fabricate.` +
          ` Before running, ensure the interpreter is on PATH (e.g. \`which ${rawInterpreter}\`); if not found, fail with a clear local error.`;
      } else {
        // An absent or unknown interpreter is an invalid contract (ADR 0026),
        // never a request for `bash`. Say so instead of rendering a guessable command.
        result['description'] =
          `Shell contract (timeout ${timeout}s): this contract names no usable interpreter, so its argv is unspecified. ` +
          `It is invalid (ADR 0026) and must not be run by guessing a wrapper: re-train the adapter with ` +
          `\`train\` (force_update) and a shell.interpreter of bash, sh, python3, python, or node, then retry. ` +
          `Command text: ${cmd}`;
      }
      if (proof.shell?.flags && proof.shell.flags.length > 0) shellOut['flags'] = proof.shell.flags;
      if (proof.shell?.args && proof.shell.args.length > 0) shellOut['args'] = proof.shell.args;
      const workdir = proof.shell?.workdir?.trim();
      if (workdir) {
        shellOut['workdir'] = workdir;
        result['description'] += ` Use workdir "${workdir}" as the process working directory after expanding env vars. If the workdir path is not a directory or expansion leaves an empty path, fail with a clear local error.`;
      }
      result['shell'] = shellOut;
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
      const mcpTools = validSubagentMcpTools(proof.subagent?.mcp);
      const toolHint = mcpTools.length > 0
        ? ` The subagent must call these MCP tools: ${mcpTools.map(t => t.tool_name).join(', ')}.`
        : '';
      result['description'] = `Delegate this task to a subagent and return its actual report. Do not perform the task yourself.${context ? ` Context: ${context}` : ''}${toolHint}`;
      result['subagent'] = { context, ...(mcpTools.length > 0 ? { mcp: mcpTools } : {}) };
    } else {
      // Unknown-type guard: a stale stored type (e.g. "mcp" from before the
      // forward rename) cannot satisfy the challenge output schema's type
      // enum, so a returned shape would fail SDK output validation and the
      // caller would never see the recovery message. Fail closed with a
      // SquadrulesError; the forward tool registration renders it as an
      // isError response (ADR 0028).
      const storedType = String(proofType);
      const renameHint = storedType === 'mcp' ? ' It was trained before the mcp→forward rename.' : '';
      throw new SquadrulesError(
        `Unsupported contract type "${storedType}".${renameHint} Re-train this adapter with a current contract type (shell, forward, user_input, comment, or subagent).`,
        'UNSUPPORTED_CONTRACT_TYPE',
        422
      );
    }
    return result;
  })() : {
    type: 'comment' as ProofOfWorkType,
    description: 'Provide a verification comment describing how you completed this step. Write a genuine summary; do not paste unrelated text.'
  };
  base['proof_hash'] = GENESIS_HASH;
  return base;
}
