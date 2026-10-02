// squadrules-compat-surface: uses the persisted KAIROS_REDIS_PREFIX Redis key prefix shared with existing deployments
import { createClient, RedisClientType } from 'redis';
import { keyValueStore } from '../../../src/services/key-value-store-factory.js';
import { redisCacheService } from '../../../src/services/redis-cache.js';
import {
  KAIROS_REDIS_PREFIX,
  KAIROS_APP_SPACE_ID,
  REDIS_URL,
  KAIROS_ENABLE_GROUP_COLLAPSE
} from '../../../src/config.js';
import { runWithSpaceContextAsync } from '../../../src/utils/tenant-context.js';
import { isHttpTransport } from '../../utils/auth-headers.js';

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

function redisKey(suffix: string): string {
  return `${KAIROS_REDIS_PREFIX}${KAIROS_APP_SPACE_ID}:${suffix}`;
}

const describeRedis = REDIS_URL && isHttpTransport() ? describe : describe.skip;

/** executeSearch / MCP activate cache keys; memory CUD must call invalidateAfterUpdate to clear them. */
describeRedis('Redis activate cache invalidation', () => {
  let testClient: RedisClientType;
  const testPrefix = `${KAIROS_REDIS_PREFIX}test:`;

  beforeAll(async () => {
    await keyValueStore.connect();
    testClient = createClient({ url: REDIS_URL });
    await testClient.connect();
  }, 30000);

  afterAll(async () => {
    if (testClient?.isOpen) {
      const keys = await testClient.keys(`${testPrefix}*`);
      if (keys.length > 0) await testClient.del(keys);
      await testClient.quit();
    }
    await keyValueStore.disconnect();
  }, 10000);

  beforeEach(async () => {
    if (testClient?.isOpen) {
      const keys = await testClient.keys(`${testPrefix}*`);
      if (keys.length > 0) await testClient.del(keys);
    }
  });

  test('invalidateAfterUpdate removes all activate:* keys for the current space', async () => {
    await withDefaultSpace(async () => {
      const spaceId = KAIROS_APP_SPACE_ID;
      const collapse = KAIROS_ENABLE_GROUP_COLLAPSE;
      const keyA = `activate:v6:${spaceId}:query-a:${collapse}:8`;
      const keyB = `activate:v6:${spaceId}:query-b:${collapse}:10`;
      await redisCacheService.set(keyA, '{"choices":[]}', 120);
      await redisCacheService.set(keyB, '{"choices":[]}', 120);
      expect(await testClient.exists(redisKey(keyA))).toBe(1);
      expect(await testClient.exists(redisKey(keyB))).toBe(1);

      await redisCacheService.invalidateAfterUpdate();

      expect(await testClient.exists(redisKey(keyA))).toBe(0);
      expect(await testClient.exists(redisKey(keyB))).toBe(0);
    });
  });

  test('invalidateSearchCache alone does not remove activate:* keys; invalidateAfterUpdate does', async () => {
    await withDefaultSpace(async () => {
      const spaceId = KAIROS_APP_SPACE_ID;
      const collapse = KAIROS_ENABLE_GROUP_COLLAPSE;
      const keyAct = `activate:v6:${spaceId}:semantic-task:${collapse}:5`;
      await redisCacheService.set(keyAct, '{}', 120);
      expect(await testClient.exists(redisKey(keyAct))).toBe(1);

      await redisCacheService.invalidateSearchCache();
      expect(await testClient.exists(redisKey(keyAct))).toBe(1);

      await redisCacheService.invalidateAfterUpdate();
      expect(await testClient.exists(redisKey(keyAct))).toBe(0);
    });
  });
});
