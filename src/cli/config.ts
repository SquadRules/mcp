/**
 * CLI Configuration
 */

import { getDefaultApiUrlFromFile } from './config-file.js';
import { LOCAL_TARGET } from './local-target.js';

/**
 * Default target for Commander --url and fallbacks: SQUADRULES_API_URL, then saved
 * config defaultUrl, then the local sentinel (run in-process against the embedded store).
 * The CLI is local-by-default; `login` persists an http defaultUrl that flips subsequent
 * commands to the HTTP backend. Matches docs/CLI.md resolution order (without --url).
 */
export function getCliApiUrlDefault(): string {
    const env = (process.env['SQUADRULES_API_URL'] || '').trim();
    if (env) return env;
    const fromFile = getDefaultApiUrlFromFile();
    if (fromFile) return fromFile;
    return LOCAL_TARGET;
}

/**
 * Get the SQUADRULES API base URL (same as getCliApiUrlDefault).
 */
export function getApiUrl(): string {
    return getCliApiUrlDefault();
}
