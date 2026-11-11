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
 * Why the write is a *fork* train: `executeTrain` exempts exactly two real contracts from
 * `review_evidence` — artifact trains and fork trains. A fork of the bundled `critic-loop`
 * adapter (system-seeded into the app space at boot) is therefore a real write that needs
 * no fabricated critic verdict. Nothing here invents a PASS.
 *
 * Usage:
 *   node scripts/deploy-production-bake.mjs --help
 *   node scripts/deploy-production-bake.mjs --backend embedded
 *   node scripts/deploy-production-bake.mjs --backend arango \
 *     --arango-url http://127.0.0.1:8529 --arango-database squadrules_bake
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped entrypoint: the file Docker and `squadrules serve` both run. */
const SHIPPED_ENTRY = join(REPO_ROOT, 'dist', 'bootstrap.js');

/** The bundled adapter boot injection system-seeds into the app space — the fork source. */
const FORK_SOURCE = 'squadrules://adapter/critic-loop';

const HEALTH_TIMEOUT_MS = 300_000;
const REQUEST_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 60_000;

const SIGTERM_MARKER = 'Received SIGTERM, shutting down';
const LAST_RESORT_MARKER = 'shutdown: last-resort exit';
const NATIVE_ABORT_MARKER = 'mutex lock failed';
const EMBEDDED_READY_MARKER = 'graph db: ready (embedded)';
const ARANGO_READY_MARKER = 'graph db: arango';
const ARANGO_DEGRADED_MARKER = 'no embedded fallback is used';

const STATUS_SYMBOL = { pass: 'PASS', fail: 'FAIL', 'not-performed': 'SKIP', blocked: 'BLOCK' };

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function fail(message) {
  process.stderr.write(`production bake: ${message}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------

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

function parseArgs(argv) {
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

// ---------------------------------------------------------------------------------------
// Step ledger
// ---------------------------------------------------------------------------------------

const steps = [];
const manualSteps = [];

/** One evidence row. `detail.reason` is mandatory for every non-pass status. */
function record(id, title, status, detail = {}) {
  if (status !== 'pass' && typeof detail.reason !== 'string') {
    throw new Error(`step ${id} needs a reason when it is ${status}`);
  }
  steps.push({ id, title, status, ...detail });
  const suffix = detail.reason ? ` — ${detail.reason}` : '';
  process.stdout.write(`[${STATUS_SYMBOL[status]}] ${id} ${title}${suffix}\n`);
  if (Array.isArray(detail.manual_steps)) manualSteps.push(...detail.manual_steps);
}

// ---------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------

async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const text = await response.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function postJson(url, payload) {
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/** A structurally valid adapter document: one H1, Activation Patterns, one contract fence. */
function adapterDoc(title, marker) {
  return [
    '---',
    'version: 1.0.0',
    '---',
    '',
    `# ${title}`,
    '',
    '## Activation Patterns',
    '',
    `- ${title}`,
    '',
    '## Bake Step',
    '',
    marker,
    '',
    '```json',
    JSON.stringify({ contract: { type: 'shell', shell: { cmd: `echo ${marker}`, interpreter: 'bash' } } }),
    '```',
    '',
    '## Reward Signal',
    '',
    'Done.'
  ].join('\n');
}

