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

// Isolate CLI config, installed skills and embedded LanceDB from the developer's
// ~/.squadrules. A stable directory is shared by the Jest process and stdio children,
// so a child reconnect does not retrain into a fresh store. Explicit overrides win.
if (process.env.SQUADRULES_HOME === undefined) {
  if (!process.env.SQUADRULES_TEST_HOME) {
    process.env.SQUADRULES_TEST_HOME = mkdtempSync(join(tmpdir(), 'squadrules-test-home-'));
  }
  process.env.SQUADRULES_HOME = process.env.SQUADRULES_TEST_HOME;
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
// CLI uses the isolated SQUADRULES_HOME; integration tests run "cli login --token" then run commands.
import { refreshTestAuthToken } from './utils/auth-headers.js';

beforeAll(async () => {
  await refreshTestAuthToken();
}, 15000);
export {};
