/**
 * Argument parsing and `--help` for the production bake harness.
 *
 * `--help` prints and exits 0; every malformed invocation exits 2 through `fail`, so
 * "the harness could not run" is never confused with "a step failed" (exit 1).
 */
import { resolve } from 'node:path';
import { HEALTH_TIMEOUT_MS, SHIPPED_ENTRY, fail } from './common.mjs';

const HELP = `Production bake harness — embedded (LadybugDB) and shared (ArangoDB 3.11).

Performs the bake steps a local run can perform, writes evidence JSON, and records every
step it cannot honestly perform as "not-performed" or "blocked". The executed, recorded
bake remains an operational follow-up requiring real infrastructure.

Options
  --backend <embedded|arango|both>  Which bake(s) to run. Default: embedded.
  --entry <path>                    Shipped entrypoint (dist/bootstrap.js).
                                    For a bake, the tarball install:
                                    <prefix>/node_modules/@squadrules/mcp/dist/bootstrap.js
  --out <path>                      Evidence file.
                                    Default: .local/bake/<run-id>/evidence.json
  --run-id <id>                     Override the generated run id.
  --arango-url <url>                Shared backend base URL (also SQUADRULES_ARANGO_URL).
  --arango-database <name>          Shared backend database (also SQUADRULES_ARANGO_DATABASE).
  --arango-username <user>          Optional credentials (also SQUADRULES_ARANGO_USERNAME).
  --arango-password <pass>          Optional credentials (also SQUADRULES_ARANGO_PASSWORD).
  --arango-container <name>         Docker container running ArangoDB. Supplying it lets
                                    step B6 stop/start the database for the failure-recovery
                                    evidence; without it B6 is recorded not-performed.
  --allow-blocked                   Exit 0 when every step is pass/not-performed/blocked.
                                    A "fail" always exits non-zero.
  --keep                            Keep the run directory's server logs (default: kept
                                    anyway; this flag only suppresses the cleanup note).
  --timeout <seconds>               Per-boot health budget. Default: 300.
  --help                            Print this text.

Statuses
  pass           performed, and the pass condition held
  fail           performed, and the pass condition did not hold
  not-performed  deliberately not run here (reason + manual steps recorded)
  blocked        a prerequisite is missing (reason recorded)

Exit codes
  0  every step is pass (or pass/not-performed/blocked with --allow-blocked)
  1  at least one step failed
  2  the harness could not run (bad arguments, no entrypoint)

Never claimed by this harness: that CI parity is production validation, or any HA,
failover, clustering, or power-loss durability guarantee.
`;

export function parseArgs(argv) {
  const opts = {
    backend: 'embedded',
    entry: SHIPPED_ENTRY,
    out: undefined,
    runId: undefined,
    arangoUrl: undefined,
    arangoDatabase: undefined,
    arangoUsername: undefined,
    arangoPassword: undefined,
    arangoContainer: undefined,
    allowBlocked: false,
    keep: false,
    timeoutMs: HEALTH_TIMEOUT_MS
  };
  const valueOf = (index, flag) => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) fail(`${flag} needs a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        process.stdout.write(HELP);
        process.exit(0);
        break;
      case '--backend':
        opts.backend = valueOf(i, arg);
        i += 1;
        break;
      case '--entry':
        opts.entry = resolve(valueOf(i, arg));
        i += 1;
        break;
      case '--out':
        opts.out = resolve(valueOf(i, arg));
        i += 1;
        break;
      case '--run-id':
        opts.runId = valueOf(i, arg);
        i += 1;
        break;
      case '--arango-url':
        opts.arangoUrl = valueOf(i, arg);
        i += 1;
        break;
      case '--arango-database':
        opts.arangoDatabase = valueOf(i, arg);
        i += 1;
        break;
      case '--arango-username':
        opts.arangoUsername = valueOf(i, arg);
        i += 1;
        break;
      case '--arango-password':
        opts.arangoPassword = valueOf(i, arg);
        i += 1;
        break;
      case '--arango-container':
        opts.arangoContainer = valueOf(i, arg);
        i += 1;
        break;
      case '--allow-blocked':
        opts.allowBlocked = true;
        break;
      case '--keep':
        opts.keep = true;
        break;
      case '--timeout': {
        const seconds = Number.parseInt(valueOf(i, arg), 10);
        if (!Number.isFinite(seconds) || seconds <= 0) fail('--timeout needs a positive integer');
        opts.timeoutMs = seconds * 1000;
        i += 1;
        break;
      }
      default:
        fail(`unknown argument "${arg}" (try --help)`);
    }
  }
  if (!['embedded', 'arango', 'both'].includes(opts.backend)) {
    fail(`--backend must be embedded, arango, or both (got "${opts.backend}")`);
  }
  opts.arangoUrl = opts.arangoUrl ?? process.env['SQUADRULES_ARANGO_URL'];
  opts.arangoDatabase = opts.arangoDatabase ?? process.env['SQUADRULES_ARANGO_DATABASE'];
  opts.arangoUsername = opts.arangoUsername ?? process.env['SQUADRULES_ARANGO_USERNAME'];
  opts.arangoPassword = opts.arangoPassword ?? process.env['SQUADRULES_ARANGO_PASSWORD'];
  return opts;
}
