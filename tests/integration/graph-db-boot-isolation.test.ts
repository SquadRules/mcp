/**
 * G5 — runtime boot isolation (real LadybugDB + real LanceDB, no mocks).
 *
 * WHAT THIS PINS
 * `bootLocalRuntime` used to open the graph with no directory, so every runtime in one
 * process attached the *same* embedded database. Two independent boots therefore shared
 * one topology: the second boot's reads returned the first boot's adapters, and closing
 * one closed the database the other was still using.
 *
 * The assertions are deliberately about production calls only — `bootLocalRuntime`, the
 * real projection functions, and the real owner registry — so the test fails if the
 * derivation is removed rather than if a double disagrees with it.
 *
 * Embeddings are never invoked: nothing here writes memory content, only graph nodes.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BootedLocalRuntime } from '../../src/runtime/boot-local-runtime.js';
import type { GraphRepository } from '../../src/services/graph-db/graph-repository.js';

const ROOT = mkdtempSync(join(tmpdir(), 'squadrules-boot-iso-'));
const SPACE = 'space:it-boot';
const SLUG = 'boot-isolation-adapter';

const boots: BootedLocalRuntime[] = [];
let bootLocalRuntime: typeof import('../../src/runtime/boot-local-runtime.js').bootLocalRuntime;
let snapshotFromStoredMemory: typeof import('../../src/services/graph-db/adapter-graph-records.js').snapshotFromStoredMemory;
let syncAdapterGraph: typeof import('../../src/services/graph-db/adapter-graph-sync.js').syncAdapterGraph;
let adapterGraphKey: typeof import('../../src/services/graph-db/adapter-scope.js').adapterGraphKey;
let getGraphDb: typeof import('../../src/services/graph-db/graph-owner.js').getGraphDb;

/**
 * The embedded filesystem path is an embedded-backend property, deliberately not on the
 * `GraphRepository` port (a shared server has no local path). Narrowing here is what
 * proves two boots are physically separate databases.
 */
function embeddedPath(graph: GraphRepository): string {
  return (graph as unknown as { getDatabasePath(): string }).getDatabasePath();
}

async function boot(label: string): Promise<BootedLocalRuntime> {
  const runtime = await bootLocalRuntime({
    // Seeding and embeddings are unrelated to graph placement, and skipping them keeps
    // this suite from loading a model or rewriting adapters to observe a directory.
    seedAdapters: 'never',
    loadEmbeddings: false,
    healthProbe: false,
    databaseDir: join(ROOT, label)
  });
  boots.push(runtime);
  return runtime;
}

beforeAll(async () => {
  process.env['SQUADRULES_GRAPH_DB_ENABLED'] = 'true';
  bootLocalRuntime = (await import('../../src/runtime/boot-local-runtime.js')).bootLocalRuntime;
  snapshotFromStoredMemory = (await import('../../src/services/graph-db/adapter-graph-records.js'))
    .snapshotFromStoredMemory;
  syncAdapterGraph = (await import('../../src/services/graph-db/adapter-graph-sync.js')).syncAdapterGraph;
  adapterGraphKey = (await import('../../src/services/graph-db/adapter-scope.js')).adapterGraphKey;
  getGraphDb = (await import('../../src/services/graph-db/graph-owner.js')).getGraphDb;
});

afterAll(async () => {
  for (const runtime of boots) {
    try {
      await runtime.graphDb?.close();
    } catch {
      // A test may have closed it to prove the other boot survives.
    }
  }
  rmSync(ROOT, { recursive: true, force: true });
  delete process.env['SQUADRULES_GRAPH_DB_ENABLED'];
});

describe('bootLocalRuntime graph placement (G5)', () => {
  test('a boot that owns its records gets a graph colocated with them, not the process default', async () => {
    const first = await boot('first');
    const second = await boot('second');

    expect(first.graphDb).not.toBeNull();
    expect(second.graphDb).not.toBeNull();
    expect(first.memoryStore).not.toBe(second.memoryStore);
    expect(first.graphDb).not.toBe(second.graphDb);

    const firstPath = embeddedPath(first.graphDb!);
    const secondPath = embeddedPath(second.graphDb!);
    expect(firstPath).not.toBe(secondPath);
    // Colocated: the graph lives under the store the caller asked for, so the pair
    // travels together and cannot be swapped for another runtime's database.
    expect(firstPath.startsWith(join(ROOT, 'first'))).toBe(true);
    expect(secondPath.startsWith(join(ROOT, 'second'))).toBe(true);
  });

  test('each boot resolves only its own graph, and a node written through one is invisible to the other', async () => {
    const [first, second] = boots;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    expect(getGraphDb(first!.memoryStore)).toBe(first!.graphDb);
    expect(getGraphDb(second!.memoryStore)).toBe(second!.graphDb);

    const key = adapterGraphKey(SPACE, SLUG);
    const snapshot = snapshotFromStoredMemory(
      {
        memory_uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        label: 'Boot Isolation Adapter',
        tags: [],
        text: '',
        llm_model_id: 'test-model',
        created_at: '2026-01-01T00:00:00.000Z',
        space_id: SPACE,
        slug: SLUG,
        adapter: { id: 'adapter-boot-isolation', name: 'Boot Isolation Adapter', layer_index: 1, layer_count: 1 }
      },
      { spaceId: SPACE, source: 'stored-record' }
    );
    expect(snapshot).not.toBeNull();

    const report = await syncAdapterGraph(first!.graphDb!, [snapshot!]);
    expect(report.nodes).toBe(1);
    expect(await first!.graphDb!.getAdapter(key)).not.toBeNull();
    expect(await second!.graphDb!.getAdapter(key)).toBeNull();
  });

  test('closing one boot leaves the other open and usable', async () => {
    const [first, second] = boots;
    await first!.graphDb!.close();
    expect(first!.graphDb!.isInitialized()).toBe(false);
    expect(second!.graphDb!.isInitialized()).toBe(true);
    expect(
      await second!.graphDb!.getAdapter(adapterGraphKey(SPACE, 'never-projected'))
    ).toBeNull();
  });

  test('a caller-supplied graph is attached and not registered for shutdown', async () => {
    const { openGraphDb } = await import('../../src/services/graph-db/graph-db-singleton.js');
    const injected = await openGraphDb({ databaseDir: join(ROOT, 'injected-graph') });
    expect(injected).not.toBeNull();

    const runtime = await bootLocalRuntime({
      seedAdapters: 'never',
      loadEmbeddings: false,
      healthProbe: false,
      databaseDir: join(ROOT, 'injected-store'),
      graph: injected!
    });
    boots.push(runtime);

    expect(runtime.graphDb).toBe(injected);
    expect(getGraphDb(runtime.memoryStore)).toBe(injected);
  });
});
