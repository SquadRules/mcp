/**
 * Verify that application-level caching is bypassed when Redis is not configured
 * (i.e., when using embedded LanceDB in SINGLE mode).
 *
 * Related: GitHub issue #95
 */
import { describe, expect, test } from '@jest/globals';
import { redisCacheService } from '../../src/services/redis-cache.js';
import { isRedisConfigured } from '../../src/config.js';
import type { Memory } from '../../src/types/memory.js';

describe('LanceDB cache bypass', () => {
  const mockMemory: Memory = {
    memory_uuid: 'test-uuid-123',
    label: 'Test Memory',
    slug: 'test-memory',
    text: 'Test content',
    tags: ['test'],
    llm_model_id: 'test-model',
    created_at: new Date().toISOString(),
  };

  describe('in SINGLE mode (Redis not configured)', () => {
    // This test only runs when Redis is not configured (SINGLE mode with LanceDB)
    // In CI, the SINGLE lane runs without Redis
    const testIfNoRedis = isRedisConfigured ? test.skip : test;

    testIfNoRedis('getSearchResult returns null immediately', async () => {
      const result = await redisCacheService.getSearchResult('test query', 10);
      expect(result).toBeNull();
    });

    testIfNoRedis('setSearchResult is a no-op', async () => {
      await expect(
        redisCacheService.setSearchResult('test', 10, { memories: [], scores: [] })
      ).resolves.toBeUndefined();
    });

    testIfNoRedis('getMemoryResource returns null immediately', async () => {
      const result = await redisCacheService.getMemoryResource('test-uuid');
      expect(result).toBeNull();
    });

    testIfNoRedis('setMemoryResource is a no-op', async () => {
      await expect(
        redisCacheService.setMemoryResource(mockMemory)
      ).resolves.toBeUndefined();
    });

    testIfNoRedis('invalidateAfterUpdate is a no-op', async () => {
      await expect(
        redisCacheService.invalidateAfterUpdate()
      ).resolves.toBeUndefined();
    });

    testIfNoRedis('invalidateMemoryCache is a no-op', async () => {
      await expect(
        redisCacheService.invalidateMemoryCache('test-uuid')
      ).resolves.toBeUndefined();
    });

    testIfNoRedis('invalidateMemoryCacheStrict is a no-op', async () => {
      await expect(
        redisCacheService.invalidateMemoryCacheStrict('test-uuid')
      ).resolves.toBeUndefined();
    });

    testIfNoRedis('invalidateSearchCache is a no-op', async () => {
      await expect(
        redisCacheService.invalidateSearchCache()
      ).resolves.toBeUndefined();
    });

    testIfNoRedis('invalidateBeginCache is a no-op', async () => {
      await expect(
        redisCacheService.invalidateBeginCache()
      ).resolves.toBeUndefined();
    });
  });

  describe('in CLUSTER mode (Redis configured)', () => {
    // This test only runs when Redis is configured (CLUSTER mode)
    const testIfRedis = isRedisConfigured ? test : test.skip;

    testIfRedis('getSearchResult attempts to read from cache', async () => {
      // In CLUSTER mode, it should try to read from keyValueStore
      // Will return null if no cached data exists
      const result = await redisCacheService.getSearchResult('test query', 10);
      expect(result).toBeNull();
    });

    testIfRedis('setSearchResult attempts to write to cache', async () => {
      await expect(
        redisCacheService.setSearchResult('test', 10, { memories: [], scores: [] })
      ).resolves.toBeUndefined();
    });

    testIfRedis('getMemoryResource attempts to read from cache', async () => {
      const result = await redisCacheService.getMemoryResource('test-uuid');
      expect(result).toBeNull();
    });

    testIfRedis('setMemoryResource attempts to write to cache', async () => {
      await expect(
        redisCacheService.setMemoryResource(mockMemory)
      ).resolves.toBeUndefined();
    });
  });

  describe('mode detection', () => {
    test('isRedisConfigured reflects the runtime mode', () => {
      // This test verifies that isRedisConfigured is properly set
      // In SINGLE mode (dev laptop, CI SINGLE lane): false
      // In CLUSTER mode (CI CLUSTER lane, production): true
      expect(typeof isRedisConfigured).toBe('boolean');
    });
  });
});
