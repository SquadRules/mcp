/**
 * Unit tests for embedded graph lifecycle (SquadRules 6 / Touchpoint 1).
 *
 * Pins the three lifecycle properties the runtime depends on:
 *   1. `openGraphDb()` opens at an EXPLICIT directory and never memoizes, so two
 *      independent graphs can live in one process (separate handles, separate lifetimes).
 *   2. A failed open returns `null` instead of throwing (graceful degradation — the app
 *      must still boot) and releases the half-open handle.
 *   3. `initGraphDb()` is the boot adapter: it registers for shutdown, and
 *      `closeGraphDb()` closes only what it registered — a graph a caller opened with
 *      `openGraphDb()` belongs to that caller.
 *
 * Store ownership (WeakMap attachment) and directory placement live in the companion
 * suite `graph-db-singleton-owner.test.ts`. Both files share the module doubles in
 * `graph-db-singleton-harness.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import {
  SECOND_GRAPH_DB_PATH,
  TEST_GRAPH_DB_PATH,
  freshSingleton,
  isolateEnv,
  mockDebug,
  mockState,
  mockWarn,
  resetMockState,
  restoreEnv
} from './graph-db-singleton-harness.js';

describe('graph-db lifecycle: openGraphDb (Touchpoint 1)', () => {
  beforeEach(() => {
    isolateEnv({ SQUADRULES_GRAPH_DB_PATH: TEST_GRAPH_DB_PATH });
    resetMockState();
  });

  afterEach(restoreEnv);

  test('opens at the explicit directory and returns an initialized service', async () => {
    const { openGraphDb } = await freshSingleton();

    const service = await openGraphDb({ databaseDir: TEST_GRAPH_DB_PATH });

    expect(service).not.toBeNull();
    expect(service?.isInitialized()).toBe(true);
    expect(mockState.constructedPaths).toEqual([TEST_GRAPH_DB_PATH]);
    expect(mockState.initializeCalls).toBe(1);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  test('falls back to the env-resolved default directory', async () => {
    const { openGraphDb } = await freshSingleton();

    await openGraphDb();

    expect(mockState.constructedPaths).toEqual([TEST_GRAPH_DB_PATH]);
  });

  test('two opens at distinct directories are independent instances (no memoization)', async () => {
    const { openGraphDb } = await freshSingleton();

    const first = await openGraphDb({ databaseDir: TEST_GRAPH_DB_PATH });
    const second = await openGraphDb({ databaseDir: SECOND_GRAPH_DB_PATH });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(mockState.constructedPaths).toEqual([TEST_GRAPH_DB_PATH, SECOND_GRAPH_DB_PATH]);
    expect(mockState.initializeCalls).toBe(2);
  });

  test('returns null and warns instead of throwing when initialize() fails', async () => {
    mockState.initShouldFail = true;
    const { openGraphDb } = await freshSingleton();

    await expect(openGraphDb({ databaseDir: TEST_GRAPH_DB_PATH })).resolves.toBeNull();

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('init failed'));
    // The half-open instance is released so a partial native handle cannot pin the process.
    expect(mockState.closeCalls).toBe(1);
  });

  test('enabled=false skips the service entirely', async () => {
    const { openGraphDb } = await freshSingleton();

    await expect(openGraphDb({ databaseDir: TEST_GRAPH_DB_PATH, enabled: false })).resolves.toBeNull();

    expect(mockState.constructedPaths).toHaveLength(0);
    expect(mockState.initializeCalls).toBe(0);
  });

  test('SQUADRULES_GRAPH_DB_ENABLED=false skips the service entirely', async () => {
    process.env['SQUADRULES_GRAPH_DB_ENABLED'] = 'false';
    const { openGraphDb } = await freshSingleton();

    await expect(openGraphDb({ databaseDir: TEST_GRAPH_DB_PATH })).resolves.toBeNull();

    expect(mockState.constructedPaths).toHaveLength(0);
    expect(mockState.initializeCalls).toBe(0);
  });
});

describe('graph-db lifecycle: initGraphDb / closeGraphDb (Touchpoint 1)', () => {
  beforeEach(() => {
    isolateEnv({ SQUADRULES_GRAPH_DB_PATH: TEST_GRAPH_DB_PATH });
    resetMockState();
  });

  afterEach(restoreEnv);

  test('closeGraphDb closes what initGraphDb registered and is idempotent', async () => {
    const { initGraphDb, closeGraphDb } = await freshSingleton();
    const service = await initGraphDb({ databaseDir: TEST_GRAPH_DB_PATH });
    expect(service).not.toBeNull();

    await closeGraphDb();
    await closeGraphDb();

    expect(mockState.closeCalls).toBe(1);
  });

  test('closeGraphDb does not close a graph the caller opened directly', async () => {
    const { openGraphDb, closeGraphDb } = await freshSingleton();
    const callerOwned = await openGraphDb({ databaseDir: TEST_GRAPH_DB_PATH });
    expect(callerOwned).not.toBeNull();

    await closeGraphDb();

    // The creator owns the close: shutdown must not touch it.
    expect(mockState.closeCalls).toBe(0);
    expect(callerOwned?.isInitialized()).toBe(true);
  });

  test('closeGraphDb on a database that was never opened is a no-op', async () => {
    const { closeGraphDb } = await freshSingleton();

    await expect(closeGraphDb()).resolves.toBeUndefined();

    expect(mockState.closeCalls).toBe(0);
  });

  test('initGraphDb returns null when the open fails (boot still succeeds)', async () => {
    mockState.initShouldFail = true;
    const { initGraphDb, closeGraphDb } = await freshSingleton();

    await expect(initGraphDb({ databaseDir: TEST_GRAPH_DB_PATH })).resolves.toBeNull();

    // Nothing was registered, so shutdown has nothing to close.
    await closeGraphDb();
    expect(mockState.closeCalls).toBe(1); // only the failed-open cleanup
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('init failed'));
  });

  test('closeGraphDb swallows a service close error and still clears the registry', async () => {
    mockState.closeShouldFail = true;
    const { initGraphDb, closeGraphDb } = await freshSingleton();
    const service = await initGraphDb({ databaseDir: TEST_GRAPH_DB_PATH });
    expect(service).not.toBeNull();

    await expect(closeGraphDb()).resolves.toBeUndefined();
    // Second shutdown is a no-op because the registry was cleared even though close threw.
    await closeGraphDb();

    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('close failed'));
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
