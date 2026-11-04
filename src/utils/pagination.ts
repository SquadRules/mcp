/**
 * Cursor-based pagination utilities for MCP list operations.
 * 
 * Implements the 2026-07-28 spec pagination model:
 * - Opaque cursor tokens (base64-encoded JSON)
 * - Server-determined page sizes
 * - nextCursor field in responses when more results exist
 * - Cache metadata (ttlMs, cacheScope) on all list/read responses
 */

import { getBuildVersion } from '../utils/build-version.js';

/** Default page size for list operations */
export const DEFAULT_PAGE_SIZE = 50;

/** Cache TTL for embedded docs (5 minutes) */
export const EMBEDDED_DOCS_TTL_MS = 300_000;

/** Cache TTL for adapter content (30 seconds - bounded for store mutations) */
export const ADAPTER_CONTENT_TTL_MS = 30_000;

/** Cache scope for embedded docs (public - build-fresh) */
export const EMBEDDED_DOCS_CACHE_SCOPE = 'public' as const;

/** Cache scope for adapter content (private - user-specific) */
export const ADAPTER_CONTENT_CACHE_SCOPE = 'private' as const;

/**
 * Cursor payload structure (opaque to clients)
 */
interface CursorPayload {
  offset: number;
}

/**
 * Encode a cursor from an offset position
 */
export function encodeCursor(offset: number): string {
  const payload: CursorPayload = { offset };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Decode a cursor to get the offset position
 * Returns 0 if cursor is invalid or missing
 */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded) as CursorPayload;
    return typeof payload.offset === 'number' && payload.offset >= 0 ? payload.offset : 0;
  } catch {
    return 0;
  }
}

/**
 * Paginate an array of items based on cursor
 * @returns The page of items and the next cursor (if more items exist)
 */
export function paginateItems<T>(
  items: T[],
  cursor: string | undefined,
  pageSize: number = DEFAULT_PAGE_SIZE
): { page: T[]; nextCursor?: string } {
  const offset = decodeCursor(cursor);
  const page = items.slice(offset, offset + pageSize);
  const hasMore = offset + pageSize < items.length;
  
  return {
    page,
    ...(hasMore && { nextCursor: encodeCursor(offset + pageSize) })
  };
}

/**
 * Build cache metadata for embedded docs (resources, prompts from codebase)
 * These are build-fresh and can be cached publicly
 */
export function buildEmbeddedDocsCacheMetadata(): {
  ttlMs: number;
  cacheScope: 'public';
} {
  return {
    ttlMs: EMBEDDED_DOCS_TTL_MS,
    cacheScope: EMBEDDED_DOCS_CACHE_SCOPE
  };
}

/**
 * Build cache metadata for adapter content (reached through activate/forward)
 * These are user-specific and have bounded TTL for store mutations
 */
export function buildAdapterContentCacheMetadata(): {
  ttlMs: number;
  cacheScope: 'private';
} {
  return {
    ttlMs: ADAPTER_CONTENT_TTL_MS,
    cacheScope: ADAPTER_CONTENT_CACHE_SCOPE
  };
}

/**
 * Build a paginated list response with cache metadata
 * Conforms to 2026-07-28 spec response format
 */
export function buildPaginatedListResponse<T>(
  items: T[],
  cursor: string | undefined,
  cacheMetadata: { ttlMs: number; cacheScope: 'public' | 'private' },
  pageSize: number = DEFAULT_PAGE_SIZE
): {
  resultType: 'complete';
  [key: string]: unknown;
  nextCursor?: string;
  ttlMs: number;
  cacheScope: 'public' | 'private';
} & Record<string, unknown> {
  const { page, nextCursor } = paginateItems(items, cursor, pageSize);
  
  return {
    resultType: 'complete',
    ...(nextCursor !== undefined && { nextCursor }),
    ttlMs: cacheMetadata.ttlMs,
    cacheScope: cacheMetadata.cacheScope,
    // The actual data field will be added by the caller
    ...{ items: page }
  };
}

/**
 * Build cache metadata for server info (included in _meta)
 */
export function buildServerInfoMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/serverInfo': {
      name: 'SquadRules',
      version: getBuildVersion()
    }
  };
}
