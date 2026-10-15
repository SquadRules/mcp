/**
 * Build logical argv for shell challenges. Executors (agents/CLI) run this locally;
 * the MCP server does not spawn processes for PoW.
 */

export type ShellChallengeFields = {
  cmd?: string;
  interpreter?: ShellInterpreter;
  flags?: string[];
  args?: string[];
  workdir?: string;
};

/** Allowed shell interpreters for shell challenges (#103). */
export const SHELL_INTERPRETERS = ['bash', 'sh', 'python3', 'python', 'node'] as const;
export type ShellInterpreter = typeof SHELL_INTERPRETERS[number];

/**
 * Normalize loose proof/UI fields into argv input without assigning `undefined`
 * to optional keys (required when `exactOptionalPropertyTypes` is enabled).
 */
export function pickShellChallengeFields(shell: {
  cmd: string;
  interpreter?: string | undefined;
  flags?: string[] | undefined;
  args?: string[] | undefined;
  workdir?: string | undefined;
}): ShellChallengeFields {
  const out: ShellChallengeFields = { cmd: shell.cmd };
  const interp = shell.interpreter?.trim();
  if (interp) out.interpreter = interp as ShellInterpreter;
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
 * argv for the challenge. Default path: no interpreter or bash → bash -c cmd [-- args].
 */
export function buildShellChallengeArgv(shell: ShellChallengeFields): string[] {
  const cmd = shell.cmd ?? '';
  const flags = shell.flags ?? [];
  const args = shell.args ?? [];
  const interp = normalizedInterpreter(shell.interpreter);

  if (!interp || interp.toLowerCase() === 'bash') {
    const out: string[] = ['bash', '-c', cmd.trim() || 'true'];
    if (args.length) out.push('--', ...args);
    return out;
  }

  const low = interp.toLowerCase();

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
