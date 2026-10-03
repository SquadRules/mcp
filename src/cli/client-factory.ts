// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Factory for creating ApiClient instances with resolved global CLI options.
 * Separated from program.ts to avoid circular imports with command modules.
 */

import type { Command } from 'commander';
import { ApiClient, type ApiClientOptions } from './api-client.js';
import { getResolvedApiBaseFromProgram } from './resolve-api-base.js';

/**
 * Resolve timeout and retry settings from program global options + environment variables.
 * Precedence: CLI flag > env var > default.
 */
export function resolveClientOptions(program: Command): ApiClientOptions {
    const g = program.optsWithGlobals?.() ?? program.opts();

    let timeoutMs: number | undefined;
    const rawTimeout = g['timeout'] as string | undefined;
    if (rawTimeout !== undefined) {
        const sec = Number(rawTimeout);
        if (Number.isFinite(sec) && sec > 0) timeoutMs = sec * 1000;
    }
    if (timeoutMs === undefined) {
        const envTimeout = process.env['KAIROS_TIMEOUT_MS'];
        if (envTimeout) {
            const ms = Number(envTimeout);
            if (Number.isFinite(ms) && ms > 0) timeoutMs = ms;
        }
    }

    let maxRetries: number | undefined;
    const rawRetries = g['retries'] as string | undefined;
    if (rawRetries !== undefined) {
        const n = Number(rawRetries);
        if (Number.isFinite(n) && n >= 0) maxRetries = n;
    }
    if (maxRetries === undefined) {
        const envRetries = process.env['KAIROS_RETRIES'];
        if (envRetries) {
            const n = Number(envRetries);
            if (Number.isFinite(n) && n >= 0) maxRetries = n;
        }
    }

    return {
        baseUrl: getResolvedApiBaseFromProgram(program),
        timeoutMs,
        maxRetries,
    };
}

/** Create an ApiClient with resolved global options (--url, --timeout, --retries). */
export function createClientFromProgram(program: Command): ApiClient {
    return new ApiClient(resolveClientOptions(program));
}
