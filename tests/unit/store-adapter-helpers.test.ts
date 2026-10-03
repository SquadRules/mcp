// squadrules-compat-surface: references the persisted app-space id space:kairos-app stored in existing Qdrant points
import { describe, expect, test, jest } from '@jest/globals';
import { handleDuplicateAdapter } from '../../src/services/memory/store-adapter-helpers.js';
import { runWithSpaceContextAsync } from '../../src/utils/tenant-context.js';

describe('handleDuplicateAdapter protected-space guard', () => {
  test('blocks force update when duplicate is in protected app space', async () => {
    const client = {
      scroll: jest.fn(async () => ({
        points: [{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          payload: { label: 'Built-in adapter', space_id: 'space:kairos-app' }
        }]
      })),
      delete: jest.fn(async () => ({}))
    };

    await expect(
      runWithSpaceContextAsync(
        {
          userId: 'u1',
          groupIds: [],
          allowedSpaceIds: ['space:personal', 'space:kairos-app'],
          defaultWriteSpaceId: 'space:personal',
          personalSpaceId: 'space:personal'
        },
        async () => handleDuplicateAdapter(client as any, 'kairos', 'adapter-uuid', true)
      )
    ).rejects.toMatchObject({ code: 'PROTECTED_SPACE_WRITE_FORBIDDEN' });
    expect(client.delete).not.toHaveBeenCalled();
  });

  test('allows force update for personal/group duplicates', async () => {
    const client = {
      scroll: jest.fn(async () => ({
        points: [{
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          payload: { label: 'Personal override', space_id: 'user:realm:uuid' }
        }]
      })),
      delete: jest.fn(async () => ({}))
    };

    await runWithSpaceContextAsync(
      {
        userId: 'u1',
        groupIds: [],
        allowedSpaceIds: ['user:realm:uuid', 'group:realm:group-uuid'],
        defaultWriteSpaceId: 'user:realm:uuid',
        personalSpaceId: 'user:realm:uuid'
      },
      async () => handleDuplicateAdapter(client as any, 'kairos', 'adapter-uuid', true)
    );

    expect(client.delete).toHaveBeenCalledTimes(1);
  });
});
