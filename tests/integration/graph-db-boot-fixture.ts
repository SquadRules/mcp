/**
 * Harness for the warm-boot graph reconciliation suite — NO MOCKS.
 *
 * Everything the suite touches is a production object or a production call:
 *
 *   - `bootLocalRuntime()`  the real boot sequence: store init, graph open,
 *                           mem-resource injection decision, graph reconcile.
 *   - `LanceVectorRecordStore({ databaseDir })`  real embedded LanceDB.
 *   - `storeAdapter()`      the real write path, inside the real tenant context,
 *                           so a seeded record is byte-for-byte what `train` stores.
 *   - `runWithSpaceContextAsync()`  the real tenant context.
 *
 * Embeddings: the write path really calls the configured provider. This suite forces
 * `tei` with no endpoint, so the real provider call fails immediately and the writer
 * falls back to zero vectors (see `lance-records-write-helpers.ts`). Nothing reaches
 * the network and no embedding function is replaced. Boot runs with
 * `loadEmbeddings: false`, so the warm path never probes a model.
 *
 * "Store seeded as setup": every record here is written BEFORE the boot under test,
 * and each seeding call is labelled as setup at its call site. Assertions then read
 * only what the boot produced.
 *
 * Paths: `SQUADRULES_HOME` is repointed per scenario, so each one owns its graph
 * directories, and `<home>/lancedb` is the lane `resolveLanceDbDir()` names — the process
 * default, not an assumption about where a runtime's store lives. A scenario that wants
 * its store elsewhere opens one elsewhere (`openStore` takes any directory): the boot's
 * warm-seed decision asks the store it was handed, never this default lane. A brand-new
 * graph directory stands in for a lost graph; nothing is deleted to simulate loss. Every
 * env key this suite repoints is restored on teardown, so the next suite in this
 * worker keeps the isolated test home `tests/setup.ts` installed.
 *
 * Teardown: the graphs a boot opened are closed through the boot path's own shutdown
 * (`closeGraphDb()`), never by hand. The embedded record store exposes no `close()`
 * (its Lance connection has no close API), so its bytes are released with the temp
 * directory at the end of the suite.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Memory } from '../../src/types/memory.js';
import type { SpaceContext } from '../../src/utils/tenant-context.js';
import type { LanceVectorRecordStore } from '../../src/services/vector-store/lancedb/LanceVectorRecordStore.js';

type BootModule = typeof import('../../src/runtime/boot-local-runtime.js');
type GraphSingletonModule = typeof import('../../src/services/graph-db/graph-db-singleton.js');
type SyncModule = typeof import('../../src/services/graph-db/adapter-graph-sync.js');
type ScopeModule = typeof import('../../src/services/graph-db/adapter-scope.js');
type OwnerModule = typeof import('../../src/services/graph-db/graph-owner.js');
type LanceStoreModule = typeof import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
type TenantModule = typeof import('../../src/utils/tenant-context.js');
type FrontmatterModule = typeof import('../../src/utils/frontmatter.js');
type VersionCompareModule = typeof import('../../src/utils/version-compare.js');

/** Production modules, imported after the environment is applied. */
export interface BootModules {
  boot: BootModule;
  graphSingleton: GraphSingletonModule;
  sync: SyncModule;
  scope: ScopeModule;
  owner: OwnerModule;
  lanceStore: LanceStoreModule;
  tenant: TenantModule;
  frontmatter: FrontmatterModule;
  versionCompare: VersionCompareModule;
  /** App space id as production config resolves it (never re-typed here). */
  appSpaceId: string;
  /** Real bundled mem directory — the shipped copy a warm store may be newer than. */
  bundledMemDir: string;
}

/** One real boot: the runtime it produced and the graph directory it opened. */
export interface BootedRuntime {
  graphDir: string;
  runtime: Awaited<ReturnType<BootModule['bootLocalRuntime']>>;
}

/** One stored record, identified by uuid and by the sha256 of its whole payload. */
export interface StoredRecordFingerprint {
  uuid: string;
  spaceId: string;
  slug: string;
  version: string;
  /** Any rewrite of any stored field changes this digest. */
  payloadSha256: string;
}

export interface SpaceFingerprint {
  count: number;
  records: StoredRecordFingerprint[];
}

/** Env keys this suite repoints; previous values are restored on teardown. */
const MANAGED_ENV_KEYS = [
  'SQUADRULES_HOME',
  'SQUADRULES_GRAPH_DB_PATH',
  'SQUADRULES_GRAPH_DB_ENABLED',
  'SQUADRULES_GRAPH_BACKEND',
  'SQUADRULES_GRAPH_BACKEND_STRICT',
  'QDRANT_URL',
  'EMBEDDING_PROVIDER',
  'TEI_BASE_URL',
  'TEI_MODEL'
] as const;

