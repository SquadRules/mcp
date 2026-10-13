/**
 * CLI rich-output helpers: semantic color functions and ASCII table builder.
 *
 * Uses a per-call chalk instance so that color support is determined dynamically
 * from `process.stdout.isTTY` at call time (not cached at import). This ensures
 * colors are emitted on TTY and stripped when piped, regardless of when chalk
 * was first loaded.
 */
import chalk, { Chalk } from 'chalk';

/** Create a chalk instance that reflects the current TTY state. */
function ttyChalk(): Chalk {
  const level = process.stdout.isTTY ? (chalk.level || 1) : 0;
  return new chalk.Instance({ level });
}

/** Semantic color helpers for CLI output (auto-stripped when piped). */
export const c = {
  /** Section headings: "activate:", "spaces:" */
  heading: (s: string): string => ttyChalk().bold.cyan(s),
  /** Field labels: "score", "contract" */
  label: (s: string): string => ttyChalk().bold(s),
  /** Score badge: color-coded by value (green >= 0.7, yellow >= 0.4, red < 0.4) */
  score: (v: number): string => {
    const k = ttyChalk();
    const t = v.toFixed(2);
    return v >= 0.7 ? k.green(t) : v >= 0.4 ? k.yellow(t) : k.red(t);
  },
  /** Status: "success", "rated", "ok" */
  success: (s: string): string => ttyChalk().green(s),
  /** Status: "failed", "error" */
  error: (s: string): string => ttyChalk().red(s),
  /** URIs, secondary info */
  dim: (s: string): string => ttyChalk().dim(s),
  /** Adapter roles: "match", "refine", "create" */
  role: (s: string): string => ttyChalk().magenta(s),
  /** Space names */
  space: (s: string): string => ttyChalk().blue(s),
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
