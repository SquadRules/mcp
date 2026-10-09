/**
 * OIDC login-transaction state store (PKCE code_verifier + state token).
 *
 * All state flows through the shared keyValueStore (Redis when configured,
 * in-memory MemoryStore otherwise). There is a single backend-selection
 * decision in key-value-store-factory.ts driven by `isRedisConfigured`;
 * this module never checks REDIS_URL or deployment topology independently.
 *
 * Keys are global (no space namespace) because login has no space context.
 */

import { isRedisConfigured, OIDC_STATE_KEY_PREFIX } from '../config.js';
import { keyValueStore } from './key-value-store-factory.js';
import { logger } from '../utils/structured-logger.js';

/** TTL for OIDC state entries (10 minutes), in seconds for Redis SETEX. */
const STATE_TTL_SECONDS = 600;

/** Shape stored per OIDC login transaction. */
export interface OidcStateEntry {
  codeVerifier: string;
  createdAt: number;
}

/** Storage key for a given state token. */
function stateKey(state: string): string {
  return `${OIDC_STATE_KEY_PREFIX}${state}`;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface OidcStateStore {
  /** Persist PKCE state for a new login transaction. */
  set(state: string, entry: OidcStateEntry): Promise<void>;
  /**
   * Atomically consume (read-then-delete) a state entry.
   * Returns the entry on first call, undefined on subsequent calls or after TTL.
   */
  consume(state: string): Promise<OidcStateEntry | undefined>;
  /** Backend label for startup logging. */
  readonly backend: 'redis' | 'memory';
}

// ---------------------------------------------------------------------------
// Unified implementation — delegates to keyValueStore (Redis or MemoryStore)
// ---------------------------------------------------------------------------

class KeyValueOidcStateStore implements OidcStateStore {
  readonly backend: 'redis' | 'memory' = isRedisConfigured ? 'redis' : 'memory';

  async set(state: string, entry: OidcStateEntry): Promise<void> {
    await keyValueStore.setJson(stateKey(state), entry, STATE_TTL_SECONDS);
  }

  async consume(state: string): Promise<OidcStateEntry | undefined> {
    // Atomic GETDEL via keyValueStore: no race window.
    const entry = await keyValueStore.getdelJson<OidcStateEntry>(stateKey(state));
    return entry ?? undefined;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

logger.info(
  isRedisConfigured
    ? 'OIDC state: shared (Redis)'
    : 'OIDC state: in-memory'
);

/** Singleton OIDC state store. Backend is determined by isRedisConfigured in config. */
export const oidcStateStore: OidcStateStore = new KeyValueOidcStateStore();
