#!/usr/bin/env node
/**
 * Start the app in CLUSTER mode against the compose infra from inside the devcontainer.
 *
 * `.devcontainer/devcontainer.json` runs this as `postStartCommand`, after `npm run build`.
 * `compose/infra.yaml` is infra-only by repo convention (the app image is built in
 * SquadRules/containers), so the app process runs here instead: the `dev` service shares
 * `squadrules-network` with qdrant/valkey/postgres/keycloak and bind-mounts the repo, which is
 * exactly what a devcontainer is for.
 *
 * Why exported overrides instead of a second env file: `scripts/env/.env.template` is
 * host-oriented (`127.0.0.1`, `localhost`), and `squadrules serve` loads `.env` with dotenv,
 * which never overrides a variable already present in the environment. Exporting the in-network
 * topology therefore wins over `.env` without editing a file that also feeds the host workflow
 * and the compose services' `env_file`. Secrets stay in `.env` and are read by the app.
 *
 * Deliberately NOT set here:
 * - `AUTH_ENABLED` — `.env` sets it and http mode already defaults to true; the repo ESLint rule
 *   `NO_AUTH_ENABLED_OVERRIDE_RULE` forbids code from flipping it.
 * - `KEYCLOAK_URL`, `AUTH_CALLBACK_BASE_URL`, `AUTH_TRUSTED_ISSUERS` — browser-facing, and they
 *   must stay `localhost` because `compose/infra.yaml` publishes Keycloak's 8080 on the host.
 *   Only the server-side twin `KEYCLOAK_INTERNAL_URL` is rewritten to the service name.
 * - `KEY_VALUE_STORE_PASSWORD` / `QDRANT_API_KEY` / `SESSION_SECRET` — `KEY_VALUE_STORE_URL` is
 *   exported without credentials on purpose so `normalizeRedisUrl` injects the password from
 *   `.env` (this script never handles a secret).
 *
 * The app is spawned detached (as its own process group) with output in
 * `.local/var/devcontainer/app.log` (gitignored), then this script waits for `GET /health` to
 * return 200 and exits. It must not stay in the foreground: a lifecycle command that never
 * returns would hold the container session. Restarts stop the previous run by process group and
 * wait for SERVER_PORT to free, because the HTTP server is a child of the recorded wrapper pid.
 *
 * Usage:
 *   node scripts/deploy-devcontainer-cluster.mjs [--timeout <seconds>]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_ENTRY = join(REPO_ROOT, 'dist', 'cli', 'index.js');
const ENV_FILE = join(REPO_ROOT, '.env');
const RUN_DIR = join(REPO_ROOT, '.local', 'var', 'devcontainer');
const LOG_FILE = join(RUN_DIR, 'app.log');
const PID_FILE = join(RUN_DIR, 'app.pid');

/** First boot can download the local embedding model and seed the vector store; be generous. */
const DEFAULT_HEALTH_TIMEOUT_SEC = 600;
const HEALTH_POLL_INTERVAL_MS = 2000;
const FETCH_TIMEOUT_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  process.stderr.write(`devcontainer cluster: ${message}\n`);
  process.exit(1);
}

function timeoutSeconds() {
  const flagAt = process.argv.indexOf('--timeout');
  const raw =
    flagAt >= 0 ? process.argv[flagAt + 1] : process.env['SQUADRULES_DEVCONTAINER_HEALTH_TIMEOUT_SEC'];
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HEALTH_TIMEOUT_SEC;
}

/** Keep an explicitly exported value (a deliberate override); otherwise use the in-network default. */
function override(key, value) {
  const current = process.env[key];
  return typeof current === 'string' && current.trim() !== '' ? current : value;
}

