/**
 * activate command — find the best matching adapter for a query.
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { emitResult } from '../output.js';
import { resolveOutputFormat } from '../format.js';
import { nextCallHint, renderActivatePretty, renderActivateText } from '../render.js';
import { createBackendFromProgram } from '../backend/resolve-backend.js';
import type { ActivateOptions } from '../backend/action-backend.js';

export function activateCommand(program: Command): void {
    program
        .command('activate')
        .description('Activate the best matching SQUADRULES adapter for a query')
        .argument('<query...>', 'Search query (multiple words allowed)')
        .option('--space <space>', 'Scope results to this space ("personal" or a group name)')
        .option('--context-task <task>', 'What the caller is doing right now (descriptive only; never widens search scope)')
        .option('--context-domain <domain>', 'Request domain; overrides the adapter-declared domain (never widens search scope)')
        .action(async (
            query: string[],
            options: { space?: string; contextTask?: string; contextDomain?: string }
        ) => {
            try {
                const backend = await createBackendFromProgram(program);
                const space = typeof options.space === 'string' ? options.space.trim() : '';
                const context: NonNullable<ActivateOptions['context']> = {};
                if (typeof options.contextTask === 'string' && options.contextTask.trim().length > 0) {
                    context.task = options.contextTask.trim();
                }
                if (typeof options.contextDomain === 'string' && options.contextDomain.trim().length > 0) {
                    context.domain = options.contextDomain.trim();
                }
                const activateOptions: ActivateOptions = {
                    ...(space.length > 0 ? { space } : {}),
                    ...(Object.keys(context).length > 0 ? { context } : {})
                };
                const response = await backend.activate(query.join(' '), activateOptions);
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
