import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { load } from 'js-yaml';

/** `.devcontainer/devcontainer.json` is JSONC: drop full-line `//` comments before parsing. */
function readDevcontainer() {
  const raw = readFileSync('.devcontainer/devcontainer.json', 'utf8');
  const json = raw
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return JSON.parse(json);
}

const CLUSTER_HELPER = 'scripts/deploy-devcontainer-cluster.mjs';

test('devcontainer brings the infra up with the env file Compose actually interpolates', () => {
  const { initializeCommand } = readDevcontainer();

  // Same project name as CI and the compose/docs examples: container and volume names derive from it.
  assert.match(initializeCommand, /-p squadrules-mcp/);
  assert.match(initializeCommand, /--profile fullstack/);
  // Without --env-file, Compose interpolates from compose/.env (the compose file's directory)
  // and qdrant's `${QDRANT_API_KEY:?...}` aborts the whole `up`.
  assert.match(initializeCommand, /--env-file \$\{localWorkspaceFolder\}\/\.env/);
});

test('devcontainer starts the app after building it', () => {
  const { postStartCommand, forwardPorts } = readDevcontainer();
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.match(postStartCommand, /npm run build/);
  assert.match(postStartCommand, /npm run dev:cluster/);
  assert.equal(pkg.scripts['dev:cluster'], `node ${CLUSTER_HELPER}`);

  // The app listens on SERVER_PORT (3300 in scripts/env/.env.template); it must be forwarded.
  const template = readFileSync('scripts/env/.env.template', 'utf8');
  const serverPort = Number(/^SERVER_PORT=(\d+)$/m.exec(template)?.[1]);
  assert.ok(Number.isInteger(serverPort) && serverPort > 0, 'template SERVER_PORT');
  assert.ok(forwardPorts.includes(serverPort), `forwardPorts must include ${serverPort}`);
});

test('cluster helper reaches infra by compose service name, never by localhost', () => {
  const script = readFileSync(CLUSTER_HELPER, 'utf8');
  const compose = load(readFileSync('compose/infra.yaml', 'utf8'));

  for (const service of ['qdrant', 'valkey', 'keycloak', 'dev']) {
    assert.ok(compose.services?.[service], `compose service ${service}`);
  }
  // The app runs in the `dev` container, so it must share the infra network.
  assert.ok(compose.services.dev.networks.includes('squadrules-network'));

  assert.match(script, /'http:\/\/qdrant:6333'/);
  assert.match(script, /'redis:\/\/valkey:6379'/);
  assert.match(script, /'http:\/\/keycloak:8080'/);
  assert.match(script, /TRANSPORT_TYPE/);
  assert.match(script, /\/health/);

  // Restart safety: the HTTP server runs as a CHILD of the recorded wrapper pid (serve spawns
  // dist/bootstrap.js). Signalling only the wrapper reparents the child to PID 1 with SERVER_PORT
  // still bound — readiness then false-greens from that stale server. The stop unit must be the
  // process group, and the script must wait for the port to free before spawning.
  assert.match(script, /process\.kill\(-pgid/);
  assert.match(script, /detached: true/);
  assert.match(script, /stopStaleInstance\(serverPort/);

  // Browser-facing Keycloak stays localhost (forwardPorts publishes it); only the server-side
  // twin KEYCLOAK_INTERNAL_URL is rewritten.
  assert.doesNotMatch(script, /^\s*KEYCLOAK_URL:/m);
  assert.match(script, /KEYCLOAK_INTERNAL_URL/);

  // No secret is handled here: the key-value URL carries no credentials (normalizeRedisUrl
  // injects KEY_VALUE_STORE_PASSWORD from .env) and AUTH_ENABLED is never assigned in code.
  assert.doesNotMatch(script, /redis:\/\/[^'"\s]*@valkey/);
  assert.doesNotMatch(script, /process\.env\[['"]AUTH_ENABLED['"]\]\s*=/);
  assert.doesNotMatch(script, /process\.env\.AUTH_ENABLED\s*=/);
});

test('the Dev Containers CLI reuses the infra Compose project instead of starting a second stack', () => {
  const devcontainer = readDevcontainer();
  const rawCompose = readFileSync('compose/infra.yaml', 'utf8');
  const compose = load(rawCompose);

  // The CLI derives `--project-name` from devcontainer.json `name` (lowercased, keeping [-_a-z0-9])
  // and passes it to every compose command it runs. It must equal the `-p squadrules-mcp` used by
  // initializeCommand and CI, otherwise the CLI builds a second stack on its own
  // `<project>_squadrules-network`: qdrant/valkey/keycloak become unresolvable by service name and
  // the already published infra ports (6333/6379/5432/8080) collide.
  assert.equal(devcontainer.name, 'squadrules-mcp');
  assert.equal(compose.name, 'squadrules-mcp');

  // The CLI's own `docker compose -f <abs>/compose/infra.yaml config` passes neither --env-file nor
  // -p. initializeCommand uses --env-file to point directly at .devcontainer/env (tracked in git
  // with static dev credentials), so no symlink or root .env is needed for dev containers.
  assert.match(devcontainer.initializeCommand, /--env-file \$\{localWorkspaceFolder\}\/\.devcontainer\/env/);
  assert.match(readFileSync('.gitignore', 'utf8'), /^\.env$/m);

  // The symlink is why the required-variable guard survives: it must never be softened to `:-`
  // just to let a bare `compose config` through, or qdrant would start with auth silently off.
  assert.match(rawCompose, /QDRANT__SERVICE__API_KEY=\$\{QDRANT_API_KEY:\?/);
});

test('dev container runs on glibc: the local embedding provider cannot load on musl', () => {
  const compose = load(readFileSync('compose/infra.yaml', 'utf8'));
  const dev = compose.services.dev;
  const devcontainer = readDevcontainer();

  // Server boot awaits ensureEmbeddingDimension(); the zero-key provider (fastembed) loads
  // onnxruntime-node, whose published linux binaries are glibc-only. An Alpine/musl base fails
  // with "ld-linux-aarch64.so.1: No such file or directory" and the app never binds the port.
  assert.doesNotMatch(dev.image, /^docker:/, 'docker:* images are Alpine (musl)');
  assert.doesNotMatch(dev.image, /alpine/i);
  assert.match(dev.image, /^mcr\.microsoft\.com\/devcontainers\/typescript-node:/);
  assert.match(dev.image, /@sha256:[0-9a-f]{64}$/, 'images are digest-pinned in compose/infra.yaml');

  // The image ships node/npm/git/python3/curl, so the readiness wait needs no Docker CLI and the
  // devcontainer declares no features (a redundant node feature would shadow the image's node).
  assert.doesNotMatch(JSON.stringify(dev.command), /\bdocker\b/);
  assert.ok(!dev.volumes.some((v) => String(v).includes('docker.sock')));
  assert.equal(devcontainer.features, undefined);
  assert.equal(devcontainer.service, 'dev');
  assert.ok(devcontainer.runServices.includes('dev'));
});
