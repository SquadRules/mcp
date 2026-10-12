/**
 * CLI output-format resolution (global `--format`).
 *
 * Every data command renders through one of three effective formats. `auto`
 * (the default) is human-first: pretty on a TTY, JSON when piped/non-TTY, so
 * `squadrules activate "..."` reads nicely at a terminal but stays machine-parseable
 * when redirected or run by an agent. Precedence: `--format` flag > `SQUADRULES_FORMAT`
 * env > auto.
 */
import type { Command } from 'commander';

/** Accepted `--format` values. */
export type OutputFormat = 'auto' | 'pretty' | 'json' | 'text';

/** The three concrete renderings after `auto` is resolved against the TTY. */
export type ResolvedFormat = 'pretty' | 'json' | 'text';

const VALID: readonly string[] = ['auto', 'pretty', 'json', 'text'];

function normalize(raw: string | undefined | null): OutputFormat {
  const v = (raw ?? '').trim().toLowerCase();
  return VALID.includes(v) ? (v as OutputFormat) : 'auto';
}

/**
 * Resolve the effective output format for a command. `auto` becomes `pretty` on a TTY
 * and `json` when stdout is piped/redirected (non-TTY).
 */
export function resolveOutputFormat(program: Command): ResolvedFormat {
  const g = program.optsWithGlobals?.() ?? program.opts();
  const flag = typeof g['format'] === 'string' ? g['format'] : undefined;
  const chosen = normalize(flag ?? process.env['SQUADRULES_FORMAT']);
  if (chosen === 'pretty' || chosen === 'json' || chosen === 'text') return chosen;
  return process.stdout.isTTY ? 'pretty' : 'json';
}
