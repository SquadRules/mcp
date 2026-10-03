// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Space and tenant context for multitenancy.
 * SpaceContext is derived from Keycloak (sub + groups); getTenantId() remains for metrics.
 * AsyncLocalStorage allows Redis and other services to get current space without request reference.
 * When AUTH_ENABLED, default space is disabled for strict isolation; unauthenticated/no-context
 * uses a sentinel space so no tenant data is shared.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { v5 as uuidv5 } from 'uuid';
import {
  AUTH_ENABLED,
  KAIROS_APP_SPACE_ID,
  KAIROS_SIMPLE_PERSONAL_REALM,
  KAIROS_SIMPLE_PERSONAL_SPACE_ID,
  KAIROS_SIMPLE_PERSONAL_UUIDV5_SEED
} from '../config.js';
import { resolveSpaceParamForContext } from './resolve-space-param.js';

/** Sentinel space when AUTH is on but no auth context (strict isolation; not shared with tenants). */
export const NO_AUTH_SPACE_ID = 'space:no-auth';

export interface SpaceContext {
  userId: string;
  groupIds: string[];
  allowedSpaceIds: string[];
  defaultWriteSpaceId: string;
  /**
   * User personal space id (`user:…`) from JWT, unchanged when `?space=` narrows
   * `allowedSpaceIds` / `defaultWriteSpaceId` to a group. Used to resolve explicit
   * `space: "personal"` on train/tune so it cannot alias to the query-scoped group.
   */
  personalSpaceId: string;
  /** Human labels for currently allowed spaces (token/session-derived only). */
  spaceNamesById?: Record<string, string>;
  requestId?: string;
  /**
   * When set (e.g. activate/search space parameter), vector search uses exactly these IDs — no implicit merge of Squadrules app.
   * Writes should still use defaultWriteSpaceId when the scope is read-only (app space).
   */
  activateSpaceScope?: string[];
}

/** Sentinel for "no context" when restoring after runWithSpaceContextAsync (enterWith does not accept undefined). */
const NO_CONTEXT_SENTINEL: SpaceContext = {
  userId: '',
  groupIds: [],
  allowedSpaceIds: [],
  defaultWriteSpaceId: '',
  personalSpaceId: '',
  spaceNamesById: {},
  requestId: ''
};

const spaceStorage = new AsyncLocalStorage<SpaceContext>();

function defaultSpaceContext(): SpaceContext {
  const personalSpaceId = defaultPersonalSpaceIdForNoAuth();
  const appSpaceId = KAIROS_APP_SPACE_ID;
  return {
    userId: '',
    groupIds: [],
    allowedSpaceIds: [personalSpaceId, appSpaceId],
    defaultWriteSpaceId: personalSpaceId,
    personalSpaceId: personalSpaceId,
    spaceNamesById: { [personalSpaceId]: 'Personal', [appSpaceId]: 'Squadrules app' },
    requestId: ''
  };
}

/** Context when AUTH_ENABLED and no auth/storage — no access to shared default space. */
function noDefaultSpaceContext(): SpaceContext {
  return {
    userId: '',
    groupIds: [],
    allowedSpaceIds: [],
    defaultWriteSpaceId: NO_AUTH_SPACE_ID,
    personalSpaceId: '',
    spaceNamesById: {},
    requestId: ''
  };
}

/**
 * Run a function with the given space context stored in AsyncLocalStorage.
 * Used by HTTP auth middleware so Redis and Qdrant helpers can read space without request.
 * For sync callbacks the context is preserved. For async callbacks use runWithSpaceContextAsync
 * so the context persists across await boundaries (run() loses context after the callback returns a Promise).
 */
export function runWithSpaceContext<T>(ctx: SpaceContext, fn: () => T): T {
  return spaceStorage.run(ctx, fn);
}

/**
 * Run an async function with the given space context. Uses enterWith so the context
 * persists for the entire async execution (including all await continuations).
 * Use this when the callback does async work (e.g. storeChain) and getSpaceContext()
 * must see the context inside that work.
 */
export async function runWithSpaceContextAsync<T>(ctx: SpaceContext, fn: () => Promise<T>): Promise<T> {
  const prev = spaceStorage.getStore();
  spaceStorage.enterWith(ctx);
  try {
    return await fn();
  } finally {
    spaceStorage.enterWith(prev ?? NO_CONTEXT_SENTINEL);
  }
}

