/**
 * Resolve {@link ApiClient} options from the program's global CLI flags.
 * Separated from program.ts to avoid circular imports with command modules. Timeout/retry
 * resolution is shared with the http-only auth commands via resolve-timeout.ts.
 */

import type { Command } from 'commander';
import type { ApiClientOptions } from './api-client.js';
import { getResolvedApiBaseFromProgram } from './resolve-api-base.js';
import { resolveMaxRetries, resolveTimeoutMs } from './resolve-timeout.js';

/**
 * Resolve base URL, timeout, and retry settings from program global options + environment.
 * Precedence: CLI flag > env var > default (defaults applied inside ApiClient).
 */
export function resolveClientOptions(program: Command): ApiClientOptions {
    return {
        baseUrl: getResolvedApiBaseFromProgram(program),
        timeoutMs: resolveTimeoutMs(program),
        maxRetries: resolveMaxRetries(program),
    };
}
