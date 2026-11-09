/**
 * F1/F2 integration tests — real LadybugDB, real LanceDB, no mocks.
 *
 * What this suite pins (delivery contract, Touchpoint 3):
 *
 *   1. Two graph instances and two vector stores coexist in one process, each graph
 *      reachable only through the store it was attached to; closing one leaves the
 *      other open.
 *   2. One slug in two scopes is two nodes, and parent resolution prefers the
 *      child's own scope before the app-space fallback.
 *
 * Projection ordering and reconciliation from stored records live in the companion
 * suite `graph-db-topology-projection.test.ts`; both share `graph-db-isolation-fixture.ts`.
 */

import {
  IsolationFixture,
  SPACE_A,
  SPACE_B,
  type IsolationModules,
  loadIsolationModules
} from './graph-db-isolation-fixture.js';

let modules: IsolationModules;
let fixture: IsolationFixture;

/**
 * The filesystem path is an embedded-backend property, deliberately not on the
 * `GraphRepository` port (a shared server has no local path). This one assertion is
 * what proves the two instances are physically separate databases, so it narrows
 * locally instead of widening the port for a test-only concern.
 */
function embeddedPath(graph: unknown): string {
  return (graph as { getDatabasePath(): string }).getDatabasePath();
}

beforeAll(async () => {
  modules = await loadIsolationModules();
  fixture = new IsolationFixture(modules);
});

afterAll(() => {
  fixture.dispose();
});

describe('graph ownership per runtime instance (F1)', () => {
  test('two graphs and two stores coexist; each graph is reachable only through its own store', async () => {
    const graphA = await fixture.openGraph('owner-a');
    const graphB = await fixture.openGraph('owner-b');
    const storeA = await fixture.openStore('owner-a');
    const storeB = await fixture.openStore('owner-b');

    expect(graphA).not.toBe(graphB);
    expect(graphA.isInitialized()).toBe(true);
    expect(graphB.isInitialized()).toBe(true);
    expect(embeddedPath(graphA)).not.toBe(embeddedPath(graphB));

    expect(modules.owner.getGraphDb(storeA)).toBeNull();

    modules.owner.attachGraphDb(graphA, storeA);
    modules.owner.attachGraphDb(graphB, storeB);

    expect(modules.owner.getGraphDb(storeA)).toBe(graphA);
    expect(modules.owner.getGraphDb(storeB)).toBe(graphB);

    // A write through one runtime's graph is invisible to the other runtime.
    const snapshot = modules.records.snapshotFromStoredMemory(
      {
        memory_uuid: '11111111-1111-4111-8111-111111111111',
        label: 'Owner A Adapter',
        tags: [],
        text: '',
        llm_model_id: 'test-model',
        created_at: '2026-01-01T00:00:00.000Z',
        space_id: SPACE_A,
        slug: 'owner-scoped',
        adapter: { id: 'adapter-owner-a', name: 'Owner A Adapter', layer_index: 1, layer_count: 1 }
      },
      { spaceId: SPACE_A, source: 'stored-record' }
    );
    expect(snapshot).not.toBeNull();

    const report = await modules.sync.syncAdapterGraph(graphA, [snapshot!]);
    expect(report.nodes).toBe(1);

    const key = modules.scope.adapterGraphKey(SPACE_A, 'owner-scoped');
    expect(await graphA.getAdapter(key)).not.toBeNull();
    expect(await graphB.getAdapter(key)).toBeNull();

    // Closing the first runtime's graph leaves the second one usable.
    await graphA.close();
    expect(graphA.isInitialized()).toBe(false);
    expect(graphB.isInitialized()).toBe(true);
    expect(await graphB.getAdapter(modules.scope.adapterGraphKey(SPACE_B, 'anything'))).toBeNull();

    // Detaching is not closing: the owner just stops resolving that graph.
    modules.owner.detachGraphDb(storeB);
    expect(modules.owner.getGraphDb(storeB)).toBeNull();
  });
});