/** Reserve a free port by binding and immediately releasing it. */
function reservePort() {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

// ---------------------------------------------------------------------------------------
// Child server process
// ---------------------------------------------------------------------------------------

class ServerProcess {
  constructor({ label, entry, port, env, logPath }) {
    this.label = label;
    this.entry = entry;
    this.port = port;
    this.env = env;
    this.logPath = logPath;
    this.child = undefined;
    this.logFd = undefined;
    this.exitResult = undefined;
    this.exitPromise = undefined;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    mkdirSync(dirname(this.logPath), { recursive: true });
    this.logFd = openSync(this.logPath, 'w');
    this.child = spawn(process.execPath, [this.entry], {
      cwd: REPO_ROOT,
      env: this.env,
      stdio: ['ignore', this.logFd, this.logFd]
    });
    // Captured eagerly: a boot can fail before anyone awaits the first health poll, and a
    // late `exit` listener would then miss the event and report a hang instead of a code.
    this.exitPromise = new Promise((done) => {
      this.child.on('exit', (code, signal) => {
        this.exitResult = { code, signal };
        done(this.exitResult);
      });
    });
    return this;
  }

  readLog() {
    try {
      return readFileSync(this.logPath, 'utf8');
    } catch {
      return '';
    }
  }

  logTail(lines = 40) {
    return this.readLog()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .slice(-lines)
      .join('\n');
  }

  async waitForHealth(timeoutMs = HEALTH_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = 0;
    while (Date.now() < deadline) {
      if (this.exitResult) {
        throw new Error(
          `${this.label} exited (code ${this.exitResult.code}, signal ${this.exitResult.signal}) before /health; log:\n${this.logTail()}`
        );
      }
      try {
        const reply = await request(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
        lastStatus = reply.status;
        if (reply.status === 200) return reply;
      } catch {
        // Not listening yet.
      }
      await delay(1000);
    }
    throw new Error(`${this.label} /health did not return 200 in ${timeoutMs}ms (last ${lastStatus}); log:\n${this.logTail()}`);
  }

  /** Send `signal` and wait for the process to end on its own (no forced kill unless it hangs). */
  async stop(signal = 'SIGTERM', timeoutMs = STOP_TIMEOUT_MS) {
    if (this.exitResult) return this.exitResult;
    this.child.kill(signal);
    const raced = await Promise.race([this.exitPromise, delay(timeoutMs).then(() => 'timeout')]);
    if (raced === 'timeout') {
      this.child.kill('SIGKILL');
      return this.exitPromise;
    }
    return raced;
  }

  dispose() {
    if (this.exitResult === undefined && this.child !== undefined) this.child.kill('SIGKILL');
    if (this.logFd !== undefined) {
      try {
        closeSync(this.logFd);
      } catch {
        // Already closed.
      }
      this.logFd = undefined;
    }
  }
}

function serverEnv(base) {
  return {
    ...process.env,
    TRANSPORT_TYPE: 'http',
    AUTH_ENABLED: 'false',
    // Empty QDRANT_URL selects the embedded record store; the bake is about the graph and
    // the store must be whatever the deployment uses, not the CI default.
    QDRANT_URL: '',
    EMBEDDING_PROVIDER: 'fastembed',
    SQUADRULES_NO_BROWSER: '1',
    // debug: the graph and embedding markers this harness asserts are debug-level lines.
    LOG_LEVEL: 'debug',
    ...base
  };
}

// ---------------------------------------------------------------------------------------
// Read-back helpers (shared by both backends)
// ---------------------------------------------------------------------------------------

async function forkWrite(server, title, marker) {
  const reply = await postJson(`${server.baseUrl}/api/train`, {
    content: adapterDoc(title, marker),
    source_adapter_uri: FORK_SOURCE,
    llm_model_id: 'production-bake',
    force_update: true
  });
  const items = Array.isArray(reply.body?.['items']) ? reply.body['items'] : [];
  const first = items[0] ?? {};
  return {
    status: reply.status,
    adapterUri: typeof first['adapter_uri'] === 'string' ? first['adapter_uri'] : '',
    layerUuid: typeof first['layer_uuid'] === 'string' ? first['layer_uuid'] : '',
    body: reply.body
  };
}

/**
 * Head bytes plus the first historical snapshot. The head rebuilds the stored layers; the
 * versioned export returns the authored bytes with their own digest, so both are captured:
 * a restart that loses history still returns a head.
 */
async function readBack(server, uri, marker) {
  const head = await postJson(`${server.baseUrl}/api/export`, { uri, format: 'markdown' });
  const history = await postJson(`${server.baseUrl}/api/export`, { uri, format: 'markdown', version: '1' });
  const headContent = typeof head.body?.['content'] === 'string' ? head.body['content'] : '';
  const historyContent = typeof history.body?.['content'] === 'string' ? history.body['content'] : '';
  return {
    headStatus: head.status,
    headSha256: headContent === '' ? '' : sha256(headContent),
    // A digest match alone repeats whatever the server returned; the marker proves the
    // bytes are the adapter this run wrote, not an older snapshot of the same entity.
    headHasMarker: headContent.includes(marker),
    historyStatus: history.status,
    historySha256:
      typeof history.body?.['snapshot_sha256'] === 'string' ? history.body['snapshot_sha256'] : '',
    recomputedHistorySha256: historyContent === '' ? '' : sha256(historyContent),
    historyVersion: history.body?.['history_version'] ?? null,
    historyVersions: history.body?.['history_versions'] ?? null,
    adapterVersion: history.body?.['adapter_version'] ?? null
  };
}

/** A read-back is complete when head and history both served and the digest is consistent. */
function readBackComplete(read) {
  return (
    read.headStatus === 200 &&
    read.historyStatus === 200 &&
    read.headHasMarker === true &&
    read.headSha256 !== '' &&
    read.historySha256 !== '' &&
    read.historySha256 === read.recomputedHistorySha256 &&
    Number(read.historyVersions ?? 0) >= 1
  );
}

// ---------------------------------------------------------------------------------------
// Environment capture
// ---------------------------------------------------------------------------------------

function packageVersion(entry) {
  try {
    const manifest = join(dirname(dirname(entry)), 'package.json');
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function captureEnvironment(opts) {
  return {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    hostname: hostname(),
    package_version: packageVersion(opts.entry),
    entrypoint: opts.entry,
    embedding_provider: process.env['EMBEDDING_PROVIDER'] ?? 'fastembed',
    record_store: process.env['QDRANT_URL'] ? 'qdrant' : 'embedded LanceDB',
    fastembed_cache: process.env['FASTEMBED_CACHE_DIR'] ?? process.env['XDG_CACHE_HOME'] ?? 'default',
    operator_supplied: {
      storage_class: 'RECORD: disk type / filesystem / mount options',
      cpu_and_memory: 'RECORD: vCPU, RAM',
      network_policy: 'RECORD: egress/ingress relevant to the graph backend',
      data_volume: 'RECORD: production data size the bake was run against'
    }
  };
}

// ---------------------------------------------------------------------------------------
// Bake A — embedded (LadybugDB)
// ---------------------------------------------------------------------------------------

async function bakeEmbedded(opts, runDir) {
  const root = join(runDir, 'embedded');
  const aHome = join(root, 'a-home');
  const aGraph = join(root, 'a-graph');
  const bHome = join(root, 'b-home');
  const bGraph = join(root, 'b-graph');
  mkdirSync(root, { recursive: true });

  const a1Port = await reservePort();
  const bPort = await reservePort();
  const logPath = (label) => join(runDir, `${label}.log`);
  const boot = (label, port, home, graph) =>
    new ServerProcess({
      label,
      entry: opts.entry,
      port,
      logPath: logPath(label),
      env: serverEnv({
        SERVER_PORT: String(port),
        SQUADRULES_HOME: home,
        SQUADRULES_GRAPH_BACKEND: 'embedded',
        SQUADRULES_GRAPH_DB_ENABLED: 'true',
        SQUADRULES_GRAPH_DB_PATH: graph
      })
    });

  const markerA = `bake-embedded-a-${Date.now()}`;
  const markerB = `bake-embedded-b-${Date.now()}`;
  let a1;

  // A1/A2/A3 — boot, write, read back.
  try {
    a1 = await boot('embedded-a1', a1Port, aHome, aGraph).start();
    await a1.waitForHealth(opts.timeoutMs);
    const log = a1.readLog();
    const markers = {
      embedded_ready: log.includes(EMBEDDED_READY_MARKER),
      fastembed: log.includes('embedding: fastembed'),
      vector_store: log.includes('vector store: ready')
    };
    if (!markers.embedded_ready || !markers.fastembed) {
      record('A1', 'boot: embedded graph + real embedding model ready', 'fail', {
        reason: 'the boot did not report both `graph db: ready (embedded)` and `embedding: fastembed`; the run proves nothing about the graph',
        markers,
        log_tail: a1.logTail()
      });
      return;
    }
    record('A1', 'boot: embedded graph + real embedding model ready', 'pass', { markers, port: a1Port });

    const write = await forkWrite(a1, `Bake Embedded A ${markerA}`, markerA);
    if (write.status !== 200 || write.adapterUri === '') {
      record('A2', 'write: review-exempt fork train', 'fail', {
        reason: 'the fork train did not return an adapter identity',
        status: write.status,
        body: write.body
      });
      return;
    }
    const before = await readBack(a1, write.adapterUri, markerA);
    if (!readBackComplete(before)) {
      record('A3', 'read back: head + first historical snapshot', 'fail', {
        reason: 'head and historical export did not both serve a consistent digest',
        read_back: before
      });
      return;
    }
    record('A2', 'write: review-exempt fork train', 'pass', {
      adapter_uri: write.adapterUri,
      layer_uuid: write.layerUuid
    });
    record('A3', 'read back: head + first historical snapshot', 'pass', { read_back: before });

    // A4 — graceful restart (E4 shutdown contract + E1 persistence).
    const exited = await a1.stop('SIGTERM');
    const shutdownLog = a1.readLog();
    const shutdown = {
      code: exited.code,
      signal: exited.signal,
      marker: shutdownLog.includes(SIGTERM_MARKER),
      last_resort: shutdownLog.includes(LAST_RESORT_MARKER),
      native_abort: shutdownLog.includes(NATIVE_ABORT_MARKER)
    };
    const shutdownOk =
      shutdown.code === 0 &&
      shutdown.signal === null &&
      shutdown.marker &&
      !shutdown.last_resort &&
      !shutdown.native_abort;
    if (!shutdownOk) {
      record('E4', 'shutdown: SIGTERM drains to a natural exit 0', 'fail', {
        reason: 'the graceful stop did not produce a natural exit 0 with the shutdown marker and without the last-resort or native-abort markers',
        shutdown
      });
    } else {
      record('E4', 'shutdown: SIGTERM drains to a natural exit 0', 'pass', { shutdown });
    }

    let a2 = await boot('embedded-a2', a1Port, aHome, aGraph).start();
    try {
      await a2.waitForHealth(opts.timeoutMs);
      const after = await readBack(a2, write.adapterUri, markerA);
      const persisted =
        after.headStatus === 200 &&
        after.headHasMarker === true &&
        after.headSha256 === before.headSha256 &&
        after.historyStatus === 200 &&
        after.historySha256 === before.historySha256 &&
        Number(after.historyVersions ?? 0) >= Number(before.historyVersions ?? 0);
      record(
        'E1',
        'persistence: same head and snapshot digest after a restart',
        persisted ? 'pass' : 'fail',
        persisted
          ? { before, after }
          : { reason: 'the head or the historical snapshot changed across a restart', before, after }
      );

      // A5/E2 — independent boot must not read the first boot's adapter.
      let b1 = await boot('embedded-b1', bPort, bHome, bGraph).start();
      try {
        await b1.waitForHealth(opts.timeoutMs);
        const crossRead = await postJson(`${b1.baseUrl}/api/export`, {
          uri: write.adapterUri,
          format: 'markdown'
        });
        const isolated = crossRead.status >= 400 && crossRead.status < 500;
        const ownWrite = await forkWrite(b1, `Bake Embedded B ${markerB}`, markerB);
        const ownRead = ownWrite.status === 200 ? await readBack(b1, ownWrite.adapterUri, markerB) : null;
        if (!isolated) {
          record('E2', 'isolation: a second independent boot cannot read the first boot’s adapter', 'fail', {
            reason: `the second boot answered ${crossRead.status} for the first boot's adapter; independent runtimes must not see each other`,
            cross_status: crossRead.status
          });
        } else if (ownWrite.status !== 200 || ownRead === null || ownRead.headStatus !== 200) {
          record('E2', 'isolation: a second independent boot cannot read the first boot’s adapter', 'fail', {
            reason: 'the second boot could not write and read its own adapter, so isolation was not shown against a working runtime',
            own_write_status: ownWrite.status
          });
        } else {
          // Stopping the first boot must leave the second usable.
          const a2Exit = await a2.stop('SIGTERM');
          const bHealth = await request(`${b1.baseUrl}/health`);
          const bStillOwn = await readBack(b1, ownWrite.adapterUri, markerB);
          const survives =
            a2Exit.code === 0 && bHealth.status === 200 && bStillOwn.headStatus === 200 && bStillOwn.headHasMarker;
          record(
            'E2',
            'isolation: a second independent boot cannot read the first boot’s adapter',
            survives ? 'pass' : 'fail',
            survives
              ? { cross_status: crossRead.status, second_boot_head: ownRead.headSha256 }
              : {
                  reason: 'the second boot stopped working after the first was stopped',
                  first_exit: a2Exit,
                  second_health: bHealth.status,
                  second_read: bStillOwn.headStatus
                }
          );
        }
      } finally {
        b1.dispose();
      }
    } finally {
      if (a2.exitResult === undefined) a2.dispose();
    }

    // A6/E3 — unclean stop (SIGKILL) then reboot on the same directories.
    let a3 = await boot('embedded-a3', a1Port, aHome, aGraph).start();
    try {
      await a3.waitForHealth(opts.timeoutMs);
      const beforeKill = await readBack(a3, write.adapterUri, markerA);
      const killed = await a3.stop('SIGKILL', 30_000);
      let a4 = await boot('embedded-a4', a1Port, aHome, aGraph).start();
      try {
        await a4.waitForHealth(opts.timeoutMs);
        const recovered = await readBack(a4, write.adapterUri, markerA);
        const ok =
          killed.signal === 'SIGKILL' &&
          beforeKill.headStatus === 200 &&
          recovered.headStatus === 200 &&
          recovered.headHasMarker === true &&
          recovered.headSha256 === before.headSha256;
        record(
          'E3',
          'recovery: boots after SIGKILL and the adapter is still readable',
          ok ? 'pass' : 'fail',
          ok
            ? { killed, recovered }
            : {
                reason: 'the process did not come back with the pre-kill adapter readable',
                killed,
                before_kill: beforeKill,
                recovered
              }
        );
      } finally {
        a4.dispose();
      }
    } finally {
      if (a3.exitResult === undefined) a3.dispose();
    }

    record('A7', 'failure recovery: a write interrupted mid-flight', 'not-performed', {
      reason: 'interrupting a write at a chosen point needs a hook the shipped server does not expose; scripting it would prove an arbitrary point, not the one that matters',
      manual_steps: [
        'Drive a write by hand against the embedded backend and SIGKILL it while the train request is in flight.',
        'Record exactly which point was interrupted (request stage) in the change record; do not generalise the result.'
      ]
    });
    record('A8', 'durability under power loss', 'not-performed', {
      reason: 'the harness signals processes; it never cuts power, and disk-flush behaviour is the storage layer’s contract',
      manual_steps: ['If power-loss behaviour matters, run the platform’s fault-injection procedure and record it as a separate result.']
    });
    record('A9', 'HA / failover / clustering', 'not-performed', {
      reason: 'the embedded backend is single-owner by construction; no availability claim is made or measured'
    });
  } catch (err) {
    record('A1', 'boot: embedded graph + real embedding model ready', 'fail', {
      reason: err instanceof Error ? err.message : String(err)
    });
  } finally {
    if (a1 !== undefined) a1.dispose();
  }
}

// ---------------------------------------------------------------------------------------
// Bake B — shared (ArangoDB 3.11)
// ---------------------------------------------------------------------------------------

async function arangoVersion(opts) {
  const auth =
    opts.arangoUsername === undefined
      ? {}
      : {
          authorization: `Basic ${Buffer.from(`${opts.arangoUsername}:${opts.arangoPassword ?? ''}`).toString('base64')}`
        };
  const reply = await request(`${opts.arangoUrl.replace(/\/+$/, '')}/_api/version`, { headers: auth });
  const version = typeof reply.body?.['version'] === 'string' ? reply.body['version'] : '';
  return { status: reply.status, version, body: reply.body };
}

async function bakeArango(opts, runDir) {
  const root = join(runDir, 'arango');
  const home = join(root, 'home');
  const graphPath = join(root, 'graph-must-stay-unused');
  mkdirSync(root, { recursive: true });

  // B1 — version gate. A series outside 3.10–3.11 stops the bake here.
  let version;
  try {
    version = await arangoVersion(opts);
  } catch (err) {
    record('B1', 'version gate: ArangoDB 3.10–3.11', 'blocked', {
      reason: `the shared backend is unreachable at ${opts.arangoUrl} (${err instanceof Error ? err.message : String(err)})`,
      manual_steps: ['Start the production-shaped ArangoDB 3.11 deployment, then rerun with --backend arango.']
    });
    return;
  }
  const parsed = /^(\d+)\.(\d+)/.exec(version.version ?? '');
  const seriesOk =
    parsed !== null && Number(parsed[1]) === 3 && Number(parsed[2]) >= 10 && Number(parsed[2]) <= 11;
  if (!seriesOk) {
    record('B1', 'version gate: ArangoDB 3.10–3.11', 'fail', {
      reason: `the deployment reports "${version.version || 'no version'}"; this repository supports 3.10–3.11 only and a 3.12+ deployment must not be tried anyway`,
      observed: version
    });
    return;
  }
  record('B1', 'version gate: ArangoDB 3.10–3.11', 'pass', { observed: version.version });

  const port = await reservePort();
  const secondPort = await reservePort();
  const marker = `bake-shared-${Date.now()}`;
  const boot = (label, serverPort) =>
    new ServerProcess({
      label,
      entry: opts.entry,
      port: serverPort,
      logPath: join(runDir, `${label}.log`),
      env: serverEnv({
        SERVER_PORT: String(serverPort),
        SQUADRULES_HOME: home,
        SQUADRULES_GRAPH_BACKEND: 'arango',
        SQUADRULES_ARANGO_URL: opts.arangoUrl,
        SQUADRULES_ARANGO_DATABASE: opts.arangoDatabase,
        ...(opts.arangoUsername === undefined ? {} : { SQUADRULES_ARANGO_USERNAME: opts.arangoUsername }),
        ...(opts.arangoPassword === undefined ? {} : { SQUADRULES_ARANGO_PASSWORD: opts.arangoPassword }),
        // Never point a local directory at the shared backend: it must not resolve one,
        // and a file appearing here is the embedded fallback the bake exists to catch.
        SQUADRULES_GRAPH_DB_PATH: graphPath
      })
    });

  let first;
  try {
    first = await boot('arango-b2', port).start();
    await first.waitForHealth(opts.timeoutMs);
    const log = first.readLog();
    const embeddedFiles = existsSync(graphPath) ? readdirSync(graphPath) : [];
    const ready = log.includes(ARANGO_READY_MARKER) && !log.includes(ARANGO_DEGRADED_MARKER);
    if (!ready || embeddedFiles.length > 0) {
      record('B2', 'boot: shared backend ready with no embedded fallback', 'fail', {
        reason: !ready
          ? 'the boot did not report a ready ArangoDB graph'
          : 'a local graph directory was populated while the shared backend was selected, which means the runtime fell back',
        arango_ready: ready,
        embedded_files: embeddedFiles,
        log_tail: first.logTail()
      });
      return;
    }
    record('B2', 'boot: shared backend ready with no embedded fallback', 'pass', {
      arango_marker: log.split('\n').find((line) => line.includes(ARANGO_READY_MARKER)) ?? '',
      embedded_files: embeddedFiles,
      note: 'boot-local-runtime labels a non-null graph `ready (embedded)` even on the shared backend; the arango marker plus the empty local directory are the authority here'
    });

    const write = await forkWrite(first, `Bake Shared ${marker}`, marker);
    const before = write.status === 200 ? await readBack(first, write.adapterUri, marker) : null;
    if (write.status !== 200 || before === null || !readBackComplete(before)) {
      record('B3', 'write and read back over the shared backend', 'fail', {
        reason: 'the fork train or its head/history read-back did not succeed',
        write_status: write.status,
        read_back: before
      });
      return;
    }
    record('B3', 'write and read back over the shared backend', 'pass', { read_back: before });

    // B4/E1 — restart the server only; the database keeps running.
    const exited = await first.stop('SIGTERM');
    let second = await boot('arango-b4', port).start();
    try {
      await second.waitForHealth(opts.timeoutMs);
      const after = await readBack(second, write.adapterUri, marker);
      const persisted =
        exited.code === 0 &&
        after.headStatus === 200 &&
        after.headHasMarker === true &&
        after.headSha256 === before.headSha256 &&
        after.historySha256 === before.historySha256;
      record(
        'B4',
        'persistence: the server restarts and the database still has the adapter',
        persisted ? 'pass' : 'fail',
        persisted
          ? { server_exit: exited, before, after }
          : { reason: 'the head or snapshot changed across a server-only restart', server_exit: exited, before, after }
      );

      // B5/E2s — shared visibility is the OPPOSITE of isolation and is recorded separately.
      let peer = await boot('arango-b5', secondPort).start();
      try {
        await peer.waitForHealth(opts.timeoutMs);
        const crossRead = await postJson(`${peer.baseUrl}/api/export`, {
          uri: write.adapterUri,
          format: 'markdown'
        });
        const shared = crossRead.status === 200 && sha256(String(crossRead.body?.['content'] ?? '')) === before.headSha256;
        record(
          'E2s',
          'shared visibility: a second server sees the same adapter',
          shared ? 'pass' : 'fail',
          shared
            ? {
                cross_status: crossRead.status,
                head_sha256: before.headSha256,
                note: 'this is sharing, not isolation; the repository provides no multi-process write serialisation for the shared backend'
              }
            : {
                reason: 'the second server did not return the same head bytes from the same database',
                cross_status: crossRead.status
              }
        );
      } finally {
        peer.dispose();
      }

      // B6/E3s — stop the database, boot degraded, then restore it.
      if (opts.arangoContainer === undefined) {
        record('E3s', 'backend failure: the server boots degraded, never substituting an embedded file', 'not-performed', {
          reason: 'this step needs the ArangoDB deployment to be stopped; no --arango-container was supplied',
          manual_steps: [
            `Stop the ArangoDB deployment (e.g. docker stop <container>).`,
            `Boot the server with the same environment; expect /health 200 and the log line "${ARANGO_DEGRADED_MARKER}".`,
            `Confirm no file appears under ${graphPath} — an embedded fallback is the defect this bake catches.`,
            'Start ArangoDB again, restart the server, and confirm the historical export still succeeds.'
          ]
        });
      } else {
        const bootAfterStop = async (label, serverPort) => {
          const server = await boot(label, serverPort).start();
          try {
            await server.waitForHealth(opts.timeoutMs);
            const logText = server.readLog();
            const degraded = logText.includes(ARANGO_DEGRADED_MARKER);
            const files = existsSync(graphPath) ? readdirSync(graphPath) : [];
            return { server, degraded, files, logText };
          } catch (err) {
            server.dispose();
            throw err;
          }
        };
        try {
          execFileSync('docker', ['stop', opts.arangoContainer], { stdio: 'pipe' });
          const degradedRun = await bootAfterStop('arango-b6-degraded', secondPort);
          const degradedOk = degradedRun.degraded && degradedRun.files.length === 0;
          degradedRun.server.dispose();
          execFileSync('docker', ['start', opts.arangoContainer], { stdio: 'pipe' });
          await delay(5000);
          const restored = await bootAfterStop('arango-b6-restored', secondPort);
          const restoredRead = await readBack(restored.server, write.adapterUri, marker);
          restored.server.dispose();
          const ok = degradedOk && restoredRead.historyStatus === 200 && restoredRead.historySha256 === before.historySha256;
          record(
            'E3s',
            'backend failure: the server boots degraded, never substituting an embedded file',
            ok ? 'pass' : 'fail',
            ok
              ? { degraded: degradedRun.degraded, embedded_files: degradedRun.files, restored: restoredRead }
              : {
                  reason: 'the degraded boot or the post-restore read-back did not match the contract',
                  degraded: degradedRun.degraded,
                  embedded_files: degradedRun.files,
                  restored: restoredRead
                }
          );
        } catch (err) {
          record('E3s', 'backend failure: the server boots degraded, never substituting an embedded file', 'fail', {
            reason: `driving the container failed: ${err instanceof Error ? err.message : String(err)}`
          });
        }
      }

      record('B7', 'HA / failover / clustering / replication', 'not-performed', {
        reason: 'the bake exercises one ArangoDB deployment and does not test replication, shard placement, leader election, or node loss; no availability claim is made'
      });
      record('B8', 'multi-process concurrent writes', 'not-performed', {
        reason: 'the repository provides no multi-process write serialisation for the shared backend; this is a documented residual, not something the bake can pass'
      });
    } finally {
      second.dispose();
    }
  } catch (err) {
    record('B2', 'boot: shared backend ready with no embedded fallback', 'fail', {
      reason: err instanceof Error ? err.message : String(err)
    });
  } finally {
    if (first !== undefined) first.dispose();
  }
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

function runIdOf(opts) {
  if (opts.runId !== undefined) return opts.runId;
  return new Date().toISOString().replace(/[:.]/g, '-');
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

  const counts = steps.reduce((acc, step) => ({ ...acc, [step.status]: (acc[step.status] ?? 0) + 1 }), {});
  const failed = counts.fail ?? 0;
  const incomplete = (counts['not-performed'] ?? 0) + (counts.blocked ?? 0);
  const status = failed > 0 ? 'fail' : incomplete > 0 ? 'incomplete' : 'pass';

  const evidence = {
    schema: 'squadrules.production-bake/v1',
    run_id: runId,
    generated_at: new Date().toISOString(),
    status,
    counts,
    // Stated in the file itself, not only in the runbook: a reader of the artifact must
    // not mistake it for a production validation or an availability guarantee.
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
