/**
 * forward command — run the first or next adapter layer.
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { emitResult } from '../output.js';
import { resolveOutputFormat } from '../format.js';
import { nextCallHint, renderForwardPretty, renderForwardText } from '../render.js';
import { createBackendFromProgram } from '../backend/resolve-backend.js';

export function forwardCommand(program: Command): void {
    program
        .command('forward')
        .description('Run the first or next SQUADRULES adapter layer')
        .argument('<uri>', 'SQUADRULES adapter or layer URI')
        .option('--solution <json>', 'Forward solution as JSON string')
        .action(async (uri: string, options: { solution?: string }) => {
            try {
                const backend = await createBackendFromProgram(program);
                const solution = options.solution ? JSON.parse(options.solution) : undefined;
                const response = await backend.forward(uri, solution);
                emitResult(resolveOutputFormat(program), response, {
                    pretty: renderForwardPretty,
                    text: renderForwardText,
                    nextCall: nextCallHint
                });
            } catch (error) {
                handleApiError(error, !isBrowserDisabled());
            }
        });
}
