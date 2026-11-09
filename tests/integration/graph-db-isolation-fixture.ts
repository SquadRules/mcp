/**
 * Shared harness for the graph identity / topology integration suites (no mocks).
 *
 * Every fixture here is a production object or a production call:
 *
 *   - `openGraphDb({ databaseDir })` opens a real backend (embedded LadybugDB, or the
 *     configured shared backend) at an explicit directory and hands ownership to the caller.
 *   - `new LanceVectorRecordStore({ databaseDir })` opens a real embedded LanceDB.
 *   - `syncAdapterGraph()` / `reconcileAdapterGraphFromStore()` / `resolveParentScope()`
 *     are the production projection functions.
 *   - `runWithSpaceContextAsync()` is the real tenant context, so the space ids under test
 *     come from the same place a request does.
 *
 * Embeddings: the write path embeds activation text. The suite forces the `tei` provider
 * with no endpoint, which fails immediately and makes the writer fall back to zero
 * vectors. Nothing here reaches the network, and no embedding call is stubbed — the real
 * provider call runs and really fails over.
 *
 * Used by `graph-db-instance-isolation.test.ts` (ownership + scoped identity) and
 * `graph-db-topology-projection.test.ts` (projection order + reconciliation).
 */
import { jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SpaceContext } from '../../src/utils/tenant-context.js';
import type { GraphRepository } from '../../src/services/graph-db/graph-repository.js';
import type { LanceVectorRecordStore } from '../../src/services/vector-store/lancedb/LanceVectorRecordStore.js';

type GraphSingletonModule = typeof import('../../src/services/graph-db/graph-db-singleton.js');
type ScopeModule = typeof import('../../src/services/graph-db/adapter-scope.js');
type SyncModule = typeof import('../../src/services/graph-db/adapter-graph-sync.js');
type RecordsModule = typeof import('../../src/services/graph-db/adapter-graph-records.js');
type OwnerModule = typeof import('../../src/services/graph-db/graph-owner.js');
type LanceStoreModule = typeof import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
type TenantModule = typeof import('../../src/utils/tenant-context.js');

export interface IsolationModules {
  graphSingleton: GraphSingletonModule;
  scope: ScopeModule;
  sync: SyncModule;
  records: RecordsModule;
  owner: OwnerModule;
  lanceStore: LanceStoreModule;
  tenant: TenantModule;
  /** App space id as the production config resolves it (never re-typed here). */
  appSpaceId: string;
}

export const SPACE_A = 'space:it-personal-a';
export const SPACE_B = 'group:it-team-b';

/**
 * Load the production modules after the env is set.
 *
 * `jest.resetModules()` drops any `src/config` instance the global setup may have loaded,
 * so the env below is what the freshly imported modules see.
 */
export async function loadIsolationModules(): Promise<IsolationModules> {
  jest.resetModules();
  process.env['SQUADRULES_GRAPH_DB_ENABLED'] = 'true';
  process.env['EMBEDDING_PROVIDER'] = 'tei';
  delete process.env['TEI_BASE_URL'];
  delete process.env['TEI_MODEL'];

  const graphSingleton = await import('../../src/services/graph-db/graph-db-singleton.js');
  const scope = await import('../../src/services/graph-db/adapter-scope.js');
  const sync = await import('../../src/services/graph-db/adapter-graph-sync.js');
  const records = await import('../../src/services/graph-db/adapter-graph-records.js');
  const owner = await import('../../src/services/graph-db/graph-owner.js');
  const lanceStore = await import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
  const tenant = await import('../../src/utils/tenant-context.js');
  const embeddingConfig = await import('../../src/services/embedding/config.js');
  const config = await import('../../src/config.js');

  embeddingConfig.setResolvedEmbeddingDimension(384);
  return {
    graphSingleton,
    scope,
    sync,
    records,
    owner,
    lanceStore,
    tenant,
    appSpaceId: config.SQUADRULES_APP_SPACE_ID
  };
}

/** Owns the temporary directories, graphs and stores one suite creates. */
export class IsolationFixture {
  private readonly tempDirs: string[] = [];
  private readonly graphs: GraphRepository[] = [];
  private readonly stores: LanceVectorRecordStore[] = [];

  constructor(readonly modules: IsolationModules) {}

  tempDir(label: string): string {
    const dir = mkdtempSync(join(tmpdir(), `squadrules-${label}-`));
    this.tempDirs.push(dir);
    return dir;
  }

  spaceContext(spaceId: string): SpaceContext {
    return {
      userId: 'user-it',
      groupIds: [],
      allowedSpaceIds: [spaceId, this.modules.appSpaceId],
      defaultWriteSpaceId: spaceId,
      personalSpaceId: spaceId,
      spaceNamesById: {},
      requestId: 'graph-db-it'
    };
  }

  /** Real graph at an explicit directory; registered for cleanup. */
  async openGraph(label: string): Promise<GraphRepository> {
    const dir = this.tempDir(`graph-${label}`);
    const graph = await this.modules.graphSingleton.openGraphDb({ databaseDir: join(dir, 'db') });
    if (!graph) throw new Error(`graph backend did not open for ${label}`);
    this.graphs.push(graph);
    return graph;
  }

  /** Real embedded record store at an explicit directory; registered for cleanup. */
  async openStore(label: string): Promise<LanceVectorRecordStore> {
    const dir = this.tempDir(`lance-${label}`);
    const store = new this.modules.lanceStore.LanceVectorRecordStore({ databaseDir: join(dir, 'db') });
    await store.init();
    this.stores.push(store);
    return store;
  }

  /** Close every graph this fixture opened and delete every temp directory. */
  dispose(): void {
    for (const graph of this.graphs) {
      try {
        void graph.close();
      } catch {
        // Already closed by the test that exercised close(); nothing to release.
      }
    }
    this.graphs.length = 0;
    this.stores.length = 0;
    for (const dir of this.tempDirs) rmSync(dir, { recursive: true, force: true });
    this.tempDirs.length = 0;
    delete process.env['EMBEDDING_PROVIDER'];
  }
}

/** A well-formed adapter document; optional `inherits:` drives the topology. */
export function adapterMarkdown(input: {
  slug: string;
  version: string;
  title: string;
  inherits?: string;
  contractText: string;
}): string {
  return [
    '---',
    `slug: ${input.slug}`,
    `version: ${input.version}`,
    ...(input.inherits ? [`inherits: ${input.inherits}`] : []),
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