function readRepoEnv() {
  if (!existsSync(ENV_FILE)) return {};
  try {
    return parseDotenv(readFileSync(ENV_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * spawn(..., {detached:true}) makes the wrapper a process-group leader (pgid === pid). The group
 * is the stop unit: `serve` is only a wrapper, the HTTP server that binds SERVER_PORT runs as its
 * child (dist/bootstrap.js). Signalling the wrapper alone reparents that child to PID 1 with the
 * port still bound, and PID 1 here (`sleep infinity`) never reaps it, so pid checks lie.
 */
function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

async function portServesHealth(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch (err) {
    // Refused/absent = free; anything else (including a hung request) counts as taken.
    return err?.cause?.code !== 'ECONNREFUSED';
  }
}

/**
 * A previous start may still hold the port; EADDRINUSE would kill the new process at once, and
 * /health would then false-green from the STALE server (observed: readiness passed on a pid the
 * new spawn had already lost). Wait for the port to actually free before starting.
 */
async function stopStaleInstance(serverPort, pidFilePid) {
  if (pidFilePid !== undefined) {
    process.stdout.write(`devcontainer cluster: stopping previous app group -${pidFilePid}\n`);
    signalGroup(pidFilePid, 'SIGTERM');
    for (let i = 0; i < 50 && (await portServesHealth(serverPort)); i += 1) await sleep(200);
    signalGroup(pidFilePid, 'SIGKILL');
    for (let i = 0; i < 25 && (await portServesHealth(serverPort)); i += 1) await sleep(200);
  }
  if (await portServesHealth(serverPort)) {
    fail(
      `port ${serverPort} is still served after stopping the recorded instance. ` +
        'Something else (a manual `npm start`?) holds it — free it before rerunning.'
    );
  }
}

function readStalePid() {
  if (!existsSync(PID_FILE)) return undefined;
  const pid = Number.parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  rmSync(PID_FILE, { force: true });
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function startApp(env) {
  mkdirSync(RUN_DIR, { recursive: true });
  const logFd = openSync(LOG_FILE, 'w');
  const child = spawn(process.execPath, [CLI_ENTRY, 'serve', '--transport', 'http'], {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  if (!child.pid) fail(`could not spawn ${CLI_ENTRY}`);
  writeFileSync(PID_FILE, `${child.pid}\n`);
  return child.pid;
}

function reportLogTail(reason) {
  process.stderr.write(`devcontainer cluster: ${reason}\n`);
  process.stderr.write(`devcontainer cluster: last 40 lines of ${LOG_FILE}:\n`);
  try {
    const lines = readFileSync(LOG_FILE, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    for (const line of lines.slice(-40)) process.stderr.write(`  ${line}\n`);
  } catch {
    process.stderr.write('  (no log output captured)\n');
  }
}

async function waitForHealth(url, pid, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastStatus = 0;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    if (!isAlive(pid)) {
      reportLogTail(`app process (pid ${pid}) exited before /health became ready`);
      fail('app exited during startup');
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      lastStatus = response.status;
      if (response.status === 200) {
        const text = await response.text();
        let body = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
        return { status: response.status, body, attempt };
      }
      process.stdout.write(`devcontainer cluster: /health ${response.status} (attempt ${attempt}), waiting...\n`);
    } catch (err) {
      lastStatus = 0;
      if (attempt % 5 === 1) {
        const code = err?.cause?.code ?? err?.message ?? String(err);
        process.stdout.write(`devcontainer cluster: /health not reachable yet (${code})\n`);
      }
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  reportLogTail(`/health did not return 200 within ${timeoutSec}s (last status ${lastStatus || 'unreachable'})`);
  fail('readiness timeout');
  return null;
}

/** Authenticated /mcp and /api calls need the realm; boot and /health do not. Warn, never fail. */
async function reportRealm(internalKeycloakUrl, realm) {
  if (!internalKeycloakUrl || !realm) return;
  const url = `${internalKeycloakUrl.replace(/\/$/, '')}/realms/${realm}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.ok) {
      process.stdout.write(`devcontainer cluster: keycloak realm '${realm}' present (${url})\n`);
    } else if (response.status === 404) {
      process.stdout.write(
        `devcontainer cluster: WARNING keycloak realm '${realm}' is missing - the app serves and /health is ready,\n` +
          '  but authenticated /mcp and /api calls stay fail-closed until it is provisioned. Idempotent, and it may\n' +
          '  run before or after this script (JWKS is fetched per request):\n' +
          '  python3 scripts/deploy-configure-keycloak-realms.py\n'
      );
    }
  } catch {
    // Keycloak still booting or unreachable: not fatal for app readiness.
  }
}

async function main() {
  if (!existsSync(ENV_FILE)) {
    fail(
      `.env not found at ${ENV_FILE}. Create it on the host first:\n` +
        '  python3 scripts/deploy-generate-dev-secrets.py\n' +
        '  (.env is gitignored and holds the infra secrets; compose/infra.yaml cannot interpolate\n' +
        '   QDRANT_API_KEY without it.)'
    );
  }
  if (!existsSync(CLI_ENTRY)) {
    fail(`${CLI_ENTRY} not found - run 'npm run build' first (the devcontainer postStartCommand does).`);
  }

  const repoEnv = readRepoEnv();
  const serverPort = override('SERVER_PORT', repoEnv['SERVER_PORT'] ?? '3300');
  const qdrantUrl = override('QDRANT_URL', 'http://qdrant:6333');
  const keyValueStoreUrl = override('KEY_VALUE_STORE_URL', 'redis://valkey:6379');
  const keycloakInternalUrl = override('KEYCLOAK_INTERNAL_URL', 'http://keycloak:8080');
  const embeddingProvider = override('EMBEDDING_PROVIDER', 'fastembed');

  const env = {
    ...process.env,
    TRANSPORT_TYPE: override('TRANSPORT_TYPE', 'http'),
    SERVER_PORT: serverPort,
    QDRANT_URL: qdrantUrl,
    KEY_VALUE_STORE_URL: keyValueStoreUrl,
    KEYCLOAK_INTERNAL_URL: keycloakInternalUrl,
    EMBEDDING_PROVIDER: embeddingProvider,
  };

  process.stdout.write(
    'devcontainer cluster: starting app in CLUSTER mode (transport http)\n' +
      `  SERVER_PORT=${serverPort} -> http://localhost:${serverPort}/health and /mcp\n` +
      `  QDRANT_URL=${qdrantUrl}\n` +
      `  KEY_VALUE_STORE_URL=${keyValueStoreUrl} (password injected from .env)\n` +
      `  KEYCLOAK_INTERNAL_URL=${keycloakInternalUrl} (browser-facing KEYCLOAK_URL stays ${repoEnv['KEYCLOAK_URL'] || 'unset'})\n` +
      `  EMBEDDING_PROVIDER=${embeddingProvider}\n` +
      `  log: ${LOG_FILE}\n`
  );

  await stopStaleInstance(serverPort, readStalePid());
  const pid = startApp(env);
  process.stdout.write(`devcontainer cluster: app pid ${pid}\n`);

  const { status, body, attempt } = await waitForHealth(
    `http://127.0.0.1:${serverPort}/health`,
    pid,
    timeoutSeconds()
  );
  process.stdout.write(`devcontainer cluster: /health ${status} after ${attempt} attempt(s): ${JSON.stringify(body)}\n`);
  await reportRealm(keycloakInternalUrl, repoEnv['KEYCLOAK_REALM'] ?? '');
  process.stdout.write(
    `devcontainer cluster: ready. The app keeps running detached (group -${pid}); stop it with: kill -- -${pid}\n`
  );
}

main().catch((err) => {
  fail(`unexpected error: ${err?.stack ?? err?.message ?? String(err)}`);
});
