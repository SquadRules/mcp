/**
 * UNIT tests (mocked dependencies) for the graph backend on `/health`.
 *
 * These pin the readiness contract added to `src/http/http-health-routes.ts`:
 *
 *   - graph enabled + attached  -> dependencies.graph "healthy", 200
 *   - graph enabled + missing   -> dependencies.graph "unhealthy", 503
 *   - graph disabled            -> dependencies.graph "disabled", still 200
 *   - arango backend            -> details carry the probed version/capability
 *
 * The graph is reached through the production seam `graph-owner.getGraphDb(store)`
 * (a real, unmocked module), so a fake repository is attached with the same
 * `attachGraphDb` the boot uses. Every other health dependency is mocked so the
 * assertion isolates the graph's contribution to readiness.
 *
 * Mocking strategy: `jest.resetModules()` + both `jest.unstable_mockModule()` and
 * `jest.doMock()` per the established pattern in this suite.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { AddressInfo } from 'node:net';

/** Master switch value the mocked config/graph-db.js reports for the next import. */
let mockGraphEnabled = true;
/** Backend kind the mocked config/graph-backend.js resolves at request time. */
let mockBackendKind: () => string = () => 'embedded';

function configFactory() {
  return { AUTH_ENABLED: false, REDIS_URL: '', isQdrantConfigured: true };
}

function graphDbConfigFactory() {
  return {
    GRAPH_DB_ENABLED: mockGraphEnabled,
    resolveGraphDbDir: () => '/tmp/squadrules-graph-unit',
    resolveInheritanceCheckpointDir: () => '/tmp/squadrules-graph-unit/checkpoints',
    INHERITANCE_CHECKPOINT_TTL_MS: 0,
    TREE_DISPLAY_DEPTH: 0
  };
}

function graphBackendFactory() {
  return { resolveGraphBackendKind: () => mockBackendKind() };
}

function embeddingFactory() {
  return {
    embeddingService: {
      getConfig: () => ({ provider: 'none' }),
      healthCheck: async () => ({ healthy: true, message: 'ok' })
    }
  };
}

function keyValueFactory() {
  return { keyValueStore: { isConnected: () => true } };
}

function buildVersionFactory() {
  return { getBuildVersion: () => 'test-version' };
}

function memoryStoreFactory() {
  return { MemoryQdrantStore: class {} };
}

function registerMocks(): void {
  jest.unstable_mockModule('../../src/config.js', configFactory);
  jest.unstable_mockModule('../../src/config/graph-db.js', graphDbConfigFactory);
  jest.unstable_mockModule('../../src/config/graph-backend.js', graphBackendFactory);
  jest.unstable_mockModule('../../src/services/embedding/service.js', embeddingFactory);
  jest.unstable_mockModule('../../src/services/key-value-store-factory.js', keyValueFactory);
  jest.unstable_mockModule('../../src/utils/build-version.js', buildVersionFactory);
  jest.unstable_mockModule('../../src/services/memory/store.js', memoryStoreFactory);
  jest.doMock('../../src/config.js', configFactory);
  jest.doMock('../../src/config/graph-db.js', graphDbConfigFactory);
  jest.doMock('../../src/config/graph-backend.js', graphBackendFactory);
  jest.doMock('../../src/services/embedding/service.js', embeddingFactory);
  jest.doMock('../../src/services/key-value-store-factory.js', keyValueFactory);
  jest.doMock('../../src/utils/build-version.js', buildVersionFactory);
  jest.doMock('../../src/services/memory/store.js', memoryStoreFactory);
}

/** Import the SUT and the real graph-owner seam from one fresh module registry. */
async function loadSut() {
  const { setupHealthRoutes } = await import('../../src/http/http-health-routes.js');
  const { attachGraphDb } = await import('../../src/services/graph-db/graph-owner.js');
  const express = (await import('express')).default;
  return { setupHealthRoutes, attachGraphDb, express };
}

/** A fake repository satisfying the port's liveness check (`isInitialized`). */
function fakeRepo(extra: Record<string, unknown> = {}) {
  return { isInitialized: () => true, ...extra } as any;
}

/** Boot the route on an ephemeral port, GET /health, and tear the server down. */
async function callHealth(setupHealthRoutes: any, express: any, store: object) {
  const app = express();
  setupHealthRoutes(app, store);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = (await res.json()) as Record<string, any>;
    return { status: res.status, body };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('/health graph backend readiness (unit, mocked deps)', () => {
  beforeEach(() => {
    mockGraphEnabled = true;
    mockBackendKind = () => 'embedded';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('enabled + attached graph is healthy and keeps 200', async () => {
    jest.resetModules();
    registerMocks();
    const { setupHealthRoutes, attachGraphDb, express } = await loadSut();
    const store = { checkHealth: async () => true };
    attachGraphDb(fakeRepo(), store);

    const { status, body } = await callHealth(setupHealthRoutes, express, store);

    expect(status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.dependencies.graph).toBe('healthy');
    expect(body.details.graphBackend).toBe('embedded');
  });

  test('enabled + unavailable graph is unhealthy and forces 503', async () => {
    jest.resetModules();
    registerMocks();
    const { setupHealthRoutes, express } = await loadSut();
    // No graph attached: getGraphDb(store) returns null while the graph is enabled.
    const store = { checkHealth: async () => true };

    const { status, body } = await callHealth(setupHealthRoutes, express, store);

    expect(status).toBe(503);
    expect(body.status).toBe('unhealthy');
    expect(body.dependencies.graph).toBe('unhealthy');
  });

  test('disabled graph is reported but does not fail readiness', async () => {
    jest.resetModules();
    mockGraphEnabled = false;
    registerMocks();
    const { setupHealthRoutes, express } = await loadSut();
    const store = { checkHealth: async () => true };

    const { status, body } = await callHealth(setupHealthRoutes, express, store);

    expect(status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.dependencies.graph).toBe('disabled');
    expect(body.details.graphBackend).toBe('disabled');
  });

  test('arango backend surfaces the probed version and stream-transaction capability', async () => {
    jest.resetModules();
    mockBackendKind = () => 'arango';
    registerMocks();
    const { setupHealthRoutes, attachGraphDb, express } = await loadSut();
    const store = { checkHealth: async () => true };
    attachGraphDb(
      fakeRepo({
        getCapabilities: () => ({ version: '3.11.4', streamTransactions: 'verified' })
      }),
      store
    );

    const { status, body } = await callHealth(setupHealthRoutes, express, store);

    expect(status).toBe(200);
    expect(body.dependencies.graph).toBe('healthy');
    expect(body.details.graphBackend).toBe('arango');
    expect(body.details.graphVersion).toBe('3.11.4');
    expect(body.details.graphStreamTransactions).toBe('verified');
  });
});
