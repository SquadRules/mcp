/**
 * Shared local runtime boot.
 *
 * Factors the store / embedding / seed boot out of `runSquadrulesServer()` so the
 * HTTP+stdio server and the CLI local backend run the exact same startup sequence
 * and cannot drift. `opts` gates the expensive stages: the Qdrant health probe,
 * the eager embedding-model load, and app-space adapter seeding. The CLI local
 * path turns these down (fastboot); the server turns them all on.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { structuredLogger } from '../utils/structured-logger.js';
import { MemoryQdrantStore } from '../services/memory/store.js';
import { qdrantService } from '../services/qdrant/index.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { getEmbeddedRecordStore } from '../services/vector-store/embedded-store-singleton.js';
import { resolveLanceDbDir } from '../services/vector-store/lancedb-connection.js';
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
  QDRANT_SNAPSHOT_DIR
} from '../config.js';

/** LanceDB table name holding adapter/layer/artifact records (see lance-records-engine.ts). */
const RECORDS_TABLE = 'memory_records';

/**
 * App-space adapter seeding policy:
 * - `always`: run boot injection (server default; injection version-skips in-sync adapters).
 * - `auto`: seed only when the embedded store looks empty (CLI fastboot).
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
}

export interface BootedLocalRuntime {
  memoryStore: MemoryQdrantStore;
  qdrantService: QdrantService;
}

/**
 * Cheap file-existence check: has the embedded LanceDB records table been created?
 * True once any host / `serve` run has seeded the store, so a warm CLI run can skip
 * boot injection. Always false on the Qdrant backend (injection version-skips instead).
 */
export function isEmbeddedStoreSeeded(): boolean {
  if (isQdrantConfigured) return false;
  return existsSync(join(resolveLanceDbDir(), `${RECORDS_TABLE}.lance`));
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
 * (the same embedded instance on the LanceDB path) for callers to execute tools against.
 */
export async function bootLocalRuntime(opts: BootLocalRuntimeOptions = {}): Promise<BootedLocalRuntime> {
  const seedAdapters = opts.seedAdapters ?? 'always';
  const loadEmbeddings = opts.loadEmbeddings ?? true;
  const healthProbe = opts.healthProbe ?? true;
  const forceSeed = opts.forceSeed ?? MEM_BOOT_FORCE_INJECT;

  // Backend-selected store. On the embedded path this is the shared LanceDB store
  // double-cast to the `MemoryQdrantStore` shape (the same instance `qdrantService`
  // resolves to), so tools and boot injection keep calling the domain methods they use.
  const memoryStore = isQdrantConfigured
    ? new MemoryQdrantStore()
    : (getEmbeddedRecordStore() as unknown as MemoryQdrantStore);

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

  // Width reconciliation: check stored width vs current provider dimension (#94)
  if (!isQdrantConfigured && successfulProvider) {
    const lancedbDir = resolveLanceDbDir();
    const check = checkWidthConsistency(lancedbDir, successfulProvider.provider, successfulProvider.model, successfulProvider.dimension);
    if (!check.consistent) {
      structuredLogger.warn(`vector width mismatch: ${check.reason}`);
    }
  }
  
  await memoryStore.init();
  structuredLogger.debug('vector store: ready');

  if (isQdrantConfigured && QDRANT_SNAPSHOT_ON_START) {
    const snapshotResult = await triggerQdrantSnapshot(qdrantService, {
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
  const shouldSeed =
    seedAdapters === 'always' ||
    (seedAdapters === 'auto' && (forceSeed || !isEmbeddedStoreSeeded()));

  if (shouldSeed) {
    // Seeding embeds adapters on a fresh store; load the model even when the caller
    // deferred the eager probe (fastboot). A warm store skips injection entirely.
    if (!loadEmbeddings) {
      const embeddingDim = await ensureEmbeddingDimension();
      structuredLogger.debug(`embedding dimension: ${embeddingDim}`);
    }
    await injectMemResourcesAtBoot(memoryStore, { force: forceSeed });
  } else {
    structuredLogger.debug('boot injection: skipped (embedded store already seeded)');
  }

  return { memoryStore, qdrantService };
}
