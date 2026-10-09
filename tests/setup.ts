import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Global Jest setup for SQUADRULES MCP integration tests
// Set required env vars before any test file imports config (config throws if missing).
// REDIS_URL set (non-empty) → Redis; unset or empty → in-memory. tests/env-loader already
// normalizes a bare REDIS_URL with REDIS_PASSWORD when available; do not invent a default here.
// SINGLE mode is the zero-config default: with no env the suite runs on stdio transport +
// embedded LanceDB (empty QDRANT_URL), mirroring `isQdrantConfigured` / `resolveTransportType`
// in src/config. CLUSTER overrides any component via shell/CI env; both defaults are guarded
// by `=== undefined` so an explicit value (QDRANT_URL=http://…, TRANSPORT_TYPE=http) always wins.
if (process.env.QDRANT_URL === undefined) process.env.QDRANT_URL = '';
if (process.env.TRANSPORT_TYPE === undefined) process.env.TRANSPORT_TYPE = 'stdio';

// Restore the per-run config isolation that scripts/deploy-run-env.sh used to provide
// (`export XDG_CONFIG_HOME=$CLI_CONFIG_DIR`; "CLI uses XDG_CONFIG_HOME, tests must not set it").
// With the ENV-less `npm test` there is no external runner, so the harness self-isolates: point
// XDG_CONFIG_HOME at ONE temp dir for the whole run. This keeps the embedded LanceDB store and CLI
// config off the developer's ~/.config, and because the dir is stable across test files (cached in
// a sentinel var that survives per-file module resets and cli-config-file.test.ts deleting
// XDG_CONFIG_HOME), the child server's boot-time adapter injection is paid once and reused instead
// of re-training into a fresh dir per file — and a stale embedded-LanceDB schema from a previous
// run (different embedding dim) can no longer clash. Guarded by `=== undefined` so a CI step-level
// or explicit XDG_CONFIG_HOME override still wins.
if (process.env.XDG_CONFIG_HOME === undefined) {
  if (!process.env.SQUADRULES_TEST_XDG_DIR) {
    process.env.SQUADRULES_TEST_XDG_DIR = mkdtempSync(join(tmpdir(), 'squadrules-test-xdg-'));
  }
  process.env.XDG_CONFIG_HOME = process.env.SQUADRULES_TEST_XDG_DIR;
}

// Optional: debug what env the test process sees (DEBUG_TEST_ENV=1 npm run dev:test)
if (process.env.DEBUG_TEST_ENV === '1') {
  const k = (key: string) => `${key}=${process.env[key] !== undefined ? '<set>' : '<unset>'}`;
  console.log(
    '[DEBUG_TEST_ENV]',
    ['ENV', 'QDRANT_COLLECTION', 'QDRANT_URL', 'REDIS_URL', 'AUTH_ENABLED', 'SERVER_PORT'].map(k).join(' ')
  );
}

// When AUTH_ENABLED=true, globalSetup writes .test-auth-env.dev.json. Refresh token so it stays valid.
// CLI uses XDG_CONFIG_HOME (set by test runner); integration tests run "cli login --token" then run commands.
import { refreshTestAuthToken } from './utils/auth-headers.js';

beforeAll(async () => {
  await refreshTestAuthToken();
}, 15000);
export {};
