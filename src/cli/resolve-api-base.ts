/**
 * Resolve the effective SQUADRULES API base URL from the root program after Commander parse.
 * Global --url is merged into optsWithGlobals for subcommands.
 */

import type { Command } from 'commander';
import { normalizeAndValidateApiBaseUrl } from './upload-guards.js';

export function getResolvedApiBaseFromProgram(program: Command): string {
    const g = program.optsWithGlobals?.() ?? program.opts();
    const raw = typeof g['url'] === 'string' ? g['url'].trim() : '';
    if (!raw) {
        throw new Error('SQUADRULES API base URL is missing');
    }
    return normalizeAndValidateApiBaseUrl(raw);
}
