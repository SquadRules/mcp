// squadrules-compat-surface: uses the persisted KAIROS_REDIS_PREFIX Redis key prefix shared with existing deployments
import { createClient, RedisClientType } from 'redis';
import { keyValueStore } from '../../src/services/key-value-store-factory.js';
import { RedisCacheService, redisCacheService } from '../../src/services/redis-cache.js';
import { KAIROS_REDIS_PREFIX, KAIROS_APP_SPACE_ID, REDIS_URL, MEMORY_CACHE_KEY_PREFIX } from '../../src/config.js';
import { runWithSpaceContextAsync } from '../../src/utils/tenant-context.js';
import type { Memory } from '../../src/types/memory.js';
import { isHttpTransport } from '../utils/auth-headers.js';

/**
 * Key layout must match RedisService.getKey() and RedisCacheService:
 * - Space-scoped (search, begin, stats): prefix + spaceId + ':' + logicalKey
 * - Memory (mem:*): prefix + mem: + uuid (global, no space)
 * Use runWithSpaceContextAsync so context persists across await (required for cache ops).
 */
async function withDefaultSpace<T>(fn: () => Promise<T>): Promise<T> {
  const spaceId = KAIROS_APP_SPACE_ID;
  return runWithSpaceContextAsync(
    {
      userId: '',
      groupIds: [],
      allowedSpaceIds: [spaceId],
      defaultWriteSpaceId: spaceId,
      personalSpaceId: ''
    },
    fn
  );
}

/** Build full Redis key for space-scoped keys: prefix + spaceId + ':' + suffix */
function redisKey(suffix: string): string {
  return `${KAIROS_REDIS_PREFIX}${KAIROS_APP_SPACE_ID}:${suffix}`;
}

/** Build full Redis key for memory cache (global, no space): prefix + mem: + uuid */
function memoryRedisKey(uuid: string): string {
  return `${KAIROS_REDIS_PREFIX}${MEMORY_CACHE_KEY_PREFIX}${uuid}`;
}

const describeRedis = REDIS_URL && isHttpTransport() ? describe : describe.skip;

