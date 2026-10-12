/**
 * Backend resolution: pick the transport from the resolved `--url` target.
 *
 * The CLI is local-by-default. When nothing is configured, `getCliApiUrlDefault()`
 * yields the `stdio://local` sentinel and commands run in-process against the
 * embedded store (`LocalBackend`). An http(s) target — from `--url`, `SQUADRULES_API_URL`,
 * or a `login`-persisted config `defaultUrl` — drives a remote server (`HttpBackend`).
 * The sentinel is resolved BEFORE `normalizeAndValidateApiBaseUrl()` (which rejects
 * non-http schemes), so `stdio://local` never reaches URL validation.
 */
import type { Command } from 'commander';
import { ApiClient } from '../api-client.js';
import { resolveClientOptions } from '../client-factory.js';
import { getCliApiUrlDefault } from '../config.js';
import { isLocalTarget } from '../local-target.js';
import { normalizeAndValidateApiBaseUrl } from '../upload-guards.js';
import { HttpBackend } from './http-backend.js';
import type { ActionBackend } from './action-backend.js';

export { isLocalTarget };

export type ResolvedTarget =
  | { kind: 'local' }
  | { kind: 'http'; baseUrl: string };

function rawUrlFromProgram(program: Command): string {
  const g = program.optsWithGlobals?.() ?? program.opts();
  const raw = typeof g['url'] === 'string' ? g['url'].trim() : '';
  return raw || getCliApiUrlDefault();
}

/** Resolve the effective target: the local sentinel, or a validated http(s) base URL. */
export function resolveBackendTarget(program: Command): ResolvedTarget {
  const raw = rawUrlFromProgram(program);
  if (isLocalTarget(raw)) return { kind: 'local' };
  return { kind: 'http', baseUrl: normalizeAndValidateApiBaseUrl(raw) };
}

function reseedRequested(program: Command): boolean {
  const g = program.optsWithGlobals?.() ?? program.opts();
  return g['reseed'] === true;
}

/**
 * Build the action backend for a command. HTTP constructs an {@link ApiClient} with the
 * resolved global options; local dynamically imports {@link LocalBackend} (so http-only
 * invocations never load the embedded store / embedding stack) and boots it with fastboot.
 */
export async function createBackendFromProgram(program: Command): Promise<ActionBackend> {
  const target = resolveBackendTarget(program);
  if (target.kind === 'http') {
    return new HttpBackend(new ApiClient(resolveClientOptions(program)));
  }
  const { LocalBackend } = await import('./local-backend.js');
  return LocalBackend.create({ reseed: reseedRequested(program) });
}
