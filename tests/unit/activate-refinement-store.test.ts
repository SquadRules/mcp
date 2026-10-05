import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import crypto from 'node:crypto';
import { SQUADRULES_APP_SPACE_ID } from '../../src/config.js';
import { activateRefinementStore } from '../../src/services/activate-refinement-store.js';
import { keyValueStore } from '../../src/services/key-value-store-factory.js';
import { runWithSpaceContext } from '../../src/utils/tenant-context.js';

function withDefaultSpace<T>(fn: () => Promise<T>): Promise<T> {
  return runWithSpaceContext(
    {
      userId: '',
      groupIds: [],
      allowedSpaceIds: [SQUADRULES_APP_SPACE_ID],
      defaultWriteSpaceId: SQUADRULES_APP_SPACE_ID,
      personalSpaceId: ''
    },
    fn
  );
}

describe('ActivateRefinementStore', () => {
  // The store writes through the shared key-value singleton. In the server that client is
  // connected during boot; a unit run has to connect it as well, otherwise every Redis command
  // hits a never-opened client, is swallowed by RedisService and the counters read back as 0.
  beforeAll(async () => {
    await keyValueStore.connect();
  });

  afterAll(async () => {
    await keyValueStore.disconnect();
  });

  test('increments and resets refine count for one execution_id', async () => {
    await withDefaultSpace(async () => {
      const executionId = crypto.randomUUID();
      expect(await activateRefinementStore.incrementRefineCount(executionId)).toBe(1);
      expect(await activateRefinementStore.incrementRefineCount(executionId)).toBe(2);
      expect(await activateRefinementStore.getRefineCount(executionId)).toBe(2);
      await activateRefinementStore.resetRefineCount(executionId);
      expect(await activateRefinementStore.getRefineCount(executionId)).toBe(0);
    });
  });
});

