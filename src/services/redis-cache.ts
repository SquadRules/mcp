import type { Memory } from '../types/memory.js';
import { logger } from '../utils/structured-logger.js';
import { keyValueStore } from './key-value-store-factory.js';
import { SQUADRULES_REDIS_PREFIX, MEMORY_CACHE_KEY_PREFIX } from '../config.js';
import { getSpaceIdFromStorage } from '../utils/tenant-context.js';
import { buildLayerUri } from '../tools/squadrules-uri.js';

export interface SearchResult {
  memories: Memory[];
  scores: number[];
}

export interface CachedSearchResult {
  results: Array<{
    uri: string;
    label: string;
    score: number;
  }>;
}

export class RedisCacheService {
  private cachePrefix = 'search:';
  private invalidationChannel = 'cache:invalidation';
  private statsPrefix = 'stats:';
  private memoryPrefix = MEMORY_CACHE_KEY_PREFIX;
  /** Bounded TTL for cached memory resources — safety net when invalidation fails. */
  static readonly MEMORY_CACHE_TTL_SECONDS = 3600;

  constructor() {
    logger.info('[RedisCacheService] Initialized with RedisService');
  }

  private getCacheKey(query: string, limit: number, opts?: { collapse?: boolean }): string {
    const mode = opts && typeof opts.collapse === 'boolean' ? (opts.collapse ? 'collapsed' : 'natural') : 'collapsed';
    return `${this.cachePrefix}${mode}:${query}:${limit}`;
  }

  async getSearchResult(query: string, limit: number, opts?: { collapse?: boolean }): Promise<CachedSearchResult | null> {
    try {
      const key = this.getCacheKey(query, limit, opts);
      const cached = await keyValueStore.getJson<CachedSearchResult>(key);
      if (cached) {
        logger.debug(`[RedisCacheService] Cache hit for query "${query}" limit ${limit}`);
        await this.incrementHits();
        return cached;
      }
      logger.debug(`[RedisCacheService] Cache miss for query "${query}" limit ${limit}`);
      await this.incrementMisses();
      return null;
    } catch (error) {
      logger.error('[RedisCacheService] Failed to get search result from cache:', error);
      return null;
    }
  }

  async setSearchResult(query: string, limit: number, result: SearchResult, opts?: { collapse?: boolean }): Promise<void> {
    try {
      const key = this.getCacheKey(query, limit, opts);
      const ttl = 300; // 5 minutes
      const cachedResult: CachedSearchResult = {
        results: result.memories.map((memory, index) => ({
          uri: buildLayerUri(memory.memory_uuid),
          label: memory.label,
          score: result.scores[index] ?? 0
        }))
      };
      await keyValueStore.setJson(key, cachedResult, ttl);
      logger.debug(`[RedisCacheService] Cached search result for query "${query}" limit ${limit}`);
    } catch (error) {
      logger.error('[RedisCacheService] Failed to set search result in cache:', error);
    }
  }

  async invalidateSearchCache(): Promise<void> {
    try {
      logger.debug(`[RedisCacheService] Search cache invalidation requested`);
      // Delete keys matching search cache pattern (all collapse modes)
      const keys = await keyValueStore.keys(`${this.cachePrefix}*`);
      if (!keys || keys.length === 0) {
        logger.debug('[RedisCacheService] No search cache keys to delete');
        // Still publish invalidation event even if no keys to delete
        await this.publishInvalidation('search');
        return;
      }
      // Keys returned are full Redis keys (prefix + spaceId + logicalKey); strip to get logicalKey for del()
      const keyPrefix = `${SQUADRULES_REDIS_PREFIX}${getSpaceIdFromStorage()}:`;
      const stripped: string[] = keys.map(k =>
        k.startsWith(keyPrefix) ? k.slice(keyPrefix.length) : k
      );
      await Promise.all(stripped.map(k => keyValueStore.del(k)));
      logger.debug(`[RedisCacheService] Invalidated ${stripped.length} search cache keys`);
      // Publish invalidation event
      await this.publishInvalidation('search');
    } catch (error) {
      logger.error('[RedisCacheService] Failed to invalidate search cache:', error);
    }
  }

  // Remove cached memory by UUID. Key is global (prefix+mem:uuid), so one del invalidates for all spaces.
  // Errors are caught and logged; callers that need strict invalidation should use invalidateMemoryCacheStrict.
  async invalidateMemoryCache(uuid: string): Promise<void> {
    try {
      if (!uuid || typeof uuid !== 'string') {
        logger.warn('[RedisCacheService] invalidateMemoryCache called with invalid uuid');
        return;
      }
      const key = `${this.memoryPrefix}${uuid}`;
      await keyValueStore.del(key);
      logger.debug(`[RedisCacheService] Invalidated memory cache for UUID ${uuid}`);
      // Publish invalidation event
      await this.publishInvalidation('memory');
    } catch (error) {
      logger.error('[RedisCacheService] Failed to invalidate memory cache:', error);
    }
  }