describe('scoped adapter identity (F2)', () => {
  test('one slug in two spaces is two nodes, and a child prefers its own scope over the app space', async () => {
    const graph = await fixture.openGraph('scope');

    const base = {
      label: 'Shared Slug',
      tags: [],
      text: '',
      llm_model_id: 'test-model',
      created_at: '2026-01-01T00:00:00.000Z'
    };
    const make = (spaceId: string, adapterId: string) =>
      modules.records.snapshotFromStoredMemory(
        {
          ...base,
          memory_uuid: adapterId,
          space_id: spaceId,
          slug: 'shared-slug',
          adapter: { id: adapterId, name: 'Shared Slug', layer_index: 1, layer_count: 1 }
        },
        { spaceId, source: 'stored-record' }
      )!;

    const appCopy = make(modules.appSpaceId, 'adapter-app-copy');
    const localCopy = make(SPACE_A, 'adapter-local-copy');

    // Child in SPACE_A inheriting `shared-slug`: the local copy must win.
    const child = modules.records.snapshotFromStoredMemory(
      {
        ...base,
        memory_uuid: '22222222-2222-4222-8222-222222222222',
        space_id: SPACE_A,
        slug: 'scoped-child',
        adapter: {
          id: 'adapter-scoped-child',
          name: 'Scoped Child',
          layer_index: 1,
          layer_count: 1,
          frontmatter: { slug: 'scoped-child', version: '1.0.0', inherits: 'shared-slug' }
        }
      },
      { spaceId: SPACE_A, source: 'stored-record' }
    )!;

    const report = await modules.sync.syncAdapterGraph(graph, [child, appCopy, localCopy]);
    expect(report.nodes).toBe(3);
    expect(report.edges).toBe(1);
    expect(report.missing_parents).toEqual([]);

    expect(await graph.getAdapter(modules.scope.adapterGraphKey(modules.appSpaceId, 'shared-slug'))).not.toBeNull();
    expect(await graph.getAdapter(modules.scope.adapterGraphKey(SPACE_A, 'shared-slug'))).not.toBeNull();

    // The resolved parent scope is the child's own space, recorded on the edge.
    expect(await modules.sync.resolveParentScope(graph, 'shared-slug', SPACE_A)).toBe(SPACE_A);

    const path = await graph.findPathToRoot(modules.scope.adapterGraphKey(SPACE_A, 'scoped-child'));
    expect(path).toHaveLength(1);
    // A path node is an adapter or a concept, so the scope is asserted as a shape.
    expect(path[0]!.ancestor).toMatchObject({ space: SPACE_A });
  });

  test('the app space is the fallback for a parent that only exists there', async () => {
    const graph = await fixture.openGraph('fallback');

    const appParent = modules.records.snapshotFromStoredMemory(
      {
        memory_uuid: '33333333-3333-4333-8333-333333333333',
        label: 'App Parent',
        tags: [],
        text: '',
        llm_model_id: 'test-model',
        created_at: '2026-01-01T00:00:00.000Z',
        space_id: modules.appSpaceId,
        slug: 'app-only-parent',
        adapter: { id: 'adapter-app-parent', name: 'App Parent', layer_index: 1, layer_count: 1 }
      },
      { spaceId: modules.appSpaceId, source: 'stored-record' }
    )!;

    const child = modules.records.snapshotFromStoredMemory(
      {
        memory_uuid: '44444444-4444-4444-8444-444444444444',
        label: 'Team Child',
        tags: [],
        text: '',
        llm_model_id: 'test-model',
        created_at: '2026-01-01T00:00:00.000Z',
        space_id: SPACE_B,
        slug: 'team-child',
        adapter: {
          id: 'adapter-team-child',
          name: 'Team Child',
          layer_index: 1,
          layer_count: 1,
          frontmatter: { slug: 'team-child', version: '1.0.0', inherits: 'app-only-parent' }
        }
      },
      { spaceId: SPACE_B, source: 'stored-record' }
    )!;

    const report = await modules.sync.syncAdapterGraph(graph, [child, appParent]);
    expect(report.missing_parents).toEqual([]);
    expect(report.edges).toBe(1);

    expect(await modules.sync.resolveParentScope(graph, 'app-only-parent', SPACE_B)).toBe(modules.appSpaceId);

    const path = await graph.findPathToRoot(modules.scope.adapterGraphKey(SPACE_B, 'team-child'));
    expect(path).toHaveLength(1);
    expect(path[0]!.ancestor).toMatchObject({ space: modules.appSpaceId });
  });

  test('the graph never invents a scope: an empty space id is rejected, not defaulted', async () => {
    expect(() => modules.scope.adapterGraphKey('', 'no-scope')).toThrow(/non-empty space id/);
    expect(() => modules.scope.adapterGraphKey('   ', 'no-scope')).toThrow(/non-empty space id/);
  });
});
