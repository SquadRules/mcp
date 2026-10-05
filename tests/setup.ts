// Global Jest setup for SQUADRULES MCP integration tests
// Set required env vars before any test file imports config (config throws if missing).
// REDIS_URL set (non-empty) → Redis; unset or empty → in-memory. tests/env-loader already
// normalizes a bare REDIS_URL with REDIS_PASSWORD when available; do not invent a default here.
// Default Qdrant only when QDRANT_URL is truly UNSET (profiles that predate the URL-only
// switch). An explicitly EMPTY QDRANT_URL selects the embedded LanceDB backend — mirroring
// `isQdrantConfigured` in src/config.ts — so it must be preserved; the integration gate keys on it.
if (process.env.QDRANT_URL === undefined) process.env.QDRANT_URL = 'http://localhost:6333';

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
