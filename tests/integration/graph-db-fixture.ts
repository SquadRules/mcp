/**
 * Shared harness for the graph-native integration suites (ADR 0042–0047).
 *
 * Every value here is a production object or a production call — nothing is
 * stubbed:
 *
 *   - `openGraphDb()`        real backend (embedded LadybugDB by default, real
 *                            ArangoDB when the caller selects it), explicit dir.
 *   - `LanceVectorRecordStore({ databaseDir })` real embedded LanceDB.
 *   - `createEmbeddedRuntime(records)` binds one store to both tool facades.
 *   - `executeTrainStore` / `executeTune` / `executeExportVersion` are the same
 *     functions the MCP tools call, so history, proposals and validation are the
 *     production ones.
 *   - `runWithSpaceContextAsync` is the real tenant context; `userId` is what
 *     `resolveGraphActor()` reads, so identity in these suites comes from the
 *     same place a request's identity comes from.
 *
 * Embeddings: the write path embeds activation text. Forcing the `tei` provider
 * with no endpoint makes the real provider call fail immediately and the writer
 * fall back to zero vectors. Nothing reaches the network and no embedding call is
 * replaced.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Memory } from '../../src/types/memory.js';
import type { MemoryQdrantStore } from '../../src/services/memory/store.js';
import type { QdrantService } from '../../src/services/qdrant/service.js';
import type { GraphRepository } from '../../src/services/graph-db/graph-repository.js';
import type { SpaceContext } from '../../src/utils/tenant-context.js';
import type { LanceVectorRecordStore } from '../../src/services/vector-store/lancedb/LanceVectorRecordStore.js';

type GraphSingletonModule = typeof import('../../src/services/graph-db/graph-db-singleton.js');
type ScopeModule = typeof import('../../src/services/graph-db/adapter-scope.js');
type OwnerModule = typeof import('../../src/services/graph-db/graph-owner.js');
type LanceStoreModule = typeof import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
type EmbeddedRuntimeModule = typeof import('../../src/services/vector-store/embedded-runtime.js');
type TenantModule = typeof import('../../src/utils/tenant-context.js');
type TrainStoreModule = typeof import('../../src/tools/train-store.js');
type TuneExecuteModule = typeof import('../../src/tools/tune-execute.js');
type ExportHistoryModule = typeof import('../../src/tools/export-history.js');
type EvolutionModule = typeof import('../../src/services/graph-db/evolution/evolution.service.js');
type ActivateOntologyModule = typeof import('../../src/tools/activate-ontology-context.js');
type ActivateSchemaModule = typeof import('../../src/tools/activate_schema.js');

/** Production modules, imported after the env is set (see `loadProductionModules`). */
export interface ProductionModules {
  graphSingleton: GraphSingletonModule;
  scope: ScopeModule;
  owner: OwnerModule;
  lanceStore: LanceStoreModule;
  embeddedRuntime: EmbeddedRuntimeModule;
  tenant: TenantModule;
  trainStore: TrainStoreModule;
  tuneExecute: TuneExecuteModule;
  exportHistory: ExportHistoryModule;
  evolution: EvolutionModule;
  activateOntology: ActivateOntologyModule;
  activateSchema: ActivateSchemaModule;
  appSpaceId: string;
}

/** One embedded runtime: one record store, one graph, both explicit. */
export interface Runtime {
  label: string;
  graph: GraphRepository;
  /** Directories this runtime owns, so a suite can close and reopen the graph. */
  dirs: { graph: string; records: string };
  records: LanceVectorRecordStore;
  memoryStore: MemoryQdrantStore;
  qdrantService: QdrantService;
}

/**
 * Load every production module the graph suites share.
 *
 * `jest.resetModules()` drops any `src/config` instance the global setup loaded,
 * so the environment applied here is what the freshly imported modules see.
 */
