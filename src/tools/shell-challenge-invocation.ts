/**
 * Build logical argv for shell challenges. Executors (agents/CLI) run this locally;
 * the MCP server does not spawn processes for PoW.
 */

export type ShellChallengeFields = {
  cmd?: string;
  /** Required (ADR 0026): an absent interpreter is an invalid contract, not a request for `bash`. */
  interpreter: ShellInterpreter;
  flags?: string[];
  args?: string[];
  workdir?: string;
};

/** Allowed shell interpreters for shell challenges (#103). */
export const SHELL_INTERPRETERS = ['bash', 'sh', 'python3', 'python', 'node'] as const;
export type ShellInterpreter = typeof SHELL_INTERPRETERS[number];

/** Clear error for the (post-validation, should-not-happen) case of a missing interpreter. */
function missingInterpreterError(): Error {
  return new Error(
    `shell contract is missing its required interpreter (one of: ${SHELL_INTERPRETERS.join(', ')})`
  );
}

/**
 * Normalize loose proof/UI fields into argv input without assigning `undefined`
 * to optional keys (required when `exactOptionalPropertyTypes` is enabled).
 * The interpreter is required (ADR 0026): a missing or blank value throws
 * rather than silently defaulting to `bash`.
 */
export function pickShellChallengeFields(shell: {
  cmd: string;
  interpreter?: string | undefined;
  flags?: string[] | undefined;
  args?: string[] | undefined;
  workdir?: string | undefined;
}): ShellChallengeFields {
  const interp = shell.interpreter?.trim();
  if (!interp) throw missingInterpreterError();
  const out: ShellChallengeFields = { cmd: shell.cmd, interpreter: interp as ShellInterpreter };
  if (shell.flags !== undefined) out.flags = shell.flags;
  if (shell.args !== undefined) out.args = shell.args;
  const wd = shell.workdir?.trim();
  if (wd) out.workdir = wd;
  return out;
}

function normalizedInterpreter(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  return t ? t : undefined;
}

/** Interpreters that use -c for inline script (auto-injected when absent). */
const INJECT_C = new Set(['python3', 'python', 'sh']);

/** Interpreters that use -e for inline script (auto-injected when absent). */
const INJECT_E = new Set(['node']);

function flagTokensLower(flags: string[] | undefined): Set<string> {
  const s = new Set<string>();
  for (const f of flags || []) {
    const m = f.match(/^-+(.+)$/);
    const cap = m?.[1];
    s.add((cap ?? f).toLowerCase());
  }
  return s;
}

function hasExplicitCodeFlagC(flags: string[] | undefined): boolean {
  return (flags || []).some(f => /^-c$/i.test(f) || /^-c=/i.test(f));
}

/** Perl/node/ruby script modes that carry the program as the next argv segment. */
function hasScriptCarrierE(flags: string[] | undefined): boolean {
  const t = flagTokensLower(flags);
  return t.has('e') || t.has('E') || t.has('ne') || t.has('pe');
}

/**
 * argv for the challenge. The interpreter is required (ADR 0026): `bash` uses
 * `-c`; `sh`/`python3`/`python` use `-c` and `node` uses `-e` (auto-injected
 * when the contract's flags do not already carry it). A missing interpreter is
 * an invalid contract and throws — it should already be rejected by validation.
 */
export function buildShellChallengeArgv(shell: ShellChallengeFields): string[] {
  const cmd = shell.cmd ?? '';
  const flags = shell.flags ?? [];
  const args = shell.args ?? [];
  const interp = normalizedInterpreter(shell.interpreter);

  if (!interp) throw missingInterpreterError();

  const low = interp.toLowerCase();

  if (low === 'bash') {
    const out: string[] = ['bash', '-c', cmd.trim()];
    if (args.length) out.push('--', ...args);
    return out;
  }

  if (INJECT_C.has(low)) {
    if (hasExplicitCodeFlagC(flags)) {
      return [interp, ...flags, ...(cmd.trim() ? [cmd] : []), ...args];
    }
    return [interp, ...flags, '-c', cmd, ...args];
  }

  if (INJECT_E.has(low)) {
    if (hasScriptCarrierE(flags)) {
      return [interp, ...flags, ...(cmd.trim() ? [cmd] : []), ...args];
    }
    return [interp, ...flags, '-e', cmd, ...args];
  }

  return [interp, ...flags, ...(cmd.trim() ? [cmd] : []), ...args];
}

/** Best-effort single-line invocation for descriptions/UI (POSIX-style quoting). */
export function shellQuoteArg(arg: string): string {
  if (arg === '') return "''";
  if (/^[\w@%+=:,./-]+$/i.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function formatShellInvocationForDisplay(argv: string[]): string {
  return argv.map(shellQuoteArg).join(' ');
}

/** One-line summary for error messages (missing proof, etc.). */
export function formatShellChallengeInvocationSummary(shell: ShellChallengeFields): string {
  return formatShellInvocationForDisplay(buildShellChallengeArgv(shell));
}
