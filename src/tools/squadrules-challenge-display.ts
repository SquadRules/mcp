import type { ProofOfWorkDefinition, ProofOfWorkType } from '../types/memory.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { GENESIS_HASH } from './squadrules-genesis-proof-hash.js';
import {
  buildShellChallengeArgv,
  formatShellInvocationForDisplay,
  pickShellChallengeFields
} from './shell-challenge-invocation.js';

/** Safe fragment inside backticks in description text. */
function shellQuoteForDesc(s: string): string {
  return s.replace(/[`$\\]/g, '');
}

function isAllowedStoredChallengeType(t: unknown): t is ProofOfWorkType {
  return t === 'shell' || t === 'mcp' || t === 'user_input' || t === 'comment';
}

/** Build challenge shape from proof only (no nonce, no store). For read-only display e.g. export. */
export function buildChallengeShapeForDisplay(proof?: ProofOfWorkDefinition): Record<string, unknown> {
  const base: Record<string, unknown> = proof ? (() => {
    let proofType: ProofOfWorkType;
    if (proof.type === undefined) {
      proofType = 'shell';
    } else if (isAllowedStoredChallengeType(proof.type)) {
      proofType = proof.type;
    } else {
      structuredLogger.warn(
        { event: 'invalid_stored_challenge_type', storedType: proof.type },
        'Invalid stored contract type in adapter layer; coercing to comment for MCP output schema compliance'
      );
      proofType = 'comment';
    }
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
      let description = `Shell contract (timeout ${timeout}s): run exactly: ${invocationLine}. Capture stdout and stderr (do not suppress stderr); exit_code 0 = pass. Report real exit_code/stdout/stderr; do not fabricate.`;
      const interpTrim = interpreter?.trim();
      if (interpTrim) {
        description += ` Before running, ensure the interpreter is on PATH (e.g. \`which ${shellQuoteForDesc(interpTrim)}\`); if not found, fail with a clear local error.`;
      }
      const wd = workdir?.trim();
      if (wd) {
        description += ` Use workdir "${wd}" as the process working directory after expanding env vars. This is real cwd behavior, not the shared local artifact directory. When a contract also refers to local handoff files, pick a hint from the latest activate/forward/next response field squadrules_local_artifact_dir (an ordered list of project://<rel> and user://<rel> URIs), resolve it on your machine (project://<rel> -> <project root>/<rel>; user://<rel> -> <home or $XDG_CONFIG_HOME>/<rel>), and export SQUADRULES_LOCAL_ARTIFACT_DIR to the absolute path unless your shell already defines it. If the workdir path does not exist, is not a directory, or expansion leaves an empty path, fail with a clear local error.`;
      }
      result['description'] = description;
      const shellOut: Record<string, unknown> = { cmd, timeout_seconds: timeout };
      if (interpreter !== undefined && interpreter !== '') shellOut['interpreter'] = interpreter;
      if (flags !== undefined && flags.length > 0) shellOut['flags'] = flags;
      if (args !== undefined && args.length > 0) shellOut['args'] = args;
      if (workdir !== undefined && workdir !== '') shellOut['workdir'] = workdir;
      shellOut['invocation_display'] = invocationLine;
      result['shell'] = shellOut;
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
