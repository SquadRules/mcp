/**
 * Shared fixture for the inheritance end-to-end integration suites.
 *
 * This is NOT a test file (no `.test.ts`), so Jest never runs it directly: it exists so
 * the three suites that exercise delivery contracts 1, 2 and 4 do not each carry a copy
 * of the same real-database bootstrap. Everything here is a production object or a
 * production call — there are no mocks, stubs, spies or module fakes:
 *
 *   - `LanceVectorRecordStore({ databaseDir })` opens a real embedded LanceDB at an
 *     explicit directory. `createEmbeddedRuntime(records)` binds that one store to the
 *     two facades the tool layer is handed, so a layer written by `train` is read back
 *     by `tune` and the effective-content resolver from the same records.
 *   - `openGraphDb({ databaseDir })` opens a real embedded LadybugDB; `attachGraphDb`
 *     gives it to exactly one runtime, so two runtimes in one process never share state.
 *   - `executeTrainStore` / `executeTune` are the production tool implementations: the
 *     same functions the MCP tools call, including protocol validation, inheritance
 *     validation against the stored parent, the memory write, and the graph projection.
 *   - `resolveEffectiveLayerContent` / `applyEffectiveContent` /
 *     `buildMergedAdapterContent` are the exact functions `activate` and `forward` call,
 *     so "the contract activate shows" and "the contract forward executes" are compared
 *     without re-implementing either side.
 *   - `InheritanceCheckpointService` writes real files into a real directory.
 *
 * The graph is typed as the `GraphRepository` PORT, not the LadybugDB class: `openGraphDb`
 * returns the port (ADR 0044), so a suite here would keep working unchanged against the
 * shared ArangoDB implementation.
 *
 * Embeddings: the write path embeds activation text. The fixture forces the `tei`
 * provider with no endpoint, which fails immediately and makes the writer fall back to
 * zero vectors. Nothing here reaches the network and no embedding call is stubbed — the
 * real provider call runs and really fails over.
 *
 * Module bindings are `export let` on purpose: `loadInheritanceFixture()` assigns them
 * after `jest.resetModules()` and ESM live bindings make the assignment visible to every
 * importing suite, so a suite reads `scope.adapterGraphKey(...)` exactly as it would if
 * the import were local.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SpaceContext } from '../../src/utils/tenant-context.js';
import type { Memory } from '../../src/types/memory.js';
import type { MemoryQdrantStore } from '../../src/services/memory/store.js';
import type { QdrantService } from '../../src/services/qdrant/service.js';
import type { LanceVectorRecordStore } from '../../src/services/vector-store/lancedb/LanceVectorRecordStore.js';
import type { GraphRepository } from '../../src/services/graph-db/graph-repository.js';

// --- production modules, loaded after the env is set (see loadInheritanceFixture) ---
type GraphSingletonModule = typeof import('../../src/services/graph-db/graph-db-singleton.js');
type ScopeModule = typeof import('../../src/services/graph-db/adapter-scope.js');
type OwnerModule = typeof import('../../src/services/graph-db/graph-owner.js');
type LanceStoreModule = typeof import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
type EmbeddedRuntimeModule = typeof import('../../src/services/vector-store/embedded-runtime.js');
type TenantModule = typeof import('../../src/utils/tenant-context.js');
type TrainStoreModule = typeof import('../../src/tools/train-store.js');
type TuneExecuteModule = typeof import('../../src/tools/tune-execute.js');
type EffectiveContentModule = typeof import('../../src/tools/adapter-effective-content.js');
type CheckpointModule = typeof import('../../src/services/graph-db/inheritance-checkpoint.js');

export let graphSingleton: GraphSingletonModule;
export let scope: ScopeModule;
export let owner: OwnerModule;
export let lanceStore: LanceStoreModule;
export let embeddedRuntime: EmbeddedRuntimeModule;
export let tenant: TenantModule;
export let trainStore: TrainStoreModule;
export let tuneExecute: TuneExecuteModule;
export let effective: EffectiveContentModule;
export let checkpoints: CheckpointModule;

/** App space id as the production config resolves it (never re-typed by a suite). */
export let appSpaceId: string;

export const SPACE_A = 'space:it-inherit-a';
export const SPACE_B = 'group:it-inherit-b';

/** Every temporary directory this suite created, removed in `disposeInheritanceFixture`. */
const tempDirs: string[] = [];
/** Every graph this suite opened — the creator closes what it opened. */
const openedGraphs: GraphRepository[] = [];

/** One embedded runtime: one record store, one graph, both explicit. */
export interface Runtime {
  label: string;
  graph: GraphRepository;
  records: LanceVectorRecordStore;
  memoryStore: MemoryQdrantStore;
  qdrantService: QdrantService;
}

