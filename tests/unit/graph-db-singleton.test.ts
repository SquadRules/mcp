/**
 * Unit tests for the embedded graph-database singleton (SquadRules 6 / Touchpoint 1).
 *
 * Pins the four properties `bootLocalRuntime()` depends on: `initGraphDb()` opens the
 * database and returns it, it returns `null` instead of throwing when the open fails
 * (graceful degradation — the app must still boot), the instance is shared through
 * `getGraphDbService()`, and `closeGraphDb()` is idempotent and never rejects.
 *
 * `GraphDatabaseService` and the logger are mocked, so no native LadybugDB bindings
 * load and nothing touches the real `~/.squadrules` tree.
 *
 * Mocking strategy: `jest.resetModules()` clears both the CJS require-cache and the
 * ESM unstable-mock registry, so mocks are re-registered via BOTH `jest.doMock()`
 * (CJS path) and `jest.unstable_mockModule()` (ESM path) inside `freshSingleton()`
 * after each reset. This makes the suite pass regardless of whether Jest is invoked
 * with `--experimental-vm-modules` or not.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** Env keys this suite owns, restored to their original values after every test. */
const GRAPH_DB_ENV_KEYS = ['SQUADRULES_GRAPH_DB_ENABLED', 'SQUADRULES_GRAPH_DB_PATH', 'SQUADRULES_HOME'] as const;

/** Absolute so the real directory resolver is never consulted for the service path. */
const TEST_GRAPH_DB_PATH = join(tmpdir(), 'squadrules-graph-db-singleton-test');

const savedEnv: Record<string, string | undefined> = {};

/** Shared fake-service state; reset in `beforeEach` because module factories are re-registered. */
const mockState = {
  initShouldFail: false,
  closeShouldFail: false,
  constructedPaths: [] as string[],
  initializeCalls: 0,
  closeCalls: 0
};

const mockDebug = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();

function serviceFactory() {
  class FakeGraphDatabaseService {
    private opened = false;

    constructor(readonly databasePath?: string) {
      mockState.constructedPaths.push(databasePath ?? '');
    }

    async initialize(): Promise<void> {
      mockState.initializeCalls += 1;
      if (mockState.initShouldFail) {
        throw new Error('LadybugDB native bindings unavailable');
      }
      this.opened = true;
    }

    async close(): Promise<void> {
      mockState.closeCalls += 1;
      if (mockState.closeShouldFail) {
        throw new Error('connection already closed');
      }
      this.opened = false;
    }

    isInitialized(): boolean {
      return this.opened;
    }
  }

  return { GraphDatabaseService: FakeGraphDatabaseService };
}

function loggerFactory() {
  return {
    structuredLogger: {
      debug: mockDebug,
      info: mockInfo,
      warn: mockWarn,
      error: mockError
    }
  };
}

/**
 * Register mocks using both the CJS (`jest.doMock`) and ESM
 * (`jest.unstable_mockModule`) APIs so the suite works regardless of whether
 * Node is invoked with `--experimental-vm-modules`.
 */
function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-database.service.js', serviceFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/services/graph-db/graph-database.service.js', serviceFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
}

type GraphDbSingleton = typeof import('../../src/services/graph-db/graph-db-singleton.js');

/** Reload the singleton with fresh module state so `instance` and config constants restart clean. */
async function freshSingleton(): Promise<GraphDbSingleton> {
  jest.resetModules();
  registerMocks();
  return await import('../../src/services/graph-db/graph-db-singleton.js');
}

