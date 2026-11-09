/**
 * Shared local runtime boot.
 *
 * Factors the store / embedding / seed boot out of `runSquadrulesServer()` so the
 * HTTP+stdio server and the CLI local backend run the exact same startup sequence
 * and cannot drift. `opts` gates the expensive stages: the Qdrant health probe,
 * the eager embedding-model load, and app-space adapter seeding. The CLI local
 * path turns these down (fastboot); the server turns them all on.
 */
import { structuredLogger } from '../utils/structured-logger.js';
import { MemoryQdrantStore } from '../services/memory/store.js';
import { qdrantService } from '../services/qdrant/index.js';
import type { QdrantService } from '../services/qdrant/service.js';
import {
  createEmbeddedRecordStore,
  getEmbeddedRecordStore
} from '../services/vector-store/embedded-store-singleton.js';
import { createEmbeddedRuntime } from '../services/vector-store/embedded-runtime.js';
import type { LanceVectorRecordStore } from '../services/vector-store/lancedb/LanceVectorRecordStore.js';
import { initGraphDb } from '../services/graph-db/graph-db-singleton.js';
import { attachGraphDb } from '../services/graph-db/graph-owner.js';
import {
  defaultReconcileSpaceIds,
  reconcileAdapterGraphFromStore
} from '../services/graph-db/adapter-graph-sync.js';
import { snapshotsFromRecords, type AdapterRecordSource } from '../services/graph-db/adapter-graph-records.js';
import type { GraphRepository } from '../services/graph-db/graph-repository.js';
import { migrateOldSquadrulesConfigDir } from '../utils/squadrules-user-dirs.js';
import { ensureEmbeddingDimension } from '../services/embedding/lazy-probe.js';
import { getSuccessfulProvider } from '../services/embedding/provider-resolver.js';
import { injectMemResourcesAtBoot } from '../resources/mem-resources-boot.js';
import { triggerQdrantSnapshot } from '../services/qdrant/snapshots.js';
import { MEM_BOOT_FORCE_INJECT } from '../config/mem-boot.js';
import { checkWidthConsistency } from '../services/vector-store/lancedb/lance-store-metadata.js';
import {
  isQdrantConfigured,
  EMBEDDING_PROVIDER,
  QDRANT_SNAPSHOT_ON_START,
  QDRANT_SNAPSHOT_DIR,
  SQUADRULES_APP_SPACE_ID
} from '../config.js';

/**
 * App-space adapter seeding policy:
 * - `always`: run boot injection (server default; injection version-skips in-sync adapters).
 * - `auto`: seed only when this runtime's store holds no app-space adapter records
 *   (CLI fastboot).
 * - `never`: skip injection entirely.
 */
export type SeedMode = 'always' | 'auto' | 'never';

export interface BootLocalRuntimeOptions {
  /** App-space adapter seeding policy. Default `always`. */
  seedAdapters?: SeedMode;
  /** Probe the embedding dimension and load the model eagerly. Default true. When false the model loads lazily on first embedding need. */
  loadEmbeddings?: boolean;
  /** Wait for Qdrant health before init (Qdrant backend only; the embedded store has no server to wait for). Default true. */
  healthProbe?: boolean;
  /** Force delete-then-retrain seeding (structural repair hatch). Default `MEM_BOOT_FORCE_INJECT`. */
  forceSeed?: boolean;
  /**
   * Embedded record store this runtime owns (LanceDB path only).
   *
   * Omit it for the process default runtime; pass a store to boot an independent
   * runtime in the same process (its own Lance connection, its own graph). Ignored on
   * the Qdrant backend, where the connection is the server's, not a local store's.
   */
  records?: LanceVectorRecordStore;
  /**
   * LanceDB directory for a store this runtime creates for itself (LanceDB path only).
   * Used only when `records` is omitted; `records` wins because an opened store is a
   * caller-owned resource.
   */
  databaseDir?: string;
}

export interface BootedLocalRuntime {
  /** Store facade this runtime owns — not a process singleton on the embedded path. */
  memoryStore: MemoryQdrantStore;
  /** Retrieval facade this runtime owns — same record store as `memoryStore`. */
  qdrantService: QdrantService;
  /**
   * Embedded graph database (LadybugDB) used for framework-internal bookkeeping.
   * `null` when disabled via `SQUADRULES_GRAPH_DB_ENABLED` or when opening it failed —
   * callers must degrade to "no graph" rather than treat it as a fatal condition.
   */
  graphDb: GraphRepository | null;
}