/**
 * Get space context from AsyncLocalStorage (set by auth middleware via runWithSpaceContext).
 * When not in a request: if AUTH_ENABLED, returns no-default context (strict isolation);
 * otherwise returns default single-tenant context.
 */
export function getSpaceContextFromStorage(): SpaceContext {
  const stored = spaceStorage.getStore();
  if (stored && stored !== NO_CONTEXT_SENTINEL) return stored;
  return AUTH_ENABLED ? noDefaultSpaceContext() : defaultSpaceContext();
}

/** Current space id for Redis key prefix and similar; uses storage or KAIROS_APP_SPACE_ID when auth off. */
export function getSpaceIdFromStorage(): string {
  return getSpaceContextFromStorage().defaultWriteSpaceId;
}

/** Correlation id propagated through AsyncLocalStorage for forensic tracing. */
export function getRequestIdFromStorage(): string {
  const requestId = getSpaceContextFromStorage().requestId;
  return requestId && requestId.trim().length > 0 ? requestId : 'no-request-id';
}

/**
 * Space IDs to use for search only: allowedSpaceIds plus Squadrules app space (deduped).
 * Writes (train, tune, delete) continue to use allowedSpaceIds only.
 */
export function getSearchSpaceIds(): string[] {
  const ctx = getSpaceContextFromStorage();
  const scope = ctx.activateSpaceScope;
  if (scope && scope.length > 0) {
    return [...scope];
  }
  const allowed = ctx.allowedSpaceIds;
  if (allowed.includes(KAIROS_APP_SPACE_ID)) return [...allowed];
  return [...allowed, KAIROS_APP_SPACE_ID];
}

/**
 * Async variant: run fn in narrowed space context so context persists across await.
 * Use when the callback does async work (for example search) and getSpaceContext() must see the context.
 */
export async function runWithOptionalSpaceAsync<T>(spaceParam: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!spaceParam || typeof spaceParam !== 'string') return fn();
  const trimmed = spaceParam.trim();
  if (!trimmed) return fn();
  const ctx = getSpaceContextFromStorage();
  const searchableBeforeNarrow = getSearchSpaceIds();
  const resolved = resolveSpaceParamForContext(ctx, trimmed, { allowReadOnlyAppSearchScope: true });
  if (!resolved.ok) {
    throw new Error(resolved.message);
  }
  const spaceId = resolved.spaceId;
  if (!searchableBeforeNarrow.includes(spaceId)) {
    throw new Error('Requested space is not in your allowed spaces');
  }
  const readOnlyAppScope = spaceId === KAIROS_APP_SPACE_ID;
  const narrowed: SpaceContext = {
    ...ctx,
    allowedSpaceIds: [spaceId],
    defaultWriteSpaceId: readOnlyAppScope ? ctx.defaultWriteSpaceId : spaceId,
    personalSpaceId: ctx.personalSpaceId,
    activateSpaceScope: [spaceId]
  };
  return runWithSpaceContextAsync(narrowed, fn);
}

/**
 * Build allowed spaces from JWT-derived auth (`sub`, `groups`, `realm`, `iss`).
 * - Personal id: `user:{realm}:{uuidv5(iss + "\\nuser\\n" + sub)}`
 * - Group id: `group:{realm}:{uuidv5(iss + "\\ngroup\\n" + fullPath)}`
 * Group names shown by tools/UI are canonical Keycloak full paths from the token.
 */
const SPACE_ID_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

function normalizeRealmSlug(realm: string): string {
  const raw = (realm || '').trim().toLowerCase();
  const slug = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'default';
}

function normalizeIssuer(iss: string, realm: string): string {
  const trimmed = (iss || '').trim();
  if (!trimmed) return `realm:${realm}`;
  return trimmed.replace(/\/+$/, '');
}

function defaultPersonalSpaceIdForNoAuth(): string {
  if (KAIROS_SIMPLE_PERSONAL_UUIDV5_SEED.length > 0) {
    const realmSlug = normalizeRealmSlug(KAIROS_SIMPLE_PERSONAL_REALM);
    const personalUuid = uuidv5(KAIROS_SIMPLE_PERSONAL_UUIDV5_SEED, SPACE_ID_NAMESPACE);
    return `user:${realmSlug}:${personalUuid}`;
  }
  return KAIROS_SIMPLE_PERSONAL_SPACE_ID;
}

