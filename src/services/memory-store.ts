/**
 * In-memory key-value store for setups without a shared Redis backend.
 * Same key prefix and space namespacing as RedisService; keys(pattern) uses simple glob.
 * publish() is a no-op (returns 0); no cross-process invalidation.
 * Selected automatically by key-value-store-factory when isRedisConfigured is false.
 */

import { logger } from '../utils/structured-logger.js';
import { SQUADRULES_REDIS_PREFIX, MEMORY_CACHE_KEY_PREFIX, OIDC_STATE_KEY_PREFIX } from '../config.js';
import { getSpaceIdFromStorage } from '../utils/tenant-context.js';
import type { IKeyValueStore } from './key-value-store.js';

interface TtlEntry {
  value: string;
  expiresAt: number | null;
}

/** Convert glob pattern (e.g. "prefix:*") to regex; * matches any characters. */
function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export class MemoryStore implements IKeyValueStore {
  private readonly prefix = SQUADRULES_REDIS_PREFIX;
  private readonly strings = new Map<string, TtlEntry>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly counters = new Map<string, number>();
  private connected = true;

  constructor() {
    logger.debug(
      `[MemoryStore] Initializing with SQUADRULES_REDIS_PREFIX="${this.prefix}" (no Redis)`
    );
  }

  private getKey(key: string): string {
    if (key.startsWith(MEMORY_CACHE_KEY_PREFIX) || key.startsWith(OIDC_STATE_KEY_PREFIX)) {
      return `${this.prefix}${key}`;
    }
    const spaceId = getSpaceIdFromStorage();
    return `${this.prefix}${spaceId}:${key}`;
  }

  private maybeExpired(entry: TtlEntry): boolean {
    if (entry.expiresAt === null) return false;
    return Date.now() > entry.expiresAt;
  }

  async get(key: string): Promise<string | null> {
    const k = this.getKey(key);
    const entry = this.strings.get(k);
    if (!entry) return null;
    if (this.maybeExpired(entry)) {
      this.strings.delete(k);
      return null;
    }
    return entry.value;
  }

  async getdel(key: string): Promise<string | null> {
    const k = this.getKey(key);
    const entry = this.strings.get(k);
    if (!entry) return null;
    this.strings.delete(k);
    if (this.maybeExpired(entry)) return null;
    return entry.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const k = this.getKey(key);
    const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
    this.strings.set(k, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    const k = this.getKey(key);
    this.strings.delete(k);
    this.hashes.delete(k);
    this.counters.delete(k);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`[MemoryStore] JSON parse error for key ${key}:`, error);
      return null;
    }
  }

  async getdelJson<T>(key: string): Promise<T | null> {
    const value = await this.getdel(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`[MemoryStore] JSON parse error for key ${key}:`, error);
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const jsonValue = JSON.stringify(value);
      await this.set(key, jsonValue, ttl);
    } catch (error) {
      logger.error(`[MemoryStore] JSON stringify error for key ${key}:`, error);
    }
  }

  async hget(hash: string, field: string): Promise<string | null> {
    const k = this.getKey(hash);
    const h = this.hashes.get(k);
    return (h && h.get(field)) ?? null;
  }

  async hset(hash: string, field: string, value: string): Promise<void> {
    const k = this.getKey(hash);
    let h = this.hashes.get(k);
    if (!h) {
      h = new Map();
      this.hashes.set(k, h);
    }
    h.set(field, value);
  }

  async hgetall(hash: string): Promise<Record<string, string> | null> {
    const k = this.getKey(hash);
    const h = this.hashes.get(k);
    if (!h || h.size === 0) return null;
    const out: Record<string, string> = {};
    h.forEach((v, f) => {
      out[f] = v;
    });
    return out;
  }

  async hsetall(hash: string, data: Record<string, string>): Promise<void> {
    const k = this.getKey(hash);
    const h = new Map<string, string>();
    for (const [f, v] of Object.entries(data)) h.set(f, v);
    this.hashes.set(k, h);
  }

  async incr(key: string): Promise<number> {
    const k = this.getKey(key);
    const prev = this.counters.get(k) ?? 0;
    const next = prev + 1;
    this.counters.set(k, next);
    return next;
  }

  async exists(key: string): Promise<boolean> {
    const k = this.getKey(key);
    if (this.strings.has(k)) {
      const e = this.strings.get(k)!;
      if (!this.maybeExpired(e)) return true;
      this.strings.delete(k);
    }
    if (this.hashes.has(k) || this.counters.has(k)) return true;
    return false;
  }

  async keys(pattern: string): Promise<string[]> {
    const fullPattern = this.getKey(pattern);
    const re = globToRegex(fullPattern);
    const result: string[] = [];
    for (const k of this.strings.keys()) {
      if (re.test(k)) result.push(k);
    }
    for (const k of this.hashes.keys()) {
      if (re.test(k) && !result.includes(k)) result.push(k);
    }
    for (const k of this.counters.keys()) {
      if (re.test(k) && !result.includes(k)) result.push(k);
    }
    return result;
  }

  async publish(_channel: string, _message: string): Promise<number> {
    return 0;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
