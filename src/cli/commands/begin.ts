/**
 * forward command
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { writeJson } from '../output.js';
import { formatNextCallBlock } from '../format-next-call.js';
import { createClientFromProgram } from '../client-factory.js';

export function forwardCommand(program: Command): void {
    program
        .command('forward')
        .description('Run the first or next SQUADRULES adapter layer')
        .argument('<uri>', 'SQUADRULES adapter or layer URI')
        .option('--solution <json>', 'Forward solution as JSON string')
        .action(async (uri: string, options: { solution?: string }) => {
            try {
                const client = createClientFromProgram(program);
                const solution = options.solution ? JSON.parse(options.solution) : undefined;
                const response = await client.forward(uri, solution);
                const nextCall = formatNextCallBlock(response);
                writeJson(nextCall ? { ...response, cli_next_call: nextCall } : response);
            } catch (error) {
                handleApiError(error, !isBrowserDisabled());
            }
        });
}

