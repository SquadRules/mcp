/**
 * Shared resolution of the global `--timeout` / `--retries` options.
 *
 * A leaf module (no imports beyond commander types) so both the data-path client factory and
 * the http-only auth commands (login/token, which use raw `fetch`) resolve the same values —
 * precedence CLI flag > env var > default — without an import cycle through api-client/login.
 */
import type { Command } from 'commander';

export const DEFAULT_TIMEOUT_MS = 15_000;

function globals(program: Command): Record<string, unknown> {
  return (program.optsWithGlobals?.() ?? program.opts()) as Record<string, unknown>;
}

/** Resolve request timeout in ms from `--timeout <seconds>` then `SQUADRULES_TIMEOUT_MS`; undefined if unset. */
export function resolveTimeoutMs(program: Command): number | undefined {
  const g = globals(program);
  const rawTimeout = g['timeout'] as string | undefined;
  if (rawTimeout !== undefined) {
    const sec = Number(rawTimeout);
    if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  }
  const envTimeout = process.env['SQUADRULES_TIMEOUT_MS'];
  if (envTimeout) {
    const ms = Number(envTimeout);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return undefined;
}

/** Resolve max retries from `--retries <n>` then `SQUADRULES_RETRIES`; undefined if unset. */
export function resolveMaxRetries(program: Command): number | undefined {
  const g = globals(program);
  const rawRetries = g['retries'] as string | undefined;
  if (rawRetries !== undefined) {
    const n = Number(rawRetries);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const envRetries = process.env['SQUADRULES_RETRIES'];
  if (envRetries) {
    const n = Number(envRetries);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

/** Timeout in ms with a concrete default, for callers that need a number (auth fetches). */
export function resolveTimeoutMsOrDefault(program: Command): number {
  return resolveTimeoutMs(program) ?? DEFAULT_TIMEOUT_MS;
}
