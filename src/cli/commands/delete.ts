/**
 * delete command — delete one or more adapter/layer resources.
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { emitResult } from '../output.js';
import { resolveOutputFormat } from '../format.js';
import { renderDeletePretty, renderDeleteText } from '../render.js';
import { DELETE_COMMAND_DESCRIPTION, DELETE_COMMAND_URI_ARGUMENT_DESCRIPTION } from './delete-metadata.js';
import { createBackendFromProgram } from '../backend/resolve-backend.js';

export function deleteCommand(program: Command): void {
    program
        .command('delete')
        .description(DELETE_COMMAND_DESCRIPTION)
        .argument('<uris...>', DELETE_COMMAND_URI_ARGUMENT_DESCRIPTION)
        .action(async (uris: string[]) => {
            try {
                const backend = await createBackendFromProgram(program);
                const response = await backend.delete(uris);
                emitResult(resolveOutputFormat(program), response, {
                    pretty: renderDeletePretty,
                    text: renderDeleteText
                });
            } catch (error) {
                handleApiError(error, !isBrowserDisabled());
            }
        });
}
