import { Command } from 'commander';
import { createRequire } from 'module';
import { activateCommand } from './commands/activate.js';
import { forwardCommand } from './commands/forward.js';
import { trainCliCommand } from './commands/cli-train.js';
import { spacesCommand } from './commands/spaces.js';
import { tuneCommand } from './commands/tune.js';
import { deleteCommand } from './commands/delete.js';
import { rewardCommand } from './commands/reward.js';
import { exportCommand } from './commands/export.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { tokenCommand } from './commands/token.js';
import { serveCommand } from './commands/serve.js';
import { getCliApiUrlDefault } from './config.js';
import { isLocalTarget } from './local-target.js';


const loadPackageJson = createRequire(import.meta.url);
const { version } = loadPackageJson('../../package.json') as { version: string };

function enableHelpAfterError(command: Command): void {
  command.showHelpAfterError();
  command.showSuggestionAfterError();

  for (const subcommand of command.commands) {
    enableHelpAfterError(subcommand);
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('squadrules')
    .description('CLI tool for interacting with SquadRules REST API')
    .version(version)
    .option('-u, --url <url>', 'SquadRules API base URL, or "local" to run in-process against the embedded store', getCliApiUrlDefault())
    .option('--timeout <seconds>', 'request timeout in seconds (env: SQUADRULES_TIMEOUT_MS, default: 15)')
    .option('--retries <n>', 'max retries on network errors (env: SQUADRULES_RETRIES, default: 2)')
    .option(
      '--format <format>',
      'output format: auto (pretty on TTY, json when piped), pretty, json, or text (env: SQUADRULES_FORMAT)'
    )
    .option('--reseed', 'local mode: force delete-then-retrain of bundled app-space adapters (repair hatch)')
    .option('--no-browser', 'do not open browser when auth is required (e.g. in tests or scripts)')
    .hook('preAction', (_thisCommand, actionCommand) => {
      // optsWithGlobals merges root --url / --no-browser for nested commands (e.g. squadrules --url … train …).
      if (actionCommand.name() === 'serve') {
        return;
      }
      const opts = actionCommand.optsWithGlobals() as { url?: string; browser?: boolean };
      // Do not leak the local sentinel into the environment; http-only helpers (login,
      // ApiClient fallbacks) read SQUADRULES_API_URL and must not see stdio://local.
      if (opts.url && !isLocalTarget(opts.url)) {
        process.env['SQUADRULES_API_URL'] = opts.url;
      }
      if (opts.browser === false) {
        process.env['SQUADRULES_NO_BROWSER'] = '1';
      }
    });

  // Register commands for the current MCP tool surface.
  activateCommand(program); // activate
  forwardCommand(program); // forward
  trainCliCommand(program);
  spacesCommand(program);
  tuneCommand(program); // tune
  deleteCommand(program); // delete
  rewardCommand(program); // reward
  exportCommand(program); // export
  serveCommand(program);
  loginCommand(program);
  logoutCommand(program);
  tokenCommand(program);

  enableHelpAfterError(program);

  return program;
}
