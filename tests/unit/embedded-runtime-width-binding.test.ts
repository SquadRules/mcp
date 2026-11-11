/**
 * Unit-only directory/boot diagnostic coverage. Native connections, embedding and
 * graph boot are doubled; engine, facade, reader, metadata and runtime selection
 * are real. This is NOT successful-provider source-child integration evidence.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import type { LanceVectorRecordStore as RecordStore } from '../../src/services/vector-store/lancedb/LanceVectorRecordStore.js';
import type { LanceRecordEngine as RecordEngine } from '../../src/services/vector-store/lancedb/lance-records-engine.js';

const appSpace = 'app:width-unit';
const provider = { provider: 'unit-provider', model: 'unit-model', dimension: 384 };
const warn = jest.fn();
const debug = jest.fn();
const resolveDir = jest.fn(() => path.join(process.env.SQUADRULES_HOME!, 'lancedb'));
const tableNames = jest.fn<() => Promise<string[]>>();
const createTable = jest.fn<() => Promise<object>>();
const open = jest.fn(async (_directory: string) => ({ tableNames, createTable }));
const ensureEmbedding = jest.fn(async () => provider.dimension);
const successfulProvider = jest.fn<() => typeof provider | null>();
const inject = jest.fn(async () => undefined);
const graphInit = jest.fn(async () => null);
let scratch: string;
let originalCwd: string;
let originalHome: string | undefined;

async function load(qdrant = false) {
  jest.resetModules();
  jest.unstable_mockModule('../../src/config.js', () => ({
    isQdrantConfigured: qdrant, EMBEDDING_PROVIDER: 'deferred-unit-provider',
    QDRANT_SNAPSHOT_ON_START: false, QDRANT_SNAPSHOT_DIR: '',
    SQUADRULES_APP_SPACE_ID: appSpace, getQdrantCollection: () => 'unit-records'
  }));
  jest.unstable_mockModule('../../src/utils/structured-logger.js', () => ({
    structuredLogger: { warn, debug, info: jest.fn() },
    logger: { warn, debug, info: jest.fn() }
  }));
  jest.unstable_mockModule('../../src/utils/tenant-context.js', () => ({
    getSpaceContext: () => ({ allowedSpaceIds: [appSpace] }),
    getSpaceContextFromStorage: () => ({ defaultWriteSpaceId: appSpace }),
    getSearchSpaceIds: () => [appSpace]
  }));
  jest.unstable_mockModule('../../src/utils/squadrules-user-dirs.js', () => ({
    migrateOldSquadrulesConfigDir: jest.fn()
  }));
  jest.unstable_mockModule('../../src/services/vector-store/lancedb-connection.js', () => ({
    resolveLanceDbDir: resolveDir, openLanceConnection: open
  }));
  // Keep the real reader, but cut unused embedding/writer dependency trees.
  jest.unstable_mockModule('../../src/services/vector-store/lancedb/lance-records-search.js', () => ({ LanceRecordSearch: class {} }));
  jest.unstable_mockModule('../../src/services/vector-store/lancedb/lance-records-writes.js', () => ({ LanceRecordWriter: class {} }));
  jest.unstable_mockModule('../../src/services/vector-store/lancedb/lance-records-mutations.js', () => ({ LanceRecordMutator: class {} }));
  jest.unstable_mockModule('../../src/services/embedding/config.js', () => ({ getEmbeddingDimension: () => provider.dimension }));
  jest.unstable_mockModule('../../src/services/embedding/provider-resolver.js', () => ({ getSuccessfulProvider: successfulProvider }));
  jest.unstable_mockModule('../../src/services/embedding/lazy-probe.js', () => ({ ensureEmbeddingDimension: ensureEmbedding }));
  const qdrantStore = { init: jest.fn(async () => undefined), checkHealth: jest.fn(async () => true) };
  const qdrantService = {};
  jest.unstable_mockModule('../../src/services/memory/store.js', () => ({ MemoryQdrantStore: class { constructor() { return qdrantStore; } } }));
  jest.unstable_mockModule('../../src/services/qdrant/index.js', () => ({ qdrantService }));
  jest.unstable_mockModule('../../src/services/qdrant/snapshots.js', () => ({ triggerQdrantSnapshot: jest.fn() }));
  jest.unstable_mockModule('../../src/services/graph-db/graph-db-singleton.js', () => ({ initGraphDb: graphInit }));
  jest.unstable_mockModule('../../src/services/graph-db/graph-owner.js', () => ({ attachGraphDb: jest.fn() }));
  jest.unstable_mockModule('../../src/services/graph-db/adapter-graph-sync.js', () => ({
    defaultReconcileSpaceIds: () => [appSpace],
    reconcileAdapterGraphFromStore: jest.fn(async () => ({ skipped: true }))
  }));
  jest.unstable_mockModule('../../src/resources/mem-resources-boot.js', () => ({ injectMemResourcesAtBoot: inject }));
  jest.unstable_mockModule('../../src/config/mem-boot.js', () => ({ MEM_BOOT_FORCE_INJECT: false }));
  const { LanceVectorRecordStore } = await import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
  const { LanceRecordEngine } = await import('../../src/services/vector-store/lancedb/lance-records-engine.js');
  const metadata = await import('../../src/services/vector-store/lancedb/lance-store-metadata.js');
  const { toRow } = await import('../../src/services/vector-store/lancedb/lance-records-schema.js');
  const { bootLocalRuntime } = await import('../../src/runtime/boot-local-runtime.js');
  const { getEmbeddedRecordStore } = await import('../../src/services/vector-store/embedded-store-singleton.js');
  return { LanceVectorRecordStore, LanceRecordEngine, metadata, toRow, bootLocalRuntime, getEmbeddedRecordStore, qdrantStore, qdrantService };
}

function engineOf(store: RecordStore): RecordEngine {
  return (store as unknown as { engine: RecordEngine }).engine;
}

beforeEach(() => {
  originalCwd = process.cwd();
  originalHome = process.env.SQUADRULES_HOME;
  // `.local/` is gitignored, so a fresh CI checkout doesn't have it; ensure it
  // exists before `mkdtempSync` tries to write a scratch directory under it.
  const scratchRoot = path.join(originalCwd, '.local');
  fs.mkdirSync(scratchRoot, { recursive: true });
  scratch = fs.mkdtempSync(path.join(scratchRoot, 'embedded-width-unit-'));
  process.env.SQUADRULES_HOME = path.join(scratch, 'constructor-home');
  jest.clearAllMocks();
  tableNames.mockResolvedValue([]);
  createTable.mockImplementation(async () => ({}));
  successfulProvider.mockReturnValue(provider);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.SQUADRULES_HOME;
  else process.env.SQUADRULES_HOME = originalHome;
  jest.restoreAllMocks();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('lazy instance directory binding', () => {
  test('constructors resolve/open nothing, and getter does not open or create the directory', async () => {
    const { LanceVectorRecordStore, LanceRecordEngine } = await load();
    const store = new LanceVectorRecordStore();
    const engine = new LanceRecordEngine();
    expect(resolveDir).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    process.env.SQUADRULES_HOME = path.join(scratch, 'first-use-home');
    expect(store.getDirectory()).toBe(path.join(scratch, 'first-use-home', 'lancedb'));
    expect(engine.getDirectory()).toBe(store.getDirectory());
    expect(resolveDir).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.SQUADRULES_HOME)).toBe(false);
  });

  test.each(['getter', 'facade', 'engine', 'metadata'] as const)('%s first-use binds facade, engine and subsequent metadata reads', async (firstUse) => {
    const { LanceVectorRecordStore, metadata } = await load();
    const store = new LanceVectorRecordStore();
    const engine = engineOf(store);
    const boundHome = path.join(scratch, 'first-home');
    process.env.SQUADRULES_HOME = boundHome;
    const directory = path.join(boundHome, 'lancedb');
    metadata.writeStoreMetadata(directory, { ...provider });
    if (firstUse === 'getter') store.getDirectory();
    if (firstUse === 'facade') await store.init();
    if (firstUse === 'engine') await store.getMemory('absent');
    if (firstUse === 'metadata') expect(await engine.resolveStoredWidth()).toBe(384);
    process.env.SQUADRULES_HOME = path.join(scratch, 'foreign-home');
    metadata.writeStoreMetadata(path.join(process.env.SQUADRULES_HOME, 'lancedb'), { ...provider, dimension: 1536 });
    await store.init();
    expect(await store.getMemory('absent')).toBeNull();
    expect(await engine.resolveStoredWidth()).toBe(384);
    expect(store.getDirectory()).toBe(directory);
    expect(engine.getDirectory()).toBe(directory);
    expect(resolveDir).toHaveBeenCalledTimes(1);
    // Existing facade and engine connection lifetimes stay separate, but agree.
    expect(open.mock.calls.map(([dir]) => dir)).toEqual([directory, directory]);
  });

  test('facade binding directs first engine table creation and metadata write to the same directory', async () => {
    const { LanceVectorRecordStore, metadata, toRow } = await load();
    const store = new LanceVectorRecordStore();
    const directory = store.getDirectory();
    process.env.SQUADRULES_HOME = path.join(scratch, 'foreign-home');
    await store.init();
    await engineOf(store).ensureTableForWrite(toRow({ id: 'unit-row', payload: {} }));
    expect(open.mock.calls.map(([dir]) => dir)).toEqual([directory, directory]);
    expect(metadata.readStoreMetadata(directory)?.dimension).toBe(384);
    expect(metadata.readStoreMetadata(path.join(process.env.SQUADRULES_HOME, 'lancedb'))).toBeNull();
    expect(await engineOf(store).resolveStoredWidth()).toBe(384);
    expect(resolveDir).toHaveBeenCalledTimes(1);
  });

  test('relative explicit path resolves at first use and survives cwd/env changes', async () => {
    const { LanceVectorRecordStore } = await load();
    const store = new LanceVectorRecordStore({ databaseDir: './not-created/../records' });
    fs.mkdirSync(path.join(scratch, 'first-cwd'));
    fs.mkdirSync(path.join(scratch, 'later-cwd'));
    process.chdir(path.join(scratch, 'first-cwd'));
    const bound = path.join(scratch, 'first-cwd', 'records');
    expect(store.getDirectory()).toBe(bound);
    expect(fs.existsSync(bound)).toBe(false);
    process.chdir(path.join(scratch, 'later-cwd'));
    process.env.SQUADRULES_HOME = path.join(scratch, 'later-home');
    await store.init();
    await store.getMemory('absent');
    expect(store.getDirectory()).toBe(bound);
    expect(open.mock.calls.map(([dir]) => dir)).toEqual([bound, bound]);
    expect(resolveDir).not.toHaveBeenCalled();
  });

  test('metadata first-use on standalone engine binds relative path and writes stay bound across await', async () => {
    const { LanceRecordEngine, metadata, toRow } = await load();
    const engine = new LanceRecordEngine('./standalone');
    fs.mkdirSync(path.join(scratch, 'first-cwd'));
    fs.mkdirSync(path.join(scratch, 'later-cwd'));
    process.chdir(path.join(scratch, 'first-cwd'));
    const directory = path.join(scratch, 'first-cwd', 'standalone');
    metadata.writeStoreMetadata(directory, { ...provider, dimension: 768 });
    expect(await engine.resolveStoredWidth()).toBe(768);
    expect(open).not.toHaveBeenCalled();
    createTable.mockImplementation(async () => {
      process.chdir(path.join(scratch, 'later-cwd'));
      process.env.SQUADRULES_HOME = path.join(scratch, 'foreign-home');
      return {};
    });
    await engine.ensureTableForWrite(toRow({ id: 'unit-row', payload: {} }));
    expect(open).toHaveBeenCalledWith(directory);
    expect(metadata.readStoreMetadata(directory)?.dimension).toBe(384);
    expect(await engine.resolveStoredWidth()).toBe(384);
    expect(metadata.readStoreMetadata(path.join(scratch, 'later-cwd', 'standalone'))).toBeNull();
    expect(resolveDir).not.toHaveBeenCalled();
  });

  test.each(['s3://bucket/records', 'gs://bucket/records', 'az://container/records', 'db://database', 'file:///tmp/records'])('preserves storage URL %s', async (directory) => {
    const { LanceVectorRecordStore } = await load();
    const store = new LanceVectorRecordStore({ databaseDir: directory });
    expect(store.getDirectory()).toBe(directory);
    await store.init();
    await store.getMemory('absent');
    expect(open.mock.calls.map(([dir]) => dir)).toEqual([directory, directory]);
    expect(resolveDir).not.toHaveBeenCalled();
  });
});

describe('boot dimension-metadata diagnostic', () => {
  const deferred = { seedAdapters: 'never', loadEmbeddings: false, healthProbe: false } as const;

  test.each(['mismatch', 'matching', 'different-model', 'missing', 'corrupt-json', 'corrupt-types'] as const)('caller-owned records take precedence: %s remains warning-only', async (scenario) => {
    const { LanceVectorRecordStore, metadata, bootLocalRuntime } = await load();
    const selected = path.join(scratch, 'selected');
    const conflicting = path.join(scratch, 'conflicting');
    const store = new LanceVectorRecordStore({ databaseDir: selected });
    metadata.writeStoreMetadata(conflicting, { ...provider, dimension: 1024 });
    metadata.writeStoreMetadata(path.join(process.env.SQUADRULES_HOME!, 'lancedb'), { ...provider, dimension: 2048 });
    if (scenario !== 'missing') {
      metadata.writeStoreMetadata(selected, {
        ...provider, dimension: scenario === 'mismatch' ? 1536 : 384,
        model: scenario === 'different-model' ? 'other-model-same-dimension' : provider.model
      });
    }
    if (scenario === 'corrupt-json') fs.writeFileSync(path.join(selected, 'store-metadata.json'), '{broken');
    if (scenario === 'corrupt-types') fs.writeFileSync(path.join(selected, 'store-metadata.json'), '{"provider":1,"model":"x","dimension":"bad"}');
    const result = await bootLocalRuntime({ ...deferred, records: store, databaseDir: conflicting });
    expect(result.memoryStore).toBe(store);
    expect(result.qdrantService).toBe(store);
    expect(open).toHaveBeenCalledWith(selected);
    expect(resolveDir).not.toHaveBeenCalled();
    const mismatches = warn.mock.calls.filter(([message]) => String(message).startsWith('vector width mismatch:'));
    expect(mismatches).toHaveLength(scenario === 'mismatch' ? 1 : 0);
    if (scenario === 'mismatch') {
      expect(String(mismatches[0]![0])).toContain(selected);
      expect(String(mismatches[0]![0])).toContain('1536d');
      expect(String(mismatches[0]![0])).not.toContain(conflicting);
    }
    if (scenario.startsWith('corrupt')) expect(warn).toHaveBeenCalled();
    expect(debug.mock.calls.flat().join('\n')).not.toContain('skipped (caller-owned records store)');
    expect(ensureEmbedding).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
    expect(createTable).not.toHaveBeenCalled();
  });

  test('diagnostic binds before init without adding a native open', async () => {
    const { LanceVectorRecordStore, metadata, bootLocalRuntime } = await load();
    const store = new LanceVectorRecordStore();
    const selected = path.join(process.env.SQUADRULES_HOME!, 'lancedb');
    metadata.writeStoreMetadata(selected, { ...provider, dimension: 1536 });
    const realInit = store.init.bind(store);
    jest.spyOn(store, 'init').mockImplementation(async () => {
      expect(warn.mock.calls.flat().join('\n')).toContain('vector width mismatch:');
      expect(open).not.toHaveBeenCalled();
      process.env.SQUADRULES_HOME = path.join(scratch, 'changed-during-init');
      await realInit();
    });
    await bootLocalRuntime({ ...deferred, records: store });
    expect(store.getDirectory()).toBe(selected);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(selected);
    expect(ensureEmbedding).not.toHaveBeenCalled();
  });

  test.each(['default', 'explicit'] as const)('selected %s store supplies diagnostic directory', async (selection) => {
    const { getEmbeddedRecordStore, metadata, bootLocalRuntime } = await load();
    const explicit = path.join(scratch, 'created');
    const selected = selection === 'explicit' ? explicit : getEmbeddedRecordStore().getDirectory();
    metadata.writeStoreMetadata(selected, { ...provider, dimension: 1536 });
    await bootLocalRuntime({ ...deferred, ...(selection === 'explicit' ? { databaseDir: explicit } : {}) });
    expect(warn.mock.calls.flat().join('\n')).toContain(`store at ${selected}`);
    expect(open).toHaveBeenCalledWith(selected);
    expect(ensureEmbedding).not.toHaveBeenCalled();
  });

  test('absent successful provider runs no width diagnostic even though boot places the graph beside its store', async () => {
    const { LanceVectorRecordStore, bootLocalRuntime } = await load();
    successfulProvider.mockReturnValue(null);
    const store = new LanceVectorRecordStore();
    const directory = jest.spyOn(store, 'getDirectory');
    jest.spyOn(store, 'init').mockResolvedValue(undefined);
    await bootLocalRuntime({ ...deferred, records: store });
    // One read, for graph placement: a runtime that owns a store owns the graph beside it,
    // so two independent boots cannot share one embedded database. It is not a diagnostic —
    // with no successful provider nothing is compared, and nothing is opened.
    expect(directory).toHaveBeenCalledTimes(1);
    // `getDirectory()` resolves the store's path; resolving is a pure join, opening is not.
    expect(resolveDir).toHaveBeenCalledTimes(1);
    expect(graphInit).toHaveBeenCalledWith({
      databaseDir: path.join(process.env.SQUADRULES_HOME!, 'lancedb', 'graph')
    });
    expect(open).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(ensureEmbedding).not.toHaveBeenCalled();
  });

  test('Qdrant excludes supplied embedded records from selection and diagnostics', async () => {
    const { LanceVectorRecordStore, bootLocalRuntime, qdrantStore, qdrantService } = await load(true);
    const store = new LanceVectorRecordStore();
    const directory = jest.spyOn(store, 'getDirectory');
    const result = await bootLocalRuntime({ ...deferred, records: store, databaseDir: './ignored' });
    expect(result.memoryStore).toBe(qdrantStore);
    expect(result.qdrantService).toBe(qdrantService);
    expect(qdrantStore.init).toHaveBeenCalledTimes(1);
    expect(qdrantStore.checkHealth).not.toHaveBeenCalled();
    expect(directory).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(ensureEmbedding).not.toHaveBeenCalled();
  });

  test('auto seed still asks selected records and avoids embedding a warm store', async () => {
    const { LanceVectorRecordStore, bootLocalRuntime } = await load();
    const store = new LanceVectorRecordStore({ databaseDir: path.join(scratch, 'warm') });
    const scroll = jest.spyOn(store, 'scrollSpace').mockResolvedValue([{
      uuid: 'unit-adapter-layer', payload: {
        slug: 'unit-adapter', space_id: appSpace, content_type: 'text/markdown'
      } as never
    }]);
    const result = await bootLocalRuntime({ ...deferred, records: store, seedAdapters: 'auto' });
    expect(result.memoryStore).toBe(store);
    expect(scroll).toHaveBeenCalledWith(appSpace, { paginate: true });
    expect(ensureEmbedding).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
  });

  test('default boot still probes and seeds', async () => {
    const { LanceVectorRecordStore, bootLocalRuntime } = await load();
    const store = new LanceVectorRecordStore({ databaseDir: path.join(scratch, 'defaults') });
    await bootLocalRuntime({ records: store });
    expect(ensureEmbedding).toHaveBeenCalledTimes(1);
    expect(inject).toHaveBeenCalledWith(store, { force: false });
  });
});
