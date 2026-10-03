import { afterAll, afterEach, describe, expect, jest, test } from '@jest/globals';
import { keyValueStore } from '../../src/services/key-value-store-factory.js';
import type { QdrantService } from '../../src/services/qdrant/service.js';
import { executionTraceStore } from '../../src/services/execution-trace-store.js';
import { executeReward } from '../../src/tools/reward.js';

describe('executeReward', () => {
  afterAll(async () => {
    await keyValueStore.disconnect();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('throws and skips execution trace reward persistence when reward metrics fail', async () => {
    const uri =
      'squadrules://layer/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?execution_id=11111111-1111-1111-1111-111111111111';
    const qdrantService = {
      retrieveById: jest.fn().mockRejectedValue(new Error('qdrant unavailable'))
    } as unknown as QdrantService;
    const setRewardSpy = jest
      .spyOn(executionTraceStore, 'setReward')
      .mockResolvedValue(undefined);

    await expect(
      executeReward(qdrantService, {
        uri,
        outcome: 'success',
        feedback: 'completed the workflow'
      })
    ).rejects.toThrow(`Failed to record reward for ${uri}`);

    expect(setRewardSpy).not.toHaveBeenCalled();
  });
});
