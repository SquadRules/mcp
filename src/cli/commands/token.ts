/**
 * squadrules token — print the stored bearer token to stdout (for scripting).
 */

import { Command } from 'commander';
import { readConfig } from '../config-file.js';
import { writeError } from '../output.js';
import { getBaseUrl, isTokenValid, loginWithBrowser } from './login.js';

export function tokenCommand(program: Command): void {
    program
        .command('token')
        .description('Print the stored bearer token to stdout (for scripting)')
        .option('-v, --validate', 'Validate token with GET /api/me before printing')
        .option('-l, --login', 'Trigger browser login if no valid token exists')
        .action(async (opts: { validate?: boolean; login?: boolean }) => {
            try {
                const baseUrl = getBaseUrl();
                let config = await readConfig(baseUrl);
                let token = config.bearerToken;

                if (!token && opts.login) {
                    const ok = await loginWithBrowser(baseUrl);
                    if (!ok) {
                        writeError('Login failed.');
                        process.exit(1);
                    }
                    config = await readConfig(baseUrl);
                    token = config.bearerToken;
                }

                if (!token) {
                    writeError('No stored token. Run `squadrules login` or use `squadrules token --login`.');
                    process.exit(1);
                }

                if (opts.validate && !(await isTokenValid(baseUrl, token))) {
                    writeError('Token invalid or expired. Run `squadrules login` to re-authenticate.');
                    process.exit(1);
                }

                process.stdout.write(token);
                if (process.stdout.isTTY) process.stdout.write('\n');
            } catch (error) {
                writeError(error instanceof Error ? error.message : String(error));
                process.exit(1);
            }
        });
}
