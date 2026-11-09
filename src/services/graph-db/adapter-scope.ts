/**
 * Adapter graph scope identity (SquadRules 6, Touchpoint 3 — scope fix).
 *
 * A slug alone does not identify an adapter: the same slug can exist in a personal
 * space, a group space and the app space at the same time. The graph therefore keys
 * every adapter node by its stored space:
 *
 *     adapter:<spaceId>:<slug>
 *
 * Where the scope comes from — and where it must never come from:
 *
 *   - **Writes** use the store's own tenant context (`getSpaceContext().defaultWriteSpaceId`),
 *     i.e. exactly the space id `storeAdapter` stamps on the records it writes.
 *   - **Reads** use the stored record's `space_id` (`Memory.space_id`).
 *   - The only fallback is the documented stored-content policy in
 *     `pointToMemory()`: a record with no `space_id` payload belongs to the app
 *     space, so the app space id is the resolved scope. This is the same policy
 *     that decides where that record is readable from; it is not a guess.
 *   - `"personal"` is never invented. There is no default scope in this module.
 *
 * Every resolution also reports how it was derived (`source`) so callers can
 * record it in the graph node metadata and logs — an auditable scope, not an
 * implicit one.
 */
import { SQUADRULES_APP_SPACE_ID } from '../../config.js';
import { getSpaceContextFromStorage } from '../../utils/tenant-context.js';
import { structuredLogger } from '../../utils/structured-logger.js';

/** Prefix of every adapter graph node key. */
export const ADAPTER_KEY_PREFIX = 'adapter';

/**
 * How a scope was resolved.
 * - `write-context`: the store's tenant context at write time.
 * - `stored-record`: the `space_id` payload of the stored record.
 * - `stored-content-policy`: the documented app-space attribution used by
 *   `pointToMemory()` for records that carry no `space_id`.
 */
export type AdapterScopeSource = 'write-context' | 'stored-record' | 'stored-content-policy';

export interface AdapterGraphScope {
  /** Space id that scopes the adapter node. */
  spaceId: string;
  /** Provenance of `spaceId` — recorded on the node/edge metadata. */
  source: AdapterScopeSource;
}

/** Graph node key for one adapter inside one scope. */
export function adapterGraphKey(spaceId: string, slug: string): string {
  const scope = (spaceId ?? '').trim();
  const normalizedSlug = (slug ?? '').trim();
  if (scope.length === 0) {
    throw new Error('adapterGraphKey: a non-empty space id is required to scope an adapter node');
  }
  if (normalizedSlug.length === 0) {
    throw new Error('adapterGraphKey: a non-empty adapter slug is required');
  }
  return `${ADAPTER_KEY_PREFIX}:${scope}:${normalizedSlug}`;
}

/** Parse a scoped adapter key back into `{ spaceId, slug }`; null when it is not one. */
export function parseAdapterGraphKey(key: string): { spaceId: string; slug: string } | null {
  const parts = (key ?? '').split(':');
  if (parts.length < 4) return null;
  if (parts[0] !== ADAPTER_KEY_PREFIX) return null;
  // Space ids themselves contain ':' (user:realm:uuid, group:realm:uuid, space:…),
  // so the slug is the last segment and the scope is everything between.
  const slug = parts[parts.length - 1]!;
  const spaceId = parts.slice(1, -1).join(':');
  if (!spaceId || !slug) return null;
  return { spaceId, slug };
}

/**
 * Scope of a write: the store's tenant context. Fails closed instead of guessing
 * when the context carries no writable space (AUTH enabled, no auth context).
 */
export function writeAdapterScope(): AdapterGraphScope {
  const context = getSpaceContextFromStorage();
  const spaceId = (context.defaultWriteSpaceId ?? '').trim();
  if (spaceId.length === 0) {
    throw new Error('writeAdapterScope: the store has no writable space in its tenant context');
  }
  return { spaceId, source: 'write-context' };
}

/**
 * Scope of a stored record. Falls back to the app space only under the documented
 * stored-content policy (`pointToMemory` attributes a missing `space_id` to the app
 * space), and reports that provenance.
 */
export function storedAdapterScope(spaceId: string | undefined, context: string): AdapterGraphScope {
  const trimmed = (spaceId ?? '').trim();
  if (trimmed.length > 0) {
    return { spaceId: trimmed, source: 'stored-record' };
  }
  structuredLogger.debug(
    `graph scope: ${context} record carries no space_id — applying the stored-content app-space policy (${SQUADRULES_APP_SPACE_ID})`
  );
  return { spaceId: SQUADRULES_APP_SPACE_ID, source: 'stored-content-policy' };
}

/**
 * Scoped key of a stored adapter record — attribution for reports that name a child.
 *
 * Anomalies and proposal confirmations must attribute the reporting child from the
 * stored record itself (`slug` + `space_id`), never from caller-supplied text
 * (ADR 0045: a document, tool input or frontmatter can never supply the actor or the
 * child). Returns `null` when the record carries no slug: an unattributable report
 * stays unattributable instead of being pinned on a guessed adapter.
 */
export function storedAdapterKey(
  memory: { slug?: unknown; space_id?: unknown } | null | undefined
): string | null {
  const slug = typeof memory?.slug === 'string' ? memory.slug.trim() : '';
  if (slug.length === 0) return null;
  const spaceId = typeof memory?.space_id === 'string' ? memory.space_id : undefined;
  return adapterGraphKey(storedAdapterScope(spaceId, 'attribution').spaceId, slug);
}

/**
 * Parent lookup order for a child in `childSpaceId`.
 *
 * The child's own scope is always first. The app space is consulted second **only**
 * for a child outside it, because bundled adapters live in the app space and are
 * read-only content every space can execute. The resolved parent scope is returned
 * to the caller and recorded on the edge, so validation and the edge write always
 * agree on one scope instead of silently mixing two.
 */
export function parentScopeCandidates(childSpaceId: string): string[] {
  const child = childSpaceId.trim();
  if (child.length === 0 || child === SQUADRULES_APP_SPACE_ID) return [child].filter(Boolean);
  return [child, SQUADRULES_APP_SPACE_ID];
}

/** Scope + provenance recorded on the node/edge metadata. */
export function scopeMetadata(scope: AdapterGraphScope): Record<string, unknown> {
  return { scope_space_id: scope.spaceId, scope_source: scope.source };
}