function normalizeGroupFullPath(value: string): string {
  const t = (value || '').trim();
  if (!t) return '';
  const withLeading = t.startsWith('/') ? t : `/${t}`;
  return withLeading.replace(/\/+/g, '/');
}

function fromAuthPayload(
  sub: string,
  groupNames: string[],
  realm: string,
  iss: string
): {
  allowedSpaceIds: string[];
  defaultWriteSpaceId: string;
  spaceNamesById: Record<string, string>;
  personalSpaceId: string;
} {
  const realmSlug = normalizeRealmSlug(realm);
  const issuerKey = normalizeIssuer(iss, realmSlug);
  const personalUuid = uuidv5(`${issuerKey}\nuser\n${sub}`, SPACE_ID_NAMESPACE);
  const personal = `user:${realmSlug}:${personalUuid}`;
  const groupSpaces: string[] = [];
  const spaceNamesById: Record<string, string> = { [personal]: 'Personal' };
  const seen = new Set<string>();
  for (const rawPath of groupNames) {
    const fullPath = normalizeGroupFullPath(rawPath);
    if (!fullPath) continue;
    const groupUuid = uuidv5(`${issuerKey}\ngroup\n${fullPath}`, SPACE_ID_NAMESPACE);
    const sid = `group:${realmSlug}:${groupUuid}`;
    if (seen.has(sid)) continue;
    seen.add(sid);
    groupSpaces.push(sid);
    spaceNamesById[sid] = fullPath;
  }
  const allowedSpaceIds = [personal, ...groupSpaces];
  const defaultWriteSpaceId = personal;
  return { allowedSpaceIds, defaultWriteSpaceId, spaceNamesById, personalSpaceId: personal };
}

/**
 * Get space context from request. Uses req.auth (set by auth middleware) when AUTH_ENABLED.
 * When AUTH_ENABLED and no auth, returns no-default context (strict isolation).
 * When AUTH_ENABLED=false, returns default single-tenant context.
 * If no request is passed, falls back to AsyncLocalStorage (e.g. from runWithSpaceContext).
 */
export function getSpaceContext(request?: {
  auth?: { sub: string; groups: string[]; realm?: string; iss?: string };
  spaceContext?: SpaceContext;
  requestId?: string;
  headers?: { [key: string]: unknown };
}): SpaceContext {
  if (request?.spaceContext) return request.spaceContext;
  const stored = spaceStorage.getStore();
  if (stored && stored !== NO_CONTEXT_SENTINEL) return stored;
  const requestId =
    typeof request?.requestId === 'string'
      ? request.requestId
      : typeof request?.headers?.['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : '';
  if (!AUTH_ENABLED) return { ...defaultSpaceContext(), requestId };
  const auth = request?.auth;
  if (!auth?.sub) return { ...noDefaultSpaceContext(), requestId };
  const realm = auth.realm ?? 'default';
  const iss = auth.iss ?? `realm:${realm}`;
  const { allowedSpaceIds, defaultWriteSpaceId, spaceNamesById, personalSpaceId } = fromAuthPayload(
    auth.sub,
    auth.groups ?? [],
    realm,
    iss
  );
  return {
    userId: auth.sub,
    groupIds: auth.groups ?? [],
    allowedSpaceIds,
    defaultWriteSpaceId,
    personalSpaceId,
    spaceNamesById,
    requestId
  };
}

/**
 * Persist request-derived space context across async HTTP route handlers.
 * Auth middleware sets `req.spaceContext` using synchronous `spaceStorage.run`, which does not
 * keep AsyncLocalStorage active after the handler awaits; wrap the tool body with this helper.
 */
export async function runHttpApiWithSpaceContext<T>(
  request: Parameters<typeof getSpaceContext>[0],
  fn: () => Promise<T>
): Promise<T> {
  return runWithSpaceContextAsync(getSpaceContext(request), fn);
}

/**
 * Get tenant ID for metrics. Returns default write space id or first allowed space.
 */
export function getTenantId(request?: any): string {
  const ctx = getSpaceContext(request);
  return ctx.defaultWriteSpaceId || ctx.allowedSpaceIds[0] || 'default';
}