export async function loadProductionModules(
  env: Record<string, string | undefined> = {}
): Promise<ProductionModules> {
  jest.resetModules();
  process.env['SQUADRULES_GRAPH_DB_ENABLED'] = 'true';
  process.env['EMBEDDING_PROVIDER'] = 'tei';
  delete process.env['TEI_BASE_URL'];
  delete process.env['TEI_MODEL'];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const graphSingleton = await import('../../src/services/graph-db/graph-db-singleton.js');
  const scope = await import('../../src/services/graph-db/adapter-scope.js');
  const owner = await import('../../src/services/graph-db/graph-owner.js');
  const lanceStore = await import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
  const embeddedRuntime = await import('../../src/services/vector-store/embedded-runtime.js');
  const tenant = await import('../../src/utils/tenant-context.js');
  const trainStore = await import('../../src/tools/train-store.js');
  const tuneExecute = await import('../../src/tools/tune-execute.js');
  const exportHistory = await import('../../src/tools/export-history.js');
  const evolution = await import('../../src/services/graph-db/evolution/evolution.service.js');
  const activateOntology = await import('../../src/tools/activate-ontology-context.js');
  const activateSchema = await import('../../src/tools/activate_schema.js');
  const embeddingConfig = await import('../../src/services/embedding/config.js');
  const config = await import('../../src/config.js');

  embeddingConfig.setResolvedEmbeddingDimension(384);
  return {
    graphSingleton,
    scope,
    owner,
    lanceStore,
    embeddedRuntime,
    tenant,
    trainStore,
    tuneExecute,
    exportHistory,
    evolution,
    activateOntology,
    activateSchema,
    appSpaceId: config.SQUADRULES_APP_SPACE_ID
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
  /** Nested `anomaly:` block, emitted as indented sub-keys. */
  anomaly?: Record<string, string>;
  /** Body sections between `Activation Patterns` and the contract fence. */
  sections: Array<{ heading: string; body: string }>;
  /** The `contract` object placed in the single ```json fence. */
  contract: Record<string, unknown>;
  reward?: string;
}

/**
 * A structurally valid adapter document with exactly one contract fence, so the
 * writer produces exactly one layer and the effective-content resolver has a
 * parent body to merge against.
 */
export function adapterDoc(spec: DocSpec): string {
  const frontmatter = [`slug: ${spec.slug}`, `version: ${spec.version}`];
  if (spec.inherits) frontmatter.push(`inherits: ${spec.inherits}`);
  if (spec.override && spec.override.length > 0) frontmatter.push(`override: [${spec.override.join(', ')}]`);
  for (const [key, value] of Object.entries(spec.extraFrontmatter ?? {})) {
    frontmatter.push(`${key}: ${value}`);
  }
  if (spec.anomaly) {
    frontmatter.push('anomaly:');
    for (const [key, value] of Object.entries(spec.anomaly)) frontmatter.push(`  ${key}: ${value}`);
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
  for (const section of spec.sections) lines.push('', `## ${section.heading}`, '', section.body);
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

/** Minimal valid contract payload for documents that are not under contract test. */
export function commentContract(text: string): Record<string, unknown> {
  return { type: 'comment', comment: { text } };
}

// --- fixture lifecycle -------------------------------------------------------

/**
 * Owns the temporary directories, graphs and stores one suite creates, and the
 * production calls the suite makes. The creator closes what it opened.
 */
export class GraphFixture {
  private readonly tempDirs: string[] = [];
  private readonly graphs: GraphRepository[] = [];

  constructor(readonly modules: ProductionModules) {}

  /** Real temp directory, removed by `dispose()`. */
  tempDir(label: string): string {
    const dir = mkdtempSync(join(tmpdir(), `squadrules-${label}-`));
    this.tempDirs.push(dir);
    return dir;
  }

  /** Run `fn` inside the real tenant context for `spaceId`, as `userId`. */
  onSpace<T>(spaceId: string, fn: () => Promise<T>, userId = 'user-it'): Promise<T> {
    const context: SpaceContext = {
      userId,
      groupIds: [],
      allowedSpaceIds: [spaceId, this.modules.appSpaceId],
      defaultWriteSpaceId: spaceId,
      personalSpaceId: spaceId,
      spaceNamesById: {},
      requestId: 'graph-db-it'
    };
    return this.modules.tenant.runWithSpaceContextAsync(context, fn);
  }

  /** Space context object for a suite that needs to assert on it directly. */
  spaceContext(spaceId: string, userId = 'user-it'): SpaceContext {
    return {
      userId,
      groupIds: [],
      allowedSpaceIds: [spaceId, this.modules.appSpaceId],
      defaultWriteSpaceId: spaceId,
      personalSpaceId: spaceId,
      spaceNamesById: {},
      requestId: 'graph-db-it'
    };
  }

  /** Open a real graph + real record store at explicit directories for one runtime. */
  async openRuntime(label: string, options: { attach?: boolean } = {}): Promise<Runtime> {
    const dir = this.tempDir(`rt-${label}`);
    const graph = await this.modules.graphSingleton.openGraphDb({ databaseDir: join(dir, 'graph') });
    if (!graph) throw new Error(`graph backend did not open for runtime ${label}`);
    const records = new this.modules.lanceStore.LanceVectorRecordStore({ databaseDir: join(dir, 'records') });
    await records.init();
    const bound = this.modules.embeddedRuntime.createEmbeddedRuntime(records);
    if (options.attach !== false) this.modules.owner.attachGraphDb(graph, bound.memoryStore);
    this.graphs.push(graph);
    return {
      label,
      graph,
      dirs: { graph: join(dir, 'graph'), records: join(dir, 'records') },
      records,
      memoryStore: bound.memoryStore,
      qdrantService: bound.qdrantService
    };
  }

  /** Real file whose first line is PASS — the critic verdict the tune gate reads. */
  verdictFile(): string {
    const path = join(this.tempDir('verdict'), 'verdict.txt');
    writeFileSync(path, 'PASS\n', 'utf8');
    return path;
  }

  /** Open a graph at an explicit directory (used to prove history survives a reopen). */
  async openGraphAt(databaseDir: string): Promise<GraphRepository> {
    const graph = await this.modules.graphSingleton.openGraphDb({ databaseDir });
    if (!graph) throw new Error(`graph backend did not open at ${databaseDir}`);
    this.graphs.push(graph);
    return graph;
  }

  /** Production `train`. Returns the stored head layer uuid and the tool output. */
  async train(
    runtime: Runtime,
    spaceId: string,
    doc: string,
    options: { expectedVersion?: string; forceUpdate?: boolean } = {}
  ) {
    const output = await this.onSpace(spaceId, () =>
      this.modules.trainStore.executeTrainStore(
        runtime.memoryStore,
        {
          content: doc,
          llm_model_id: 'test-model',
          force_update: options.forceUpdate ?? true,
          ...(options.expectedVersion !== undefined && { expected_version: options.expectedVersion })
        },
        (fn) => fn()
      )
    );
    return { output, headUuid: output.items[0]!.layer_uuid! };
  }

  /** Production `tune` of one adapter URI with a full markdown body. */
  async tune(
    runtime: Runtime,
    spaceId: string,
    uri: string,
    content: string,
    options: { expectedVersion?: string } = {}
  ) {
    return this.onSpace(spaceId, () =>
      this.modules.tuneExecute.executeTune(
        runtime.qdrantService,
        {
          uris: [uri],
          content: [content],
          review_evidence: { verdict_file: this.verdictFile(), exit_code: 0, stdout: 'PASS' },
          ...(options.expectedVersion !== undefined && { expected_version: options.expectedVersion })
        },
        runtime.memoryStore
      )
    );
  }

  /** Stored head record, read through the same surfaced record the tools read. */
  async storedHead(runtime: Runtime, headUuid: string): Promise<Memory> {
    const memory = await runtime.records.getMemory(headUuid, { fresh: true });
    if (!memory) throw new Error(`stored head ${headUuid} is not readable`);
    return memory;
  }

  /** Ancestor slugs from the root down to the adapter's parent (root first). */
  async pathSlugs(runtime: Runtime, spaceId: string, slug: string): Promise<string[]> {
    // Explicit order: the port defaults to nearest-first; parity asserts a stated order.
    const key = this.modules.scope.adapterGraphKey(spaceId, slug);
    const path = await runtime.graph.findPathToRoot(key, 'root-first');
    return path.map((row) => ('slug' in row.ancestor ? row.ancestor.slug : row.ancestor.name));
  }

  /** Close every graph this fixture opened and delete every temp directory. */
  async dispose(): Promise<void> {
    for (const graph of this.graphs) {
      try {
        await graph.close();
      } catch {
        // Already closed by the test that exercised close(); nothing to release.
      }
    }
    this.graphs.length = 0;
    for (const dir of this.tempDirs) rmSync(dir, { recursive: true, force: true });
    this.tempDirs.length = 0;
    delete process.env['EMBEDDING_PROVIDER'];
  }
}
