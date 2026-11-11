#!/usr/bin/env node
/**
 * Production bake harness — embedded (LadybugDB) and shared (ArangoDB 3.11).
 *
 * Performs the bake steps a local process can perform on its own, writes machine-readable
 * evidence to a file, and refuses to fake the ones that need real infrastructure.
 *
 * **The executed, recorded bake remains an operational follow-up requiring infra.** This
 * script is the runnable half of `docs/runbooks/production-bake.md`; it is not evidence
 * by itself. A run only becomes a bake once it executed on the target host, and steps it
 * marks `not-performed` or `blocked` are open follow-ups — never passes.
 *
 * Two honesty constraints are structural, not prose:
 *
 * 1. Every step carries exactly one status: `pass`, `fail`, `not-performed` (deliberately
 *    not run, with the reason and the manual steps) or `blocked` (a prerequisite is
 *    missing, with the reason). Only an all-`pass` run exits 0; `--allow-blocked` lets a
 *    deliberate skip coexist with exit 0 for a partial run, and never turns a `fail` into
 *    a pass.
 * 2. The two backends prove *opposite* things. Embedded must be isolated between
 *    independent boots; shared must be visible to two servers. They are recorded as
 *    different evidence ids (`E2` vs `E2s`) so neither can be read as the other.
 *
 * What this harness never claims: CI parity is production validation, HA/failover/
 * clustering, or durability under power loss. It stops processes; it does not cut power,
 * and it exercises a single ArangoDB deployment with no replication.
 *
 * The modules live in `scripts/bake/`: `common` (constants, markers), `cli` (arguments),
 * `ledger` (statuses and evidence rows), `http` (requests, fork write, read-back),
 * `server-process` (the child server), `environment` (run metadata), and one module per
 * backend. This file only decides what runs and what the evidence file contains.
 *
 * Usage:
 *   node scripts/deploy-production-bake.mjs --help
 *   node scripts/deploy-production-bake.mjs --backend embedded
 *   node scripts/deploy-production-bake.mjs --backend arango \
 *     --arango-url http://127.0.0.1:8529 --arango-database squadrules_bake
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bakeArango } from './bake/bake-arango.mjs';
import { bakeEmbedded } from './bake/bake-embedded.mjs';
import { parseArgs } from './bake/cli.mjs';
import { REPO_ROOT } from './bake/common.mjs';
import { captureEnvironment } from './bake/environment.mjs';
import { manualSteps, record, steps, summarize } from './bake/ledger.mjs';

function runIdOf(opts) {
  if (opts.runId !== undefined) return opts.runId;
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * The evidence file is the deliverable, so the statements it carries travel with it.
 *
 * A reader of the artifact must not mistake it for a production validation or an
 * availability guarantee, and a step recorded `not-performed`/`blocked` must read as an
 * open follow-up even when the run exits 0.
 */
function buildEvidence({ runId, runDir, status, counts, environment }) {
  return {
    schema: 'squadrules.production-bake/v1',
    run_id: runId,
    generated_at: new Date().toISOString(),
    status,
    counts,
    statements: {
      operational_follow_up:
        'This harness performs what a local run can do. Steps recorded as not-performed or blocked remain open operational follow-ups, not passes.',
      ci_parity: 'CI parity is NOT production validation. A green integration lane is a precondition for this bake, never a substitute.',
      no_availability_claim:
        'No HA, failover, or clustering claim is made. The shared bake exercises one ArangoDB deployment; the embedded backend is single-owner.',
      no_power_loss_claim: 'The harness stops processes, never power; durability under power loss is not measured.'
    },
    environment,
    steps,
    manual_steps: manualSteps,
    artifacts: { run_directory: runDir, logs: steps.length > 0 ? 'see run_directory' : 'none' }
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runId = runIdOf(opts);
  const runDir = join(REPO_ROOT, '.local', 'bake', runId);
  const outPath = opts.out ?? join(runDir, 'evidence.json');

  process.stdout.write(
    `production bake: run ${runId}\n` +
      `  backend: ${opts.backend}\n` +
      `  entrypoint: ${opts.entry}\n` +
      `  evidence: ${outPath}\n` +
      '  note: the executed, recorded bake remains an operational follow-up requiring real infrastructure.\n'
  );

  const environment = { ...captureEnvironment(opts), run_id: runId, started_at: new Date().toISOString() };

  if (!existsSync(opts.entry)) {
    record('E5', 'environment: shipped package present', 'blocked', {
      reason: `${opts.entry} does not exist, so nothing was baked`,
      manual_steps: [
        'npm run build:tgz',
        'npm install --prefix <bake-prefix> ./artifacts/squadrules-mcp-*.tgz',
        'rerun with --entry <bake-prefix>/node_modules/@squadrules/mcp/dist/bootstrap.js'
      ]
    });
  } else {
    record('E5', 'environment: shipped package present', 'pass', { entrypoint: opts.entry });
    if (opts.backend === 'embedded' || opts.backend === 'both') await bakeEmbedded(opts, runDir);
    if (opts.backend === 'arango' || opts.backend === 'both') await bakeArango(opts, runDir);
  }

  const { counts, failed, incomplete, status } = summarize();
  const evidence = buildEvidence({ runId, runDir, status, counts, environment });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);

  process.stdout.write(
    `\nproduction bake: ${status.toUpperCase()} ` +
      `(pass ${counts.pass ?? 0}, fail ${failed}, not-performed ${counts['not-performed'] ?? 0}, blocked ${counts.blocked ?? 0})\n` +
      `production bake: evidence written to ${outPath}\n`
  );
  if (incomplete > 0) {
    process.stdout.write(
      'production bake: incomplete — the not-performed/blocked steps above are open follow-ups recorded in the evidence file.\n'
    );
  }

  if (failed > 0) process.exitCode = 1;
  else if (incomplete > 0 && !opts.allowBlocked) process.exitCode = 1;
  else process.exitCode = 0;

  if (!opts.keep) {
    process.stdout.write(`production bake: server logs kept under ${runDir} (git-ignored).\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`production bake: unexpected error: ${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(2);
});