describe('graph-db-singleton (Touchpoint 1)', () => {
  beforeEach(() => {
    for (const key of GRAPH_DB_ENV_KEYS) {
      if (!(key in savedEnv)) savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env['SQUADRULES_GRAPH_DB_PATH'] = TEST_GRAPH_DB_PATH;

    mockState.initShouldFail = false;
    mockState.closeShouldFail = false;
    mockState.constructedPaths = [];
    mockState.initializeCalls = 0;
    mockState.closeCalls = 0;
    mockDebug.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockError.mockClear();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('initGraphDb opens the database at the configured path and returns the service', async () => {
    const graphDbModule = await freshSingleton();

    const service = await graphDbModule.initGraphDb();

    expect(service).not.toBeNull();
    expect(service?.isInitialized()).toBe(true);
    expect(mockState.constructedPaths).toEqual([TEST_GRAPH_DB_PATH]);
    expect(mockState.initializeCalls).toBe(1);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  test('initGraphDb returns null and warns instead of throwing when initialize() fails', async () => {
    mockState.initShouldFail = true;
    const graphDbModule = await freshSingleton();

    await expect(graphDbModule.initGraphDb()).resolves.toBeNull();

    expect(graphDbModule.getGraphDbService()).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('init failed'));
    // The half-open instance is released so a partial native handle cannot pin the process.
    expect(mockState.closeCalls).toBe(1);
  });

  test('getGraphDbService returns the same instance and a second init does not reopen', async () => {
    const graphDbModule = await freshSingleton();

    const first = await graphDbModule.initGraphDb();
    const second = await graphDbModule.initGraphDb();

    expect(second).toBe(first);
    expect(graphDbModule.getGraphDbService()).toBe(first);
    expect(mockState.initializeCalls).toBe(1);
    expect(mockState.constructedPaths).toEqual([TEST_GRAPH_DB_PATH]);
  });

  test('getGraphDbService is null before any boot has opened the database', async () => {
    const graphDbModule = await freshSingleton();

    expect(graphDbModule.getGraphDbService()).toBeNull();
  });

  test('closeGraphDb clears the reference and is idempotent', async () => {
    const graphDbModule = await freshSingleton();
    await graphDbModule.initGraphDb();

    await graphDbModule.closeGraphDb();
    await graphDbModule.closeGraphDb();

    expect(mockState.closeCalls).toBe(1);
    expect(graphDbModule.getGraphDbService()).toBeNull();
  });

  test('closeGraphDb on a database that was never opened is a no-op', async () => {
    const graphDbModule = await freshSingleton();

    await expect(graphDbModule.closeGraphDb()).resolves.toBeUndefined();

    expect(mockState.closeCalls).toBe(0);
  });

  test('closeGraphDb swallows a service close error and still clears the reference', async () => {
    mockState.closeShouldFail = true;
    const graphDbModule = await freshSingleton();
    const service = await graphDbModule.initGraphDb();
    expect(service).not.toBeNull();

    await expect(graphDbModule.closeGraphDb()).resolves.toBeUndefined();

    expect(graphDbModule.getGraphDbService()).toBeNull();
    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('close failed'));
    expect(mockWarn).not.toHaveBeenCalled();
  });

  test('SQUADRULES_GRAPH_DB_ENABLED=false skips the service entirely', async () => {
    process.env['SQUADRULES_GRAPH_DB_ENABLED'] = 'false';
    const graphDbModule = await freshSingleton();

    await expect(graphDbModule.initGraphDb()).resolves.toBeNull();

    expect(mockState.constructedPaths).toHaveLength(0);
    expect(mockState.initializeCalls).toBe(0);
    expect(graphDbModule.getGraphDbService()).toBeNull();
  });

  test('the graph database defaults to a sibling of the embedded LanceDB store', async () => {
    const home = mkdtempSync(join(tmpdir(), 'squadrules-graph-db-home-'));
    delete process.env['SQUADRULES_GRAPH_DB_PATH'];
    process.env['SQUADRULES_HOME'] = home;

    try {
      jest.resetModules();
      const { resolveGraphDbDir } = await import('../../src/config/graph-db.js');
      const { resolveLanceDbDir } = await import('../../src/services/vector-store/lancedb-connection.js');

      const graphDir = resolveGraphDbDir();
      expect(graphDir).toBe(join(home, 'graph-db'));
      expect(basename(graphDir)).toBe('graph-db');
      expect(dirname(graphDir)).toBe(dirname(resolveLanceDbDir()));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