export function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `squadrules-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function spaceContext(spaceId: string): SpaceContext {
  return {
    userId: 'user-it',
    groupIds: [],
    allowedSpaceIds: [spaceId, appSpaceId],
    defaultWriteSpaceId: spaceId,
    personalSpaceId: spaceId,
    spaceNamesById: {},
    requestId: 'adapter-inheritance-it'
  };
}

/** Run `fn` inside the real tenant context for `spaceId`. */
export function onSpace<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
  return tenant.runWithSpaceContextAsync(spaceContext(spaceId), fn);
}

/**
 * Open a real graph and a real record store at explicit directories and bind them to
 * one runtime. `attach: false` deliberately leaves the runtime without a graph so a
 * suite can train a parent while nothing is projected.
 */
export async function openRuntime(label: string, options: { attach?: boolean } = {}): Promise<Runtime> {
  const dir = tempDir(`rt-${label}`);
  const graph = await graphSingleton.openGraphDb({ databaseDir: join(dir, 'graph') });
  expect(graph).not.toBeNull();
  const records = new lanceStore.LanceVectorRecordStore({ databaseDir: join(dir, 'records') });
  await records.init();
  const bound = embeddedRuntime.createEmbeddedRuntime(records);
  if (options.attach !== false) owner.attachGraphDb(graph!, bound.memoryStore);
  openedGraphs.push(graph!);
  return {
    label,
    graph: graph!,
    records,
    memoryStore: bound.memoryStore,
    qdrantService: bound.qdrantService
  };
}

// --- fixture documents -------------------------------------------------------

export interface DocSpec {
  slug: string;
  version: string;
  title: string;
  inherits?: string;
  override?: string[];
  /** Arbitrary author-declared frontmatter properties (domain data). */
  extraFrontmatter?: Record<string, string>;
  /** Body sections between `Activation Patterns` and the contract fence. */
  sections: Array<{ heading: string; body: string }>;
  /** The `contract` object placed in the single ```json fence. */
  contract: Record<string, unknown>;
  reward?: string;
}

/**
 * A structurally valid adapter document with exactly one contract fence.
 *
 * That shape matters: the writer slices layers on `json` contract fences, so one fence
 * means one layer whose `text` is every section before the fence. The trailing
 * `## Reward Signal` section becomes `adapter.reward_signal`, exactly as in production.
 */
export function adapterDoc(spec: DocSpec): string {
  const frontmatter = [`slug: ${spec.slug}`, `version: ${spec.version}`];
  if (spec.inherits) frontmatter.push(`inherits: ${spec.inherits}`);
  if (spec.override && spec.override.length > 0) {
    frontmatter.push(`override: [${spec.override.join(', ')}]`);
  }
  for (const [key, value] of Object.entries(spec.extraFrontmatter ?? {})) {
    frontmatter.push(`${key}: ${value}`);
  }

  const lines = [
    '---',
    ...frontmatter,
    '---',
    '',
    `# ${spec.title}`,
    '',
    '## Activation Patterns',
    '',
    `- ${spec.slug}`
  ];
  for (const section of spec.sections) {
    lines.push('', `## ${section.heading}`, '', section.body);
  }
  lines.push(
    '',
    '```json',
    JSON.stringify({ contract: spec.contract }),
    '```',
    '',
    '## Reward Signal',
    '',
    spec.reward ?? 'Done.'
  );
  return lines.join('\n');
}

export function commentContract(text: string): Record<string, unknown> {
  return { type: 'comment', comment: { text } };
}

/** Production `train`: validate, write, project. Returns the stored head layer uuid. */
export async function train(runtime: Runtime, spaceId: string, doc: string): Promise<string> {
  const output = await onSpace(spaceId, () =>
    trainStore.executeTrainStore(
      runtime.memoryStore,
      { content: doc, llm_model_id: 'test-model', force_update: true },
      (fn) => fn()
    )
  );
  const head = output.items[0]?.layer_uuid;
  expect(typeof head).toBe('string');
  return head!;
}

/** Stored head record, read through the same surfaced record the tools read. */
export async function storedHead(runtime: Runtime, headUuid: string): Promise<Memory> {
  const memory = await runtime.records.getMemory(headUuid, { fresh: true });
  expect(memory).not.toBeNull();
  return memory!;
}

/** Ancestor slugs on the path from the root down to the child's parent (root first). */
export async function pathSlugs(runtime: Runtime, spaceId: string, slug: string): Promise<string[]> {
  // Explicit order: the port defaults to nearest-first, this assertion is root-first.
  const path = await runtime.graph.findPathToRoot(scope.adapterGraphKey(spaceId, slug), 'root-first');
  // The path is a mixed ontology walk (adapters and concepts), so the display name has
  // to be read off whichever node kind the edge landed on.
  return path.map((row) => ('slug' in row.ancestor ? row.ancestor.slug : row.ancestor.name));
}

/** Set the env, load every production module, and resolve the app space id. */
export async function loadInheritanceFixture(): Promise<void> {
  // Deterministic, network-free embedding path. `jest.resetModules()` drops any
  // `src/config` instance the global setup may have loaded, so the env below is what
  // the freshly imported modules see.
  jest.resetModules();
  process.env['SQUADRULES_GRAPH_DB_ENABLED'] = 'true';
  process.env['EMBEDDING_PROVIDER'] = 'tei';
  delete process.env['TEI_BASE_URL'];
  delete process.env['TEI_MODEL'];

  graphSingleton = await import('../../src/services/graph-db/graph-db-singleton.js');
  scope = await import('../../src/services/graph-db/adapter-scope.js');
  owner = await import('../../src/services/graph-db/graph-owner.js');
  lanceStore = await import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
  embeddedRuntime = await import('../../src/services/vector-store/embedded-runtime.js');
  tenant = await import('../../src/utils/tenant-context.js');
  trainStore = await import('../../src/tools/train-store.js');
  tuneExecute = await import('../../src/tools/tune-execute.js');
  effective = await import('../../src/tools/adapter-effective-content.js');
  checkpoints = await import('../../src/services/graph-db/inheritance-checkpoint.js');

  const embeddingConfig = await import('../../src/services/embedding/config.js');
  const config = await import('../../src/config.js');
  appSpaceId = config.SQUADRULES_APP_SPACE_ID;
  embeddingConfig.setResolvedEmbeddingDimension(384);
}

/** Close every graph this fixture opened and remove every temp directory. */
export async function disposeInheritanceFixture(): Promise<void> {
  for (const graph of openedGraphs) {
    try {
      await graph.close();
    } catch {
      // Already closed by the test that exercised close(); nothing left to release.
    }
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env['EMBEDDING_PROVIDER'];
}
