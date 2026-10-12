/**
 * activate command — find the best matching adapter for a query.
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { emitResult } from '../output.js';
import { resolveOutputFormat } from '../format.js';
import { nextCallHint, renderActivatePretty, renderActivateText } from '../render.js';
import { createBackendFromProgram } from '../backend/resolve-backend.js';

export function activateCommand(program: Command): void {
    program
        .command('activate')
        .description('Activate the best matching SQUADRULES adapter for a query')
        .argument('<query...>', 'Search query (multiple words allowed)')
        .option('--space <space>', 'Scope results to this space ("personal" or a group name)')
        .action(async (query: string[], options: { space?: string }) => {
            try {
                const backend = await createBackendFromProgram(program);
                const space = typeof options.space === 'string' ? options.space.trim() : '';
                const response = await backend.activate(
                    query.join(' '),
                    space.length > 0 ? { space } : undefined
                );
                emitResult(resolveOutputFormat(program), response, {
                    pretty: renderActivatePretty,
                    text: renderActivateText,
                    nextCall: nextCallHint
                });
            } catch (error) {
                handleApiError(error, !isBrowserDisabled());
            }
        });
}
