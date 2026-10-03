/**
 * activate command
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { writeJson } from '../output.js';
import { formatNextCallBlock } from '../format-next-call.js';
import { createClientFromProgram } from '../client-factory.js';

export function activateCommand(program: Command): void {
    program
        .command('activate')
        .description('Activate the best matching SQUADRULES adapter for a query')
        .argument('<query...>', 'Search query (multiple words allowed)')
        .action(async (query: string[]) => {
            try {
                const client = createClientFromProgram(program);
                const response = await client.activate(query.join(' '));
                const nextCall = formatNextCallBlock(response);
                writeJson(nextCall ? { ...response, cli_next_call: nextCall } : response);
            } catch (error) {
                handleApiError(error, !isBrowserDisabled());
            }
        });
}

