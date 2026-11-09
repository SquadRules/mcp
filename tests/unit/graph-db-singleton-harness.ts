/**
 * Shared harness for the embedded graph lifecycle / ownership unit suites.
 *
 * `graph-db-singleton.test.ts` covers open/init/close; `graph-db-singleton-owner.test.ts`
 * covers store ownership and directory placement. Both need the SAME module doubles, so
 * the doubles live here once instead of being duplicated (and drifting) across the split.
 *
 * `GraphDatabaseService` and the logger are mocked, so no native LadybugDB bindings load
 * and nothing touches the real `~/.squadrules` tree. Real-database coverage of two
 * independent graphs (and two vector stores) in one process lives in
 * tests/integration/graph-db-instance-isolation.test.ts.
 *
 * Mocking strategy: `jest.resetModules()` clears both the CJS require-cache and the ESM
 * unstable-mock registry, so mocks are re-registered via BOTH `jest.doMock()` (CJS path)
 * and `jest.unstable_mockModule()` (ESM path) inside `freshSingleton()` / `freshOwner()`
 * after each reset. This makes the suites pass regardless of whether Jest is invoked
 * with `--experimental-vm-modules` or not.
 */
import { jest } from '@jest/globals';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Env keys this suite owns, restored to their original values after every test. */
export const GRAPH_DB_ENV_KEYS = [
  'SQUADRULES_GRAPH_DB_ENABLED',
  'SQUADRULES_GRAPH_DB_PATH',
  'SQUADRULES_HOME'
] as const;

/** Absolute so the real directory resolver is never consulted for the service path. */
export const TEST_GRAPH_DB_PATH = join(tmpdir(), 'squadrules-graph-db-singleton-test');
export const SECOND_GRAPH_DB_PATH = join(tmpdir(), 'squadrules-graph-db-singleton-test-second');

export const savedEnv: Record<string, string | undefined> = {};

/** Shared fake-service state; reset in `beforeEach` because module factories are re-registered. */
export const mockState = {
  initShouldFail: false,
  closeShouldFail: false,
  constructedPaths: [] as string[],
  initializeCalls: 0,
  closeCalls: 0
};

export const mockDebug = jest.fn();
export const mockInfo = jest.fn();
export const mockWarn = jest.fn();
export const mockError = jest.fn();

export function serviceFactory() {
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

export function loggerFactory() {
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
 * (`jest.unstable_mockModule`) APIs so the suites work regardless of whether
 * Node is invoked with `--experimental-vm-modules`.
 */
export function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-database.service.js', serviceFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/services/graph-db/graph-database.service.js', serviceFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
}

export type GraphDbSingleton = typeof import('../../src/services/graph-db/graph-db-singleton.js');
export type GraphOwner = typeof import('../../src/services/graph-db/graph-owner.js');

/** Reload the lifecycle module with fresh registry state so `bootInstances` starts empty. */
export async function freshSingleton(): Promise<GraphDbSingleton> {
  jest.resetModules();
  registerMocks();
  return await import('../../src/services/graph-db/graph-db-singleton.js');
}

/** Reload the owner module with a fresh WeakMap. */
export async function freshOwner(): Promise<GraphOwner> {
  jest.resetModules();
  registerMocks();
  return await import('../../src/services/graph-db/graph-owner.js');
}

/** Clear the fake-service counters and logger doubles. Call from `beforeEach`. */
export function resetMockState(): void {
  mockState.initShouldFail = false;
  mockState.closeShouldFail = false;
  mockState.constructedPaths = [];
  mockState.initializeCalls = 0;
  mockState.closeCalls = 0;
  mockDebug.mockClear();
  mockInfo.mockClear();
  mockWarn.mockClear();
  mockError.mockClear();
}

/**
 * Snapshot the owned env keys once, then clear them so a leaked value from the host
 * shell cannot decide the result. `extras` writes test-local overrides after clearing.
 */
export function isolateEnv(extras: Record<string, string> = {}): void {
  for (const key of GRAPH_DB_ENV_KEYS) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(extras)) process.env[key] = value;
}

/** Restore the values snapshotted by `isolateEnv`. Call from `afterEach`. */
export function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
