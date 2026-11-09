/**
 * Shared embedded record store.
 *
 * The embedded path injects ONE `LanceVectorRecordStore` into both the
 * `memoryStore` (DI) and `qdrantService` (module singleton) slots, so they share
 * a single Lance connection/engine and stay internally consistent (a write via
 * one facade is visible through the other). Memoized here so both selectors
 * resolve the same instance regardless of import order.
 */
import {
  LanceVectorRecordStore,
  type LanceVectorRecordStoreOptions
} from './lancedb/LanceVectorRecordStore.js';

let instance: LanceVectorRecordStore | null = null;

/**
 * An embedded store that is NOT the process default, at an explicit directory.
 *
 * Use this when a second runtime (or a test fixture) needs its own records database;
 * `getEmbeddedRecordStore()` stays the one shared instance the boot path injects, so
 * default behaviour is unchanged.
 */
export function createEmbeddedRecordStore(
  options: LanceVectorRecordStoreOptions = {}
): LanceVectorRecordStore {
  return new LanceVectorRecordStore(options);
}

export function getEmbeddedRecordStore(): LanceVectorRecordStore {
  if (!instance) instance = createEmbeddedRecordStore();
  return instance;
}