/**
 * Warm-store check: does THIS embedded store already hold app-space adapter records?
 *
 * The question is about one store, so it is asked of that store's own records rather
 * than of the process-default directory. A second runtime in the same process can
 * boot a store somewhere else, and the default store's contents say nothing about it:
 * its absence used to make a warm store look cold, which re-ran boot injection and
 * loaded an embedding model on a start that needed none.
 *
 * A records table existing is not the evidence either — the first write creates it, and
 * an empty table still exists. `snapshotsFromRecords` is the projection's own notion of
 * an adapter record, so "seeded" means exactly "boot reconciliation has an adapter to
 * project from this store".
 */
export async function isEmbeddedStoreSeeded(source: AdapterRecordSource): Promise<boolean> {
  try {
    const stored = await source.scrollSpace(SQUADRULES_APP_SPACE_ID, { paginate: true });
    return snapshotsFromRecords(stored, 'boot:seed-check').length > 0;
  } catch (err) {
    // An unreadable store is not evidence of a seeded one: fall back to injection (which
    // version-skips in-sync adapters) rather than skipping a store that may be empty.
    structuredLogger.warn(
      `boot injection: could not read app-space records (${err instanceof Error ? err.message : String(err)}) — treating the store as unseeded`
    );
    return false;
  }
}

/**
 * Wait for Qdrant to be available with retries. Uses shorter intervals for faster
 * detection when Qdrant becomes available quickly. Embedded store never calls this.
 */
