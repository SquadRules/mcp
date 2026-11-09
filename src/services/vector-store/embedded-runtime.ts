/**
 * Runtime-scoped embedded backend (ADR 0042, ADR 0043).
 *
 * The embedded LanceDB path exposes ONE record store through two facades:
 *
 *   `memoryStore`    the DI surface `train` / `tune` / `activate` / `forward` call.
 *   `qdrantService`  the retrieval surface the same tools call for adapter layers.
 *
 * Both must resolve to the same records database: a layer written through
 * `memoryStore` is read back through `qdrantService`, and the graph attachment keys
 * off those object identities. Three backends therefore exist per runtime, not per
 * process.
 *
 * The binding is explicit — the caller supplies the store:
 *
 *     const records = createEmbeddedRecordStore({ databaseDir });
 *     const runtime = createEmbeddedRuntime(records);
 *
 * This factory never reaches for the process singleton. A second runtime in one
 * process (a personal embedded runtime plus an isolated one, or a second boot in a
 * test) passes its own store and gets its own Lance connection, its own records, and
 * its own graph. The single-runtime default is the *caller's* choice (see
 * `bootLocalRuntime`), never a hidden fallback inside this function.
 *
 * Why a cast: `LanceVectorRecordStore` implements the method subset both facades are
 * used for (`getMemory`, `getAdapterLayers`, `scrollSpace`, `updateMemory`,
 * `storeAdapter`, `searchMemories`, …). The facades are declared as the wider
 * `MemoryQdrantStore` / `QdrantService` classes because that is the type every tool
 * parameter is declared with. The cast is contained here so no call site repeats
 * `as unknown as`, and the integration suite — not this comment — is the gate that
 * the used surface is covered.
 */
import type { MemoryQdrantStore } from '../memory/store.js';
import type { QdrantService } from '../qdrant/service.js';
import type { LanceVectorRecordStore } from './lancedb/LanceVectorRecordStore.js';

export interface EmbeddedRuntime {
  /** The one record store this runtime owns. */
  records: LanceVectorRecordStore;
  /** Store-shaped facade the tool layer is handed. Same object as `records`. */
  memoryStore: MemoryQdrantStore;
  /** Retrieval-shaped facade the tool layer is handed. Same object as `records`. */
  qdrantService: QdrantService;
}

/**
 * Bind one explicitly supplied embedded record store to both runtime facades.
 *
 * Passing the same store to two runtimes is a caller bug the graph layer cannot
 * detect (identities collapse), so the store is required and never defaulted.
 */
export function createEmbeddedRuntime(records: LanceVectorRecordStore): EmbeddedRuntime {
  const facade = records as unknown as MemoryQdrantStore & QdrantService;
  return {
    records,
    memoryStore: facade,
    qdrantService: facade
  };
}
