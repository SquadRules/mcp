/**
 * List unique adapter URIs in a space for bulk export.
 */

import type { MemoryQdrantStore } from '../../services/memory/store.js';

/**
 * Return `squadrules://adapter/{uuid}` for each distinct adapter in the space.
 *
 * Adapter layer payloads do not carry a `content_type` field (only artifact memories do),
 * so we cannot filter on `content_type === 'text/markdown'` at the store level — that
 * would exclude every adapter and yield an empty bundle. Instead we scroll the whole
 * space and dedupe by `adapter.id`, the same shape `tools/spaces.ts` uses to count
 * adapters per space. Artifact memories share the same `adapter.id` as their parent
 * adapter, so they collapse under the existing entry rather than introducing a new one.
 */
export async function listAdapterUrisInSpace(memoryStore: MemoryQdrantStore, spaceId: string): Promise<string[]> {
  const records = await memoryStore.scrollSpace(spaceId, { paginate: true });
  const seen = new Set<string>();
  const uris: string[] = [];
  for (const { payload } of records) {
    const id = typeof payload.adapter?.id === 'string' && payload.adapter.id.trim().length > 0
      ? payload.adapter.id.trim()
      : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uris.push(`squadrules://adapter/${id}`);
  }
  return uris;
}
