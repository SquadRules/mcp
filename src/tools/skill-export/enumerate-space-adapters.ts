// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
/**
 * List unique adapter URIs in a space for bulk export.
 */

import type { MemoryQdrantStore } from '../../services/memory/store.js';
import { buildSpaceFilter } from '../../utils/space-filter.js';

const SCROLL_LIMIT = 512;

/**
 * Return `kairos://adapter/{uuid}` for each distinct adapter in the space.
 *
 * Adapter layer payloads do not carry a `content_type` field (only artifact memories do),
 * so we cannot filter on `content_type === 'text/markdown'` at the Qdrant level — that
 * would exclude every adapter and yield an empty bundle. Instead we scroll the whole
 * space and dedupe by `adapter.id`, the same shape `tools/spaces.ts` uses to count
 * adapters per space. Artifact memories share the same `adapter.id` as their parent
 * adapter, so they collapse under the existing entry rather than introducing a new one.
 */
export async function listAdapterUrisInSpace(memoryStore: MemoryQdrantStore, spaceId: string): Promise<string[]> {
  const { client, collection } = memoryStore.getQdrantAccess();
  const filter = buildSpaceFilter([spaceId]);
  const seen = new Set<string>();
  const uris: string[] = [];
  let offset: string | number | undefined;
  do {
    const page = await client.scroll(collection, {
      filter,
      limit: SCROLL_LIMIT,
      ...(offset !== undefined ? { offset } : {}),
      with_payload: true,
      with_vector: false
    });
    const points = Array.isArray(page?.points) ? page.points : [];
    for (const point of points) {
      const payload = (point?.payload ?? {}) as Record<string, unknown>;
      const adapter = payload['adapter'] as { id?: string } | undefined;
      const id = typeof adapter?.id === 'string' && adapter.id.trim().length > 0 ? adapter.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      uris.push(`kairos://adapter/${id}`);
    }
    const nextOffset = page?.next_page_offset;
    offset = typeof nextOffset === 'string' || typeof nextOffset === 'number' ? nextOffset : undefined;
  } while (offset !== null && offset !== undefined);

  return uris;
}