const envBefore = new Map<string, string | undefined>();

function rememberBootEnv(): void {
  for (const key of MANAGED_ENV_KEYS) {
    if (!envBefore.has(key)) envBefore.set(key, process.env[key]);
  }
}

/** Put every managed key back, so this suite leaves no env puzzle behind. */
export function restoreBootEnv(): void {
  for (const [key, value] of envBefore) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  envBefore.clear();
}

/**
 * Load the production modules after the environment is applied.
 *
 * The suite runs in its own Jest module registry and this fixture has no non-type
 * `src/**` imports of its own, so `isQdrantConfigured` (a module constant) and every
 * peer below are evaluated for the first time with the env applied here. No
 * `jest.resetModules()` is needed (and none is allowed here:
 * `scripts/lint-verify-clean-source.mjs` bans `@jest/globals` in this directory).
 */
export async function loadBootModules(): Promise<BootModules> {
  rememberBootEnv();
  process.env['SQUADRULES_GRAPH_DB_ENABLED'] = 'true';
  process.env['SQUADRULES_GRAPH_BACKEND'] = 'embedded';
  delete process.env['SQUADRULES_GRAPH_BACKEND_STRICT'];
  delete process.env['SQUADRULES_GRAPH_DB_PATH'];
  delete process.env['QDRANT_URL'];
  process.env['EMBEDDING_PROVIDER'] = 'tei';
  delete process.env['TEI_BASE_URL'];
  delete process.env['TEI_MODEL'];

  const boot = await import('../../src/runtime/boot-local-runtime.js');
  const graphSingleton = await import('../../src/services/graph-db/graph-db-singleton.js');
  const sync = await import('../../src/services/graph-db/adapter-graph-sync.js');
  const scope = await import('../../src/services/graph-db/adapter-scope.js');
  const owner = await import('../../src/services/graph-db/graph-owner.js');
  const lanceStore = await import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
  const tenant = await import('../../src/utils/tenant-context.js');
  const frontmatter = await import('../../src/utils/frontmatter.js');
  const versionCompare = await import('../../src/utils/version-compare.js');
  const embeddingConfig = await import('../../src/services/embedding/config.js');
  const config = await import('../../src/config.js');

  // The write path needs a resolved dimension; the probe itself is deliberately not
  // run (no provider is reachable) — this is the same seam every graph suite uses.
  embeddingConfig.setResolvedEmbeddingDimension(384);

  return {
    boot,
    graphSingleton,
    sync,
    scope,
    owner,
    lanceStore,
    tenant,
    frontmatter,
    versionCompare,
    appSpaceId: config.SQUADRULES_APP_SPACE_ID,
    bundledMemDir: fileURLToPath(new URL('../../src/embed-docs/mem', import.meta.url))
  };
}

/** Owns the temporary homes, stores and graphs one suite creates. */
export class BootFixture {
  private readonly tempDirs: string[] = [];

  constructor(readonly modules: BootModules) {}

  private tempDir(label: string): string {
    const dir = mkdtempSync(join(tmpdir(), `squadrules-${label}-`));
    this.tempDirs.push(dir);
    return dir;
  }

  /**
   * Point the process at a fresh `SQUADRULES_HOME` and return the process-default lane.
   *
   * `recordsDir` is what `resolveLanceDbDir()` reports for this home — only the default.
   * A scenario may keep its store anywhere and still boot it, because the warm-seed
   * decision reads the store it was handed, not this path.
   */
  freshHome(label: string): { home: string; recordsDir: string } {
    const home = this.tempDir(`home-${label}`);
    process.env['SQUADRULES_HOME'] = home;
    return { home, recordsDir: join(home, 'lancedb') };
  }

  /**
   * A real embedded record store at an explicit directory (caller-owned handle).
   *
   * The directory may be anywhere, including a second store in the same process: the
   * store itself, not the process environment, is what the runtime reads and writes.
   */
  async openStore(recordsDir: string): Promise<LanceVectorRecordStore> {
    const store = new this.modules.lanceStore.LanceVectorRecordStore({ databaseDir: recordsDir });
    await store.init();
    return store;
  }

