// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { describe, expect, test } from '@jest/globals';
import crypto from 'node:crypto';
import { KAIROS_APP_SPACE_ID } from '../../src/config.js';
import { activateRefinementStore } from '../../src/services/activate-refinement-store.js';
import { runWithSpaceContext } from '../../src/utils/tenant-context.js';

function withDefaultSpace<T>(fn: () => Promise<T>): Promise<T> {
  return runWithSpaceContext(
    {
      userId: '',
      groupIds: [],
      allowedSpaceIds: [KAIROS_APP_SPACE_ID],
      defaultWriteSpaceId: KAIROS_APP_SPACE_ID,
      personalSpaceId: ''
    },
    fn
  );
}

describe('ActivateRefinementStore', () => {
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

