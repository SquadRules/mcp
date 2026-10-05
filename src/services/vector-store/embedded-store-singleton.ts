/**
 * Shared embedded record store.
 *
 * The embedded path injects ONE `LanceVectorRecordStore` into both the
 * `memoryStore` (DI) and `qdrantService` (module singleton) slots, so they share
 * a single Lance connection/engine and stay internally consistent (a write via
 * one facade is visible through the other). Memoized here so both selectors
 * resolve the same instance regardless of import order.
 */
import { LanceVectorRecordStore } from './lancedb/LanceVectorRecordStore.js';

let instance: LanceVectorRecordStore | null = null;

export function getEmbeddedRecordStore(): LanceVectorRecordStore {
  if (!instance) instance = new LanceVectorRecordStore();
  return instance;
}
