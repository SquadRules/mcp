import { describe, expect, it } from '@jest/globals';
import { getAdapterLayers } from '../../src/services/qdrant/memory-retrieval.js';

describe('getAdapterLayers artifact exclusion filter', () => {
  it('adds must_not content_type allowlist to exclude artifact points', async () => {
    let capturedFilter: unknown;
    const conn = {
      collectionName: 'squadrules',
      executeWithReconnect: async (fn: () => Promise<unknown>) => fn(),
      client: {
        scroll: async (_collection: string, req: { filter?: unknown }) => {
          capturedFilter = req.filter;
          return { points: [], next_page_offset: null };
        }
      }
    } as any;

    await getAdapterLayers(conn, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ['personal']);

    const filter = capturedFilter as { must_not?: Array<{ key?: string; match?: { any?: string[] } }> };
    expect(Array.isArray(filter.must_not)).toBe(true);
    const contentTypeEntry = filter.must_not?.find((entry) => entry.key === 'content_type');
    expect(contentTypeEntry).toBeDefined();
    expect(contentTypeEntry?.match?.any).toEqual(
      expect.arrayContaining(['text/x-python', 'text/x-shellscript', 'text/javascript', 'text/yaml'])
    );
  });
});