async function waitForQdrant(memoryStore: MemoryQdrantStore, maxRetries = 30, intervalMs = 1000): Promise<void> {
  structuredLogger.info('Waiting for Qdrant to be available...');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const isHealthy = await memoryStore.checkHealth(5000); // 5 second timeout per check
      if (isHealthy) {
        structuredLogger.info(`Qdrant is available after ${attempt} attempt(s)`);
        return;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      structuredLogger.debug(`Qdrant health check error on attempt ${attempt}: ${errorMessage}`);
      // Health check failed, will retry
    }

    if (attempt < maxRetries) {
      structuredLogger.info(`Qdrant not ready yet (attempt ${attempt}/${maxRetries}), retrying in ${intervalMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`Qdrant did not become available after ${maxRetries} attempts (${(maxRetries * intervalMs) / 1000}s)`);
}

/**
 * Boot the local runtime: select the vector store, optionally probe embeddings and
 * wait for Qdrant, initialize the store, optionally snapshot, and optionally seed
 * app-space adapters. Returns the store double plus the `qdrantService` singleton
 * (the same embedded instance on the LanceDB path) for callers to execute tools against,
 * plus the optional embedded graph database (`null` when unavailable — see `graphDb`).
 */
export async function bootLocalRuntime(opts: BootLocalRuntimeOptions = {}): Promise<BootedLocalRuntime> {
  migrateOldSquadrulesConfigDir();
  const seedAdapters = opts.seedAdapters ?? 'always';
  const loadEmbeddings = opts.loadEmbeddings ?? true;
  const healthProbe = opts.healthProbe ?? true;
  const forceSeed = opts.forceSeed ?? MEM_BOOT_FORCE_INJECT;

  // Backend-selected store. On the embedded path ONE record store is bound to both
  // facades by `createEmbeddedRuntime`, so a write through `memoryStore` is visible
  // through `qdrantService` and the graph attachment keys off this runtime's objects.
  // The store is chosen here, explicitly: a caller-supplied store wins, then a
  // caller-supplied directory, and only then the process default runtime.
  let memoryStore: MemoryQdrantStore;
  let service: QdrantService;
  // Embedded store this runtime owns; `null` on the Qdrant backend, where the connection
  // belongs to the server. Held so the warm-seed decision below asks THIS store instead
  // of whatever the process default happens to hold.
  let records: LanceVectorRecordStore | null = null;
  if (isQdrantConfigured) {
    memoryStore = new MemoryQdrantStore();
    service = qdrantService;
  } else {
    records =
      opts.records ??
      (opts.databaseDir ? createEmbeddedRecordStore({ databaseDir: opts.databaseDir }) : getEmbeddedRecordStore());
    const runtime = createEmbeddedRuntime(records);
    memoryStore = runtime.memoryStore;
    service = runtime.qdrantService;
  }

  // Wait for Qdrant before initializing (the embedded store is local — no server to wait for).
  if (isQdrantConfigured && healthProbe) {
    await waitForQdrant(memoryStore);
  }

  if (loadEmbeddings) {
    const embeddingDim = await ensureEmbeddingDimension();
    structuredLogger.debug(`embedding dimension: ${embeddingDim}`);
  }

  structuredLogger.debug(`vector store: ${isQdrantConfigured ? 'Qdrant' : 'LanceDB (embedded)'}`);
  
  // Log the successful provider if initialized, otherwise the preference
  const successfulProvider = getSuccessfulProvider();
  if (successfulProvider) {
    structuredLogger.debug(`embedding: ${successfulProvider.provider} (${successfulProvider.model}, ${successfulProvider.dimension}d)`);
  } else {
    structuredLogger.debug(`embedding: ${EMBEDDING_PROVIDER} (initialization deferred)`);
  }

  // Dimension-metadata diagnostic only (#94): no native/model initialization or enforcement.
  // Ask the selected store, including caller-owned records; boot options and process
  // defaults must not redirect this check to a different store's metadata.
  if (records && successfulProvider) {
    const check = checkWidthConsistency(records.getDirectory(), successfulProvider.provider, successfulProvider.model, successfulProvider.dimension);
    if (!check.consistent) {
      structuredLogger.warn(`vector width mismatch: ${check.reason}`);
    }
  }
  
  await memoryStore.init();
  structuredLogger.debug('vector store: ready');

  // Embedded graph database: framework-internal bookkeeping only (no MCP tool, no HTTP
  // route, no health surface). `initGraphDb()` never throws — a failed open is logged by
  // the singleton and reported as null, so the app still boots without the graph. This
  // debug line plus tests/unit/graph-db-singleton.test.ts is the verification contract.
  const graphDb = await initGraphDb();
  structuredLogger.debug(`graph db: ${graphDb ? 'ready (embedded)' : 'disabled (init failed)'}`);

  // The graph belongs to THIS runtime: attach it to the objects tools are handed, and
  // to nothing else. A second boot in the same process opens its own graph and attaches
  // that one to its own store, so the two cannot read each other's topology.
  attachGraphDb(graphDb, memoryStore, service);

  if (isQdrantConfigured && QDRANT_SNAPSHOT_ON_START) {
    const snapshotResult = await triggerQdrantSnapshot(service, {
      enabled: true,
      directory: QDRANT_SNAPSHOT_DIR,
      reason: 'startup'
    });

    if (!snapshotResult.success) {
      structuredLogger.warn(`Startup snapshot failed: ${snapshotResult.message || 'unknown error'}`);
    }
  } else {
    structuredLogger.debug('startup snapshot: skipped (embedded store)');
  }

  // Inject mem resources from embedded-mcp-resources into the vector store at boot.
  // Adapters already stored at (or newer than) their shipped version are reused, so a
  // normal restart does no re-embedding; forceSeed is the structural-repair path
  // (delete-then-retrain) for a corrupted/duplicated store.
  // `auto` asks THIS runtime's store whether it already holds app-space adapters. The
  // Qdrant backend has no embedded store to ask (`records` is null) and relies on
  // injection's version skip instead, exactly as before.
  const alreadySeeded =
    seedAdapters === 'auto' && !forceSeed && records !== null
      ? await isEmbeddedStoreSeeded(records)
      : false;

  const shouldSeed =
    seedAdapters === 'always' || (seedAdapters === 'auto' && (forceSeed || !alreadySeeded));

  if (shouldSeed) {
    // Seeding embeds adapters on a fresh store; load the model even when the caller
    // deferred the eager probe (fastboot). A store that answered "already seeded"
    // never reaches here.
    if (!loadEmbeddings) {
      const embeddingDim = await ensureEmbeddingDimension();
      structuredLogger.debug(`embedding dimension: ${embeddingDim}`);
    }
    await injectMemResourcesAtBoot(memoryStore, { force: forceSeed });
  } else if (seedAdapters === 'never') {
    structuredLogger.debug('boot injection: skipped (seedAdapters=never)');
  } else {
    structuredLogger.debug('boot injection: skipped (embedded store already seeded)');
  }

  // Reconcile the graph from what the store actually holds, in the one space this boot
  // injected into. Runs on the warm path too (a version-skipped adapter still gets its
  // node back after a graph loss) and never writes memory content, so it cannot repair
  // a graph by rewriting adapters.
  const reconcileReport = await reconcileAdapterGraphFromStore(
    graphDb,
    memoryStore,
    defaultReconcileSpaceIds()
  );
  if (!reconcileReport.skipped) {
    structuredLogger.debug(
      `graph reconcile: ${reconcileReport.nodes} adapter node(s), ${reconcileReport.edges} edge(s) from stored records`
    );
  }

  return { memoryStore, qdrantService: service, graphDb };
}
