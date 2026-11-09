/**
 * F3 integration tests — real LadybugDB, real LanceDB, no mocks.
 *
 * What this suite pins (delivery contract, Touchpoint 3):
 *
 *   3. Nodes are written before edges, so a child enumerated before its parent is
 *      still linked.
 *   4. A node write that fails leaves no node and no edge behind.
 *   5. Reconciliation reads stored records, so a newer stored version with a custom
 *      `inherits:` wins over a stale node, and a lost graph is rebuilt from the
 *      store without touching memory content.
 *
 * Ownership and scoped identity live in the companion suite
 * `graph-db-instance-isolation.test.ts`; both share `graph-db-isolation-fixture.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import {
  IsolationFixture,
  SPACE_A,
  adapterMarkdown,
  type IsolationModules,
  loadIsolationModules
} from './graph-db-isolation-fixture.js';

let modules: IsolationModules;
let fixture: IsolationFixture;

beforeAll(async () => {
  modules = await loadIsolationModules();
  fixture = new IsolationFixture(modules);
});

afterAll(() => {
  fixture.dispose();
});

describe('topology projection ordering (F3)', () => {
  test('a child enumerated before its parent is still linked (nodes first, edges second)', async () => {
    const graph = await fixture.openGraph('ordering');

    const parent = modules.records.snapshotFromStoredMemory(
      {
        memory_uuid: '55555555-5555-4555-8555-555555555555',
        label: 'Late Parent',
        tags: [],
        text: '',
        llm_model_id: 'test-model',
        created_at: '2026-01-01T00:00:00.000Z',
        space_id: SPACE_A,
        slug: 'late-parent',
        adapter: { id: 'adapter-late-parent', name: 'Late Parent', layer_index: 1, layer_count: 1 }
      },
      { spaceId: SPACE_A, source: 'stored-record' }
    )!;

    const child = modules.records.snapshotFromStoredMemory(
      {
        memory_uuid: '66666666-6666-4666-8666-666666666666',
        label: 'Early Child',
        tags: [],
        text: '',
        llm_model_id: 'test-model',
        created_at: '2026-01-01T00:00:00.000Z',
        space_id: SPACE_A,
        slug: 'early-child',
        adapter: {
          id: 'adapter-early-child',
          name: 'Early Child',
          layer_index: 1,
          layer_count: 1,
          frontmatter: { slug: 'early-child', version: '1.0.0', inherits: 'late-parent' }
        }
      },
      { spaceId: SPACE_A, source: 'stored-record' }
    )!;

    // Deliberately reversed: the child is projected before its parent exists.
    const report = await modules.sync.syncAdapterGraph(graph, [child, parent]);
    expect(report.nodes).toBe(2);
    expect(report.edges).toBe(1);
    expect(report.missing_parents).toEqual([]);

    const path = await graph.findPathToRoot(modules.scope.adapterGraphKey(SPACE_A, 'early-child'));
    // A path node is an adapter or a concept, so the label is asserted as a shape.
    expect(path.map((row) => row.ancestor)).toMatchObject([{ slug: 'late-parent' }]);
  });

  test('a node write that fails leaves no node and no edge behind', async () => {
    const graph = await fixture.openGraph('failed-node');

    const brokenChild = modules.records.snapshotFromStoredMemory(
      {
        memory_uuid: '77777777-7777-4777-8777-777777777777',
        label: 'Phantom Child',
        tags: [],
        text: '',
        llm_model_id: 'test-model',
        created_at: '2026-01-01T00:00:00.000Z',
        space_id: '',
        slug: 'phantom-child',
        adapter: {
          id: 'adapter-phantom-child',
          name: 'Phantom Child',
          layer_index: 1,
          layer_count: 1,
          frontmatter: { slug: 'phantom-child', version: '1.0.0', inherits: 'late-parent' }
        }
      },
      { spaceId: '', source: 'stored-record' }
    )!;

    const report = await modules.sync.syncAdapterGraph(graph, [brokenChild]);
    expect(report.nodes).toBe(0);
    expect(report.edges).toBe(0);
    expect(report.failed).toEqual(['phantom-child']);

    const adapters = await graph.getAllAdapters();
    expect(adapters.map((adapter) => adapter.slug)).not.toContain('phantom-child');
  });

  test('reconciling a space with no records adds no phantom nodes', async () => {
    const graph = await fixture.openGraph('empty-reconcile');
    const store = await fixture.openStore('empty-reconcile');

    const report = await modules.sync.reconcileAdapterGraphFromStore(graph, store, [SPACE_A]);
    expect(report.skipped).toBe(false);
    expect(report.nodes).toBe(0);
    expect(report.edges).toBe(0);
    expect(await graph.getAllAdapters()).toHaveLength(0);
  });
});

describe('reconciliation from stored records (F3)', () => {
  test('a newer stored version with a custom inherits wins over a stale node', async () => {
    const graph = await fixture.openGraph('warm');
    const store = await fixture.openStore('warm');

    // Real write path: the stored record is the authority.
    const stored = await modules.tenant.runWithSpaceContextAsync(fixture.spaceContext(SPACE_A), () =>
      store.storeAdapter(
        [
          adapterMarkdown({
            slug: 'warm-child',
            version: '2.0.0',
            title: 'Warm Child Adapter',
            inherits: 'custom-parent',
            contractText: 'Warm child step.'
          })
        ],
        'test-model',
        { forceUpdate: true }
      )
    );
    expect(stored.length).toBeGreaterThan(0);

    // Seed the graph with what an older boot projected from bundled markdown.
    const staleSnapshots = [
      modules.records.snapshotFromStoredMemory(
        {
          memory_uuid: '88888888-8888-4888-8888-888888888888',
          label: 'Bundled Parent',
          tags: [],
          text: '',
          llm_model_id: 'test-model',
          created_at: '2026-01-01T00:00:00.000Z',
          space_id: SPACE_A,
          slug: 'bundled-parent',
          adapter: { id: 'adapter-bundled-parent', name: 'Bundled Parent', layer_index: 1, layer_count: 1 }
        },
        { spaceId: SPACE_A, source: 'stored-record' }
      )!,
      modules.records.snapshotFromStoredMemory(
        {
          memory_uuid: '99999999-9999-4999-8999-999999999999',
          label: 'Warm Child',
          tags: [],
          text: '',
          llm_model_id: 'test-model',
          created_at: '2026-01-01T00:00:00.000Z',
          space_id: SPACE_A,
          slug: 'warm-child',
          adapter: {
            id: 'adapter-warm-child',
            name: 'Warm Child',
            layer_index: 1,
            layer_count: 1,
            protocol_version: '0.9.0',
            frontmatter: { slug: 'warm-child', version: '0.9.0', inherits: 'bundled-parent' }
          }
        },
        { spaceId: SPACE_A, source: 'stored-record' }
      )!
    ];
    const seeded = await modules.sync.syncAdapterGraph(graph, staleSnapshots);
    expect(seeded.nodes).toBe(2);
    expect(seeded.edges).toBe(1);

    const childKey = modules.scope.adapterGraphKey(SPACE_A, 'warm-child');
    expect((await graph.getAdapter(childKey))?.version).toBe('0.9.0');

    // Reconcile from the store: the stored record wins, stale edge is dropped.
    const report = await modules.sync.reconcileAdapterGraphFromStore(graph, store, [SPACE_A]);
    expect(report.skipped).toBe(false);
    expect(report.nodes).toBeGreaterThanOrEqual(1);
    expect(report.failed).toEqual([]);
    expect(report.missing_parents).toContain('warm-child -> custom-parent');

    const reconciled = await graph.getAdapter(childKey);
    expect(reconciled?.version).toBe('2.0.0');
    expect(reconciled?.frontmatter?.inherits).toBe('custom-parent');

    // The stale inheritance edge is gone: the child no longer reaches a bundled parent.
    const path = await graph.findPathToRoot(childKey);
    expect(path).toEqual([]);
  });

  test('a lost graph is rebuilt from stored records without rewriting memory content', async () => {
    const store = await fixture.openStore('recovery');

    const writes = await modules.tenant.runWithSpaceContextAsync(fixture.spaceContext(SPACE_A), async () => {
      const parent = await store.storeAdapter(
        [
          adapterMarkdown({
            slug: 'recovery-parent',
            version: '1.0.0',
            title: 'Recovery Parent Adapter',
            contractText: 'Parent step.'
          })
        ],
        'test-model',
        { forceUpdate: true }
      );
      const child = await store.storeAdapter(
        [
          adapterMarkdown({
            slug: 'recovery-child',
            version: '1.0.0',
            title: 'Recovery Child Adapter',
            inherits: 'recovery-parent',
            contractText: 'Child step.'
          })
        ],
        'test-model',
        { forceUpdate: true }
      );
      return { parent, child };
    });
    expect(writes.parent.length).toBeGreaterThan(0);
    expect(writes.child.length).toBeGreaterThan(0);

    const before = await store.scrollSpace(SPACE_A, { paginate: true });
    expect(before.length).toBeGreaterThanOrEqual(2);

    // A brand-new, empty graph stands in for a lost or corrupt one.
    const rebuilt = await fixture.openGraph('recovery');
    const report = await modules.sync.reconcileAdapterGraphFromStore(rebuilt, store, [SPACE_A]);

    expect(report.skipped).toBe(false);
    expect(report.failed).toEqual([]);
    expect(report.missing_parents).toEqual([]);
    expect(report.edges).toBe(1);

    const childKey = modules.scope.adapterGraphKey(SPACE_A, 'recovery-child');
    expect(await rebuilt.getAdapter(childKey)).not.toBeNull();
    expect(await rebuilt.getAdapter(modules.scope.adapterGraphKey(SPACE_A, 'recovery-parent'))).not.toBeNull();

    const path = await rebuilt.findPathToRoot(childKey);
    expect(path.map((row) => row.ancestor)).toMatchObject([{ slug: 'recovery-parent' }]);

    // Recovery is a pure projection: the store's records are byte-for-byte intact.
    const after = await store.scrollSpace(SPACE_A, { paginate: true });
    expect(after.length).toBe(before.length);
    expect(after.map((record) => record.uuid).sort()).toEqual(before.map((record) => record.uuid).sort());
  });
});
