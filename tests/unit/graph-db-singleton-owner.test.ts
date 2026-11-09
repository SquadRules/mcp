/**
 * Unit tests for graph ownership and placement (SquadRules 6 / Touchpoint 1).
 *
 * Pins the ownership property the runtime depends on: `graph-owner` attaches a graph to
 * the store object (WeakMap) — there is no process-global fallback, and detaching never
 * closes a graph someone else owns. Also pins that the graph directory is a sibling of
 * the embedded LanceDB store, so both stores move together with `SQUADRULES_HOME`.
 *
 * Lifecycle (`openGraphDb` / `initGraphDb` / `closeGraphDb`) lives in the companion suite
 * `graph-db-singleton.test.ts`. Both files share the module doubles in
 * `graph-db-singleton-harness.ts`.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { freshOwner, isolateEnv, resetMockState, restoreEnv } from './graph-db-singleton-harness.js';

describe('graph-owner: the graph belongs to the store (Touchpoint 1)', () => {
  beforeEach(resetMockState);

  test('an unattached owner has no graph — there is no process-global fallback', async () => {
    const { getGraphDb } = await freshOwner();
    const store = { name: 'store-a' };

    expect(getGraphDb(store)).toBeNull();
    expect(getGraphDb(null)).toBeNull();
    expect(getGraphDb(undefined)).toBeNull();
  });

  test('two stores keep their own graph', async () => {
    const owner = await freshOwner();
    const storeA = { name: 'store-a' };
    const storeB = { name: 'store-b' };
    const graphA = { isInitialized: () => true } as any;
    const graphB = { isInitialized: () => true } as any;

    owner.attachGraphDb(graphA, storeA);
    owner.attachGraphDb(graphB, storeB);

    expect(owner.getGraphDb(storeA)).toBe(graphA);
    expect(owner.getGraphDb(storeB)).toBe(graphB);
  });

  test('detachGraphDb removes the attachment without closing the graph', async () => {
    const owner = await freshOwner();
    const store = { name: 'store-a' };
    const graph = { isInitialized: () => true, close: jest.fn<any>() } as any;
    owner.attachGraphDb(graph, store);

    owner.detachGraphDb(store);

    expect(owner.getGraphDb(store)).toBeNull();
    expect(graph.close).not.toHaveBeenCalled();
  });

  test('attaching null clears the attachment (degraded boot)', async () => {
    const owner = await freshOwner();
    const store = { name: 'store-a' };
    owner.attachGraphDb({ isInitialized: () => true } as any, store);

    owner.attachGraphDb(null, store);

    expect(owner.getGraphDb(store)).toBeNull();
  });

  test('a closed graph resolves to null so callers keep one "no graph" branch', async () => {
    const owner = await freshOwner();
    const store = { name: 'store-a' };
    owner.attachGraphDb({ isInitialized: () => false } as any, store);

    expect(owner.getGraphDb(store)).toBeNull();
  });
});

describe('graph database placement (Touchpoint 1)', () => {
  test('the graph database defaults to a sibling of the embedded LanceDB store', async () => {
    isolateEnv();
    const home = mkdtempSync(join(tmpdir(), 'squadrules-graph-db-home-'));
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
      restoreEnv();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
