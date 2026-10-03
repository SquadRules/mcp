/**
 * Verifies Qdrant memory CUD paths call invalidateAfterUpdate so activate:* Redis entries
 * (executeSearch / MCP activate) are cleared, not only search:* keys.
 *
 * Note: `jest.spyOn` cannot replace named exports on ESM module namespace objects (e.g. `sanitizeAndUpsert`
 * from `utils.js`); we assert cache invalidation via RedisCacheService only.
 */

jest.mock('../../src/services/metrics/qdrant-metrics.js', () => {
  const end = () => undefined;
  return {
    qdrantOperations: { inc: jest.fn() },
    qdrantOperationDuration: { startTimer: () => end },
    qdrantQueryDuration: { startTimer: () => end },
    qdrantUpsertDuration: { startTimer: () => end }
  };
});

jest.mock('../../src/services/embedding/service.js', () => ({
  embeddingService: {
    generateEmbedding: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3, 0.4] })
  }
}));

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { redisCacheService } from '../../src/services/redis-cache.js';
import { storeMemory } from '../../src/services/qdrant/memory-store.js';
import { runWithSpaceContextAsync } from '../../src/utils/tenant-context.js';
import { SQUADRULES_APP_SPACE_ID } from '../../src/config.js';

/** RFC 4122 shape (version nibble 4, variant nibble 8–b) — required by validateAndConvertId. */
const TEST_UUID = '12345678-1234-4123-8123-123456789abc';

function withDefaultSpace<T>(fn: () => Promise<T>): Promise<T> {
  return runWithSpaceContextAsync(
    {
      userId: 'test-user',
      groupIds: [],
      allowedSpaceIds: [SQUADRULES_APP_SPACE_ID],
      defaultWriteSpaceId: SQUADRULES_APP_SPACE_ID,
      personalSpaceId: ''
    },
    fn
  );
}

describe('memory CUD cache invalidation (activate + search)', () => {
  let invalidateAfterSpy: jest.SpiedFunction<typeof redisCacheService.invalidateAfterUpdate>;
  let invalidateMemorySpy: jest.SpiedFunction<typeof redisCacheService.invalidateMemoryCache>;

  beforeEach(() => {
    invalidateAfterSpy = jest.spyOn(redisCacheService, 'invalidateAfterUpdate').mockResolvedValue(undefined);
    invalidateMemorySpy = jest.spyOn(redisCacheService, 'invalidateMemoryCache').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockConn = {
    executeWithReconnect: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    client: {
      upsert: jest.fn().mockResolvedValue({ status: 'ok' }),
      delete: jest.fn().mockResolvedValue(undefined)
    },
    collectionName: 'squadrules-test-collection'
  } as const;

  test('storeMemory calls invalidateAfterUpdate after upsert', async () => {
    await withDefaultSpace(async () => {
      const embedding = new Array(4).fill(0.25);
      await storeMemory(mockConn as never, 'l', 't', 'general', 'task', 'context', [], embedding, undefined, TEST_UUID);

      expect(mockConn.client.upsert).toHaveBeenCalledTimes(1);
      expect(invalidateMemorySpy).toHaveBeenCalledWith(TEST_UUID);
      expect(invalidateAfterSpy).toHaveBeenCalledTimes(1);
    });
  });

});