  /**
   * Strict memory cache invalidation that propagates errors.
   * Use after writes where a stale cache would cause a false-success response.
   */
  async invalidateMemoryCacheStrict(uuid: string): Promise<void> {
    if (!uuid || typeof uuid !== 'string') {
      throw new Error(`Cannot invalidate memory cache: invalid uuid "${uuid}"`);
    }
    const key = `${this.memoryPrefix}${uuid}`;
    await keyValueStore.del(key);
    logger.debug(`[RedisCacheService] Strict-invalidated memory cache for UUID ${uuid}`);
    await this.publishInvalidation('memory');
  }

  async publishInvalidation(type: string): Promise<void> {
    try {
      const message = JSON.stringify({
        type,
        timestamp: Date.now()
      });
      const subscribers = await keyValueStore.publish(this.invalidationChannel, message);
      logger.debug(`[RedisCacheService] Published invalidation event: ${type} to ${this.invalidationChannel} (${subscribers} subscribers notified)`);
    } catch (error) {
      logger.error('[RedisCacheService] Failed to publish invalidation:', error);
    }
  }

  async incrementHits(): Promise<void> {
    try {
      await keyValueStore.incr(`${this.statsPrefix}hits`);
    } catch (error) {
      logger.error('[RedisCacheService] Failed to increment hits:', error);
    }
  }

  async incrementMisses(): Promise<void> {
    try {
      await keyValueStore.incr(`${this.statsPrefix}misses`);
    } catch (error) {
      logger.error('[RedisCacheService] Failed to increment misses:', error);
    }
  }

  async getCacheStats(): Promise<{ hits: number; misses: number }> {
    try {
      const [hits, misses] = await Promise.all([
        keyValueStore.get(`${this.statsPrefix}hits`),
        keyValueStore.get(`${this.statsPrefix}misses`)
      ]);
      return {
        hits: parseInt(hits || '0', 10),
        misses: parseInt(misses || '0', 10)
      };
    } catch (error) {
      logger.error('[RedisCacheService] Failed to get cache stats:', error);
      return { hits: 0, misses: 0 };
    }
  }

  // Memory resource caching methods
  async getMemoryResource(uuid: string): Promise<Memory | null> {
    try {
      const key = `${this.memoryPrefix}${uuid}`;
      const cached = await keyValueStore.getJson<Memory>(key);
      if (cached) {
        logger.debug(`[RedisCacheService] Memory cache hit for UUID ${uuid}`);
        return cached;
      }
      return null;
    } catch (error) {
      logger.error('[RedisCacheService] Failed to get memory from cache:', error);
      return null;
    }
  }

  async setMemoryResource(memory: Memory): Promise<void> {
    try {
      const key = `${this.memoryPrefix}${memory.memory_uuid}`;
      // Bounded TTL prevents permanent stale data if invalidation fails
      await keyValueStore.setJson(key, memory, RedisCacheService.MEMORY_CACHE_TTL_SECONDS);
      logger.debug(`[RedisCacheService] Cached memory resource for UUID ${memory.memory_uuid} (TTL ${RedisCacheService.MEMORY_CACHE_TTL_SECONDS}s)`);
    } catch (error) {
      logger.error('[RedisCacheService] Failed to cache memory resource:', error);
    }
  }

  // Invalidate the cached activation/search result set
  async invalidateBeginCache(): Promise<void> {
    try {
      logger.debug(`[RedisCacheService] Begin/activate cache invalidation requested`);
      const patterns = ['begin:*', 'activate:*'];
      const merged: string[] = [];
      for (const pattern of patterns) {
        const keys = await keyValueStore.keys(pattern);
        if (keys?.length) merged.push(...keys);
      }
      if (merged.length === 0) {
        logger.debug('[RedisCacheService] No begin/activate cache keys to delete');
        return;
      }
      const unique = [...new Set(merged)];
      // Keys returned are full Redis keys (prefix + spaceId + logicalKey); strip to get logicalKey for del()
      const keyPrefix = `${SQUADRULES_REDIS_PREFIX}${getSpaceIdFromStorage()}:`;
      const stripped: string[] = unique.map(k =>
        k.startsWith(keyPrefix) ? k.slice(keyPrefix.length) : k
      );
      await Promise.all(stripped.map(k => keyValueStore.del(k)));
      logger.debug(`[RedisCacheService] Invalidated ${stripped.length} begin/activate cache keys`);
    } catch (error) {
      logger.error('[RedisCacheService] Failed to invalidate begin cache:', error);
    }
  }

  // For atomic operations as per plan
  // System is mostly read-heavy, so invalidate aggressively on writes
  async invalidateAfterUpdate(): Promise<void> {
    logger.debug('[RedisCacheService] Cache invalidation after Qdrant update - clearing all search and begin caches');
    await Promise.all([
      this.invalidateSearchCache(),
      this.invalidateBeginCache()
    ]);
  }

  // Generic get and set methods for arbitrary caching
  async get(key: string): Promise<string | null> {
    try {
      return await keyValueStore.get(key);
    } catch (error) {
      logger.error('[RedisCacheService] Failed to get from cache:', error);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      await keyValueStore.set(key, value, ttl);
    } catch (error) {
      logger.error('[RedisCacheService] Failed to set in cache:', error);
    }
  }
}

export const redisCacheService = new RedisCacheService();