  /**
   * SETUP: write real adapter documents into the app space through the real write
   * path. These records are the authority the boot reconciliation must project.
   */
  async seed(store: LanceVectorRecordStore, docs: string[]): Promise<Memory[]> {
    const written: Memory[] = [];
    for (const doc of docs) {
      const layers = await this.modules.tenant.runWithSpaceContextAsync(
        this.appSpaceContext(),
        () => store.storeAdapter([doc], 'test-model', { forceUpdate: true })
      );
      written.push(...layers);
    }
    return written;
  }

  /**
   * Boot the real runtime against `store`, opening its graph at `graphPath`.
   *
   * The directory is passed as this boot's own `graphDatabaseDir`: a runtime that owns its
   * store colocates the graph beside that store, and the process-wide
   * `SQUADRULES_GRAPH_DB_PATH` must not let two independent boots in one process contend
   * for the same embedded database file. The env key is neutralised in `loadBootModules`,
   * so this option is the only thing steering the graph here.
   */
  async boot(graphPath: string, store: LanceVectorRecordStore): Promise<BootedRuntime> {
    const runtime = await this.modules.boot.bootLocalRuntime({
      records: store,
      graphDatabaseDir: graphPath,
      // Warm path: the store already holds records, so the boot skips bundled injection
      // and never probes an embedding model. A probe with this suite's unreachable
      // provider throws, so a wrongly-taken seeding branch fails the scenario loudly
      // instead of quietly re-embedding.
      seedAdapters: 'auto',
      // Pinned, not inherited: a developer's `MEM_BOOT_FORCE_INJECT=true` would otherwise
      // turn every warm scenario into a delete-then-retrain seeding run.
      forceSeed: false,
      loadEmbeddings: false,
      healthProbe: false
    });
    return { graphDir: graphPath, runtime };
  }

  /** Close what the boot path itself opened, through its own shutdown. */
  async closeBootedGraphs(): Promise<void> {
    await this.modules.graphSingleton.closeGraphDb();
  }

  /** Stored records of one space, digested so any rewrite is visible. */
  async fingerprint(store: LanceVectorRecordStore, spaceId: string): Promise<SpaceFingerprint> {
    const records = await store.scrollSpace(spaceId, { paginate: true });
    return {
      count: records.length,
      records: records
        .map((record) => ({
          uuid: record.uuid,
          spaceId: record.payload.space_id ?? '',
          slug: record.payload.slug ?? '',
          version: record.payload.adapter?.protocol_version ?? '',
          payloadSha256: createHash('sha256').update(JSON.stringify(record.payload)).digest('hex')
        }))
        .sort((a, b) => a.uuid.localeCompare(b.uuid))
    };
  }

  /** The shipped bundled adapter document for `slug` (real mem directory). */
  bundledAdapter(slug: string): { markdown: string; version: string } {
    const markdown = readFileSync(join(this.modules.bundledMemDir, `${slug}.md`), 'utf8');
    return { markdown, version: this.modules.frontmatter.parseFrontmatter(markdown).version ?? '' };
  }

  /** App-space context, identical in shape to the one boot injection runs under. */
  appSpaceContext(): SpaceContext {
    return {
      userId: '',
      groupIds: [],
      allowedSpaceIds: [this.modules.appSpaceId],
      defaultWriteSpaceId: this.modules.appSpaceId,
      personalSpaceId: '',
      spaceNamesById: {},
      requestId: 'graph-db-boot-it'
    };
  }

  /** Close the booted graphs, remove every temp directory, restore the env. */
  async dispose(): Promise<void> {
    await this.closeBootedGraphs();
    for (const dir of this.tempDirs) rmSync(dir, { recursive: true, force: true });
    this.tempDirs.length = 0;
    restoreBootEnv();
  }
}

/** A well-formed adapter document; `inherits` drives the topology. */
export function adapterMarkdown(input: {
  slug: string;
  version: string;
  title: string;
  inherits?: string;
  extraFrontmatter?: Record<string, string>;
  contractText: string;
}): string {
  const frontmatter = [`slug: ${input.slug}`, `version: ${input.version}`];
  if (input.inherits) frontmatter.push(`inherits: ${input.inherits}`);
  for (const [key, value] of Object.entries(input.extraFrontmatter ?? {})) {
    frontmatter.push(`${key}: ${value}`);
  }
  return [
    '---',
    ...frontmatter,
    '---',
    '',
    `# ${input.title}`,
    '',
    '## Activation Patterns',
    '',
    `- ${input.slug}`,
    '',
    '## Step 1',
    '',
    input.contractText,
    '',
    '```json',
    '{"contract": {"type": "comment", "comment": {"text": "recorded"}}}',
    '```',
    '',
    '## Reward Signal',
    '',
    'Done.'
  ].join('\n');
}
