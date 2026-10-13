/**
 * CLI rich-output helpers: semantic color functions and ASCII table builder.
 *
 * Colors are automatically stripped by chalk when `process.stdout.isTTY` is false
 * (output is piped/redirected), so these helpers are safe to call unconditionally
 * in pretty-mode renderers — machine-parseable output (piped) stays clean.
 */
import chalk from 'chalk';

/** Semantic color helpers for CLI output (auto-stripped when piped). */
export const c = {
  /** Section headings: "activate:", "spaces:" */
  heading: chalk.bold.cyan,
  /** Field labels: "score", "contract" */
  label: chalk.bold,
  /** Score badge: color-coded by value (green >= 0.7, yellow >= 0.4, red < 0.4) */
  score: (v: number): string =>
    v >= 0.7 ? chalk.green(v.toFixed(2)) : v >= 0.4 ? chalk.yellow(v.toFixed(2)) : chalk.red(v.toFixed(2)),
  /** Status: "success", "rated", "ok" */
  success: chalk.green,
  /** Status: "failed", "error" */
  error: chalk.red,
  /** URIs, secondary info */
  dim: chalk.dim,
  /** Adapter roles: "match", "refine", "create" */
  role: chalk.magenta,
  /** Space names */
  space: chalk.blue,
};

/**
 * Build a simple ASCII table (dash-separated, no box-drawing).
 *
 * @param headers - Column headers
 * @param rows - Row data (each row is an array of cell values as strings)
 * @returns Formatted table string with aligned columns
 *
 * @example
 * ```ts
 * asciiTable(['Name', 'Type', 'Adapters'], [
 *   ['Personal', 'other', '0'],
 *   ['Squadrules app', 'app', '11'],
 * ]);
 * // Name            Type   Adapters
 * // ──────────────  ─────  ────────
 * // Personal        other  0
 * // Squadrules app  app    11
 * ```
 */
export function asciiTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  );
  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length));
  const headerLine = headers.map((h, i) => pad(h, widths[i] ?? 0)).join('  ');
  const separator = widths.map((w) => '─'.repeat(w)).join('──');
  const dataLines = rows.map((row) => row.map((cell, i) => pad(cell, widths[i] ?? 0)).join('  '));
  return [headerLine, separator, ...dataLines].join('\n');
}
