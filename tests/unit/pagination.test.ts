import { describe, test, expect } from '@jest/globals';
import {
  encodeCursor,
  decodeCursor,
  paginateItems,
  buildEmbeddedDocsCacheMetadata,
  buildAdapterContentCacheMetadata,
  EMBEDDED_DOCS_TTL_MS,
  ADAPTER_CONTENT_TTL_MS,
  EMBEDDED_DOCS_CACHE_SCOPE,
  ADAPTER_CONTENT_CACHE_SCOPE,
  DEFAULT_PAGE_SIZE
} from '../../src/utils/pagination.js';

describe('Pagination Utilities', () => {
  describe('encodeCursor / decodeCursor', () => {
    test('encodes and decodes cursor round-trip', () => {
      const offset = 42;
      const cursor = encodeCursor(offset);
      expect(typeof cursor).toBe('string');
      expect(cursor.length).toBeGreaterThan(0);
      
      const decoded = decodeCursor(cursor);
      expect(decoded).toBe(offset);
    });

    test('decodes undefined cursor as 0', () => {
      expect(decodeCursor(undefined)).toBe(0);
    });

    test('decodes invalid cursor as 0', () => {
      expect(decodeCursor('not-valid-base64-json')).toBe(0);
      expect(decodeCursor('')).toBe(0);
    });

    test('decodes cursor with negative offset as 0', () => {
      const payload = { offset: -5 };
      const cursor = Buffer.from(JSON.stringify(payload)).toString('base64');
      expect(decodeCursor(cursor)).toBe(0);
    });
  });

  describe('paginateItems', () => {
    const items = Array.from({ length: 125 }, (_, i) => ({ id: i, name: `item-${i}` }));

    test('returns first page with no cursor', () => {
      const result = paginateItems(items, undefined, 50);
      expect(result.page).toHaveLength(50);
      expect(result.page[0].id).toBe(0);
      expect(result.page[49].id).toBe(49);
      expect(result.nextCursor).toBeDefined();
    });

    test('returns middle page with cursor', () => {
      const cursor = encodeCursor(50);
      const result = paginateItems(items, cursor, 50);
      expect(result.page).toHaveLength(50);
      expect(result.page[0].id).toBe(50);
      expect(result.page[49].id).toBe(99);
      expect(result.nextCursor).toBeDefined();
    });

    test('returns last partial page', () => {
      const cursor = encodeCursor(100);
      const result = paginateItems(items, cursor, 50);
      expect(result.page).toHaveLength(25);
      expect(result.page[0].id).toBe(100);
      expect(result.page[24].id).toBe(124);
      expect(result.nextCursor).toBeUndefined();
    });

    test('returns empty page when offset beyond length', () => {
      const cursor = encodeCursor(200);
      const result = paginateItems(items, cursor, 50);
      expect(result.page).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });

    test('uses default page size when not specified', () => {
      const result = paginateItems(items, undefined);
      expect(result.page).toHaveLength(DEFAULT_PAGE_SIZE);
    });

    test('handles empty array', () => {
      const result = paginateItems([], undefined, 50);
      expect(result.page).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe('cursor round-trip returns full set', () => {
    test('paginating through all items returns complete set with no duplicates', () => {
      const items = Array.from({ length: 125 }, (_, i) => ({ id: i, name: `item-${i}` }));
      const pageSize = 30;
      
      const allRetrieved: typeof items = [];
      let cursor: string | undefined;
      let pageCount = 0;
      
      do {
        const result = paginateItems(items, cursor, pageSize);
        allRetrieved.push(...result.page);
        cursor = result.nextCursor;
        pageCount++;
        
        // Safety check to prevent infinite loop
        if (pageCount > 10) {
          throw new Error('Pagination did not terminate');
        }
      } while (cursor !== undefined);
      
      // Verify all items retrieved
      expect(allRetrieved).toHaveLength(items.length);
      
      // Verify no duplicates
      const ids = allRetrieved.map(item => item.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
      
      // Verify deterministic order
      for (let i = 0; i < allRetrieved.length; i++) {
        expect(allRetrieved[i].id).toBe(i);
      }
    });
  });

  describe('cache metadata', () => {
    test('embedded docs cache metadata has correct values', () => {
      const metadata = buildEmbeddedDocsCacheMetadata();
      expect(metadata.ttlMs).toBe(EMBEDDED_DOCS_TTL_MS);
      expect(metadata.cacheScope).toBe(EMBEDDED_DOCS_CACHE_SCOPE);
      expect(metadata.cacheScope).toBe('public');
      expect(metadata.ttlMs).toBe(300_000); // 5 minutes
    });

    test('adapter content cache metadata has correct values', () => {
      const metadata = buildAdapterContentCacheMetadata();
      expect(metadata.ttlMs).toBe(ADAPTER_CONTENT_TTL_MS);
      expect(metadata.cacheScope).toBe(ADAPTER_CONTENT_CACHE_SCOPE);
      expect(metadata.cacheScope).toBe('private');
      expect(metadata.ttlMs).toBe(30_000); // 30 seconds
    });

    test('embedded docs TTL is longer than adapter content TTL', () => {
      const embedded = buildEmbeddedDocsCacheMetadata();
      const adapter = buildAdapterContentCacheMetadata();
      expect(embedded.ttlMs).toBeGreaterThan(adapter.ttlMs);
    });
  });
});
