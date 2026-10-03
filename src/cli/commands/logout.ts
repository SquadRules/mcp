/**
 * squadrules logout — clear stored Bearer token for the current environment (by API URL).
 */

import { Command } from 'commander';
import { writeConfig } from '../config-file.js';
import { getBaseUrl } from './login.js';
import { writeStdout } from '../output.js';

export function logoutCommand(program: Command): void {
    program
        .command('logout')
        .description('Clear stored access and refresh credentials for the current --url / env')
        .action(async () => {
            const baseUrl = getBaseUrl();
            await writeConfig({ apiUrl: baseUrl, bearerToken: null });
            writeStdout('Credentials cleared from config.');
        });
}