describeRedis('Redis Pub/Sub Integration Tests', () => {
  let testClient: RedisClientType;
  let subscriberClient: RedisClientType;
  const testPrefix = `${KAIROS_REDIS_PREFIX}test:`;

  beforeAll(async () => {
    await keyValueStore.connect();

    // Create test Redis client for direct verification
    testClient = createClient({ url: REDIS_URL });
    await testClient.connect();

    // Create subscriber client for pub/sub tests
    subscriberClient = testClient.duplicate();
    await subscriberClient.connect();
  }, 30000);

  afterAll(async () => {
    // Clean up test keys
    if (testClient && testClient.isOpen) {
      const keys = await testClient.keys(`${testPrefix}*`);
      if (keys.length > 0) {
        await testClient.del(keys);
      }
      await testClient.quit();
    }
    if (subscriberClient && subscriberClient.isOpen) {
      await subscriberClient.quit();
    }
    
    await keyValueStore.disconnect();
  }, 10000);

  beforeEach(async () => {
    // Clean up test keys before each test
    if (testClient && testClient.isOpen) {
      const keys = await testClient.keys(`${testPrefix}*`);
      if (keys.length > 0) {
        await testClient.del(keys);
      }
    }
  });

  describe('RedisService.publish()', () => {
    test('should publish messages to Redis channel', async () => {
      const channel = `${testPrefix}test-channel`;
      const message = JSON.stringify({ test: 'data', timestamp: Date.now() });
      
      const receivedMessages: string[] = [];
      await subscriberClient.subscribe(channel, (msg) => {
        receivedMessages.push(msg);
      });

      // Wait for subscription to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      const subscribers = await keyValueStore.publish(channel, message);
      
      expect(subscribers).toBeGreaterThanOrEqual(1);

      // Wait for message to be received
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toBe(message);

      await subscriberClient.unsubscribe(channel);
    });

    test('should return 0 subscribers when no one is listening', async () => {
      const channel = `${testPrefix}empty-channel`;
      const message = 'test message';
      
      const subscribers = await keyValueStore.publish(channel, message);
      expect(subscribers).toBe(0);
    });
  });

  describe('RedisCacheService.publishInvalidation()', () => {
    test('should publish invalidation events to cache:invalidation channel', async () => {
      const channel = 'cache:invalidation';
      const receivedMessages: Array<{ type: string; timestamp: number }> = [];
      
      await subscriberClient.subscribe(channel, (msg) => {
        try {
          receivedMessages.push(JSON.parse(msg));
        } catch (_e) {
          // Ignore parse errors
        }
      });

      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish invalidation
      await redisCacheService.publishInvalidation('search');

      // Wait for message
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
      const lastMessage = receivedMessages[receivedMessages.length - 1];
      expect(lastMessage.type).toBe('search');
      expect(lastMessage.timestamp).toBeGreaterThan(0);

      await subscriberClient.unsubscribe(channel);
    });
  });

  describe('Memory Storage (With TTL)', () => {
    test('should store memories with bounded TTL (1 hour)', async () => {
      await withDefaultSpace(async () => {
        const testMemory: Memory = {
          memory_uuid: 'test-memory-uuid-123',
          label: 'Test Memory',
          text: 'Test content',
          tags: ['test'],
          previous_memory_uuid: null,
          next_memory_uuid: null,
          llm_model_id: 'test-model',
          created_at: new Date().toISOString()
        };

        // Store memory (uses global key: prefix + mem:uuid, no space namespace)
        await redisCacheService.setMemoryResource(testMemory);

        // Verify key exists in Redis (global memory key)
        const key = memoryRedisKey(testMemory.memory_uuid);
        const exists = await testClient.exists(key);
        expect(exists).toBe(1);

        // Verify TTL is set (bounded expiration, not -1 permanent)
        const ttl = await testClient.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(RedisCacheService.MEMORY_CACHE_TTL_SECONDS);

        // Verify content
        const stored = await redisCacheService.getMemoryResource(testMemory.memory_uuid);
        expect(stored).not.toBeNull();
        expect(stored?.memory_uuid).toBe(testMemory.memory_uuid);
        expect(stored?.label).toBe(testMemory.label);
      });
    });
  });

  describe('Search Cache (With TTL)', () => {
    test('should store search results with TTL (5 minutes)', async () => {
      await withDefaultSpace(async () => {
        const query = 'test query';
        const limit = 10;
        const searchResult = {
          memories: [],
          scores: []
        };

        // Store search result
        await redisCacheService.setSearchResult(query, limit, searchResult);

        // Verify key exists (keys are namespaced by space)
        const key = redisKey(`search:collapsed:${query}:${limit}`);
        const exists = await testClient.exists(key);
        expect(exists).toBe(1);

        // Verify TTL is approximately 300 seconds (5 minutes)
        const ttl = await testClient.ttl(key);
        expect(ttl).toBeGreaterThan(290); // Allow some margin for test execution time
        expect(ttl).toBeLessThanOrEqual(300);
      });
    });
  });

  describe('Cache Invalidation', () => {
    test('should invalidate memory cache and publish event', async () => {
      const channel = 'cache:invalidation';
      const receivedMessages: Array<{ type: string }> = [];
      await subscriberClient.subscribe(channel, (msg) => {
        try {
          receivedMessages.push(JSON.parse(msg));
        } catch (_e) {
          // Ignore
        }
      });
      await new Promise(resolve => setTimeout(resolve, 100));

      await withDefaultSpace(async () => {
        const testMemory: Memory = {
          memory_uuid: 'test-invalidate-uuid',
          label: 'Test Memory',
          text: 'Test content',
          tags: ['test'],
          previous_memory_uuid: null,
          next_memory_uuid: null,
          llm_model_id: 'test-model',
          created_at: new Date().toISOString()
        };

        // Store memory
        await redisCacheService.setMemoryResource(testMemory);

        // Verify it exists (memory keys are global)
        const key = memoryRedisKey(testMemory.memory_uuid);
        expect(await testClient.exists(key)).toBe(1);

        // Invalidate memory cache
        await redisCacheService.invalidateMemoryCache(testMemory.memory_uuid);

        // Wait for invalidation event
        await new Promise(resolve => setTimeout(resolve, 200));

        // Verify key is deleted
        expect(await testClient.exists(key)).toBe(0);
      });

      // Verify invalidation event was published
      const memoryInvalidations = receivedMessages.filter(m => m.type === 'memory');
      expect(memoryInvalidations.length).toBeGreaterThanOrEqual(1);

      await subscriberClient.unsubscribe(channel);
    });

    test('should invalidate search cache and publish event', async () => {
      const channel = 'cache:invalidation';
      const receivedMessages: Array<{ type: string }> = [];
      await subscriberClient.subscribe(channel, (msg) => {
        try {
          receivedMessages.push(JSON.parse(msg));
        } catch (_e) {
          // Ignore
        }
      });
      await new Promise(resolve => setTimeout(resolve, 100));

      await withDefaultSpace(async () => {
        const query = 'test search';
        const limit = 5;
        const searchResult = {
          memories: [],
          scores: []
        };

        // Store search result
        await redisCacheService.setSearchResult(query, limit, searchResult);

        // Verify it exists (keys are namespaced by space)
        const key = redisKey(`search:collapsed:${query}:${limit}`);
        expect(await testClient.exists(key)).toBe(1);

        // Invalidate search cache
        await redisCacheService.invalidateSearchCache();

        // Wait for invalidation
        await new Promise(resolve => setTimeout(resolve, 200));

        // Verify key is deleted
        expect(await testClient.exists(key)).toBe(0);
      });

      // Verify invalidation event was published
      const searchInvalidations = receivedMessages.filter(m => m.type === 'search');
      expect(searchInvalidations.length).toBeGreaterThanOrEqual(1);

      await subscriberClient.unsubscribe(channel);
    });
  });

  describe('End-to-End Cache Invalidation Flow', () => {
    test('should publish invalidation events when memory operations occur', async () => {
      const channel = 'cache:invalidation';
      const receivedMessages: Array<{ type: string }> = [];
      
      await subscriberClient.subscribe(channel, (msg) => {
        try {
          receivedMessages.push(JSON.parse(msg));
        } catch (_e) {
          // Ignore
        }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate what happens in memory-store.ts after storeMemory
      // Now invalidation methods handle publishing internally
      await redisCacheService.invalidateMemoryCache('test-uuid');
      await redisCacheService.invalidateAfterUpdate();

      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify both invalidation types were published
      const memoryEvents = receivedMessages.filter(m => m.type === 'memory');
      const searchEvents = receivedMessages.filter(m => m.type === 'search');
      
      expect(memoryEvents.length).toBeGreaterThanOrEqual(1);
      expect(searchEvents.length).toBeGreaterThanOrEqual(1);

      await subscriberClient.unsubscribe(channel);
    });
  });
});
