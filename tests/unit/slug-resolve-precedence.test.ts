// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { describe, expect, test } from '@jest/globals';
import { KAIROS_APP_SPACE_ID } from '../../src/config.js';
import { findFirstStepMemoryUuidBySlug } from '../../src/services/qdrant/memory-retrieval.js';
import { runWithSpaceContextAsync } from '../../src/utils/tenant-context.js';

type ScrollPoint = {
  id: string;
  payload: {
    space_id?: string;
    adapter?: { id?: string; layer_index?: number };
  };
};

function makeConn(points: ScrollPoint[]) {
  return {
    executeWithReconnect: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    client: {
      scroll: async () => ({ points, next_page_offset: null })
    },
    collectionName: 'test'
  } as const;
}

describe('findFirstStepMemoryUuidBySlug precedence', () => {
  test('prefers personal over group and app/system regardless of default write space', async () => {
    const conn = makeConn([
      { id: '30000000-0000-4000-8000-000000000000', payload: { space_id: KAIROS_APP_SPACE_ID, adapter: { id: 'app-adapter' } } },
      { id: '20000000-0000-4000-8000-000000000000', payload: { space_id: 'group:realm:team', adapter: { id: 'group-adapter' } } },
      { id: '10000000-0000-4000-8000-000000000000', payload: { space_id: 'user:realm:user-1', adapter: { id: 'personal-adapter' } } }
    ]);

    const outcome = await runWithSpaceContextAsync(
      {
        userId: 'u',
        groupIds: [],
        allowedSpaceIds: ['user:realm:user-1', 'group:realm:team', KAIROS_APP_SPACE_ID],
        defaultWriteSpaceId: 'group:realm:team',
        personalSpaceId: 'user:realm:user-1'
      },
      () => findFirstStepMemoryUuidBySlug(conn as never, 'demo-slug')
    );

    expect(outcome.layerUuid).toBe('10000000-0000-4000-8000-000000000000');
  });

  test('prefers group over app when personal is absent', async () => {
    const conn = makeConn([
      { id: '30000000-0000-4000-8000-000000000000', payload: { space_id: KAIROS_APP_SPACE_ID, adapter: { id: 'app-adapter' } } },
      { id: '20000000-0000-4000-8000-000000000000', payload: { space_id: 'group:realm:team', adapter: { id: 'group-adapter' } } }
    ]);

    const outcome = await runWithSpaceContextAsync(
      {
        userId: 'u',
        groupIds: [],
        allowedSpaceIds: ['group:realm:team', KAIROS_APP_SPACE_ID],
        defaultWriteSpaceId: KAIROS_APP_SPACE_ID,
        personalSpaceId: ''
      },
      () => findFirstStepMemoryUuidBySlug(conn as never, 'demo-slug')
    );

    expect(outcome.layerUuid).toBe('20000000-0000-4000-8000-000000000000');
  });

  test('keeps provenance details in disambiguation note', async () => {
    const conn = makeConn([
      { id: '20000000-0000-4000-8000-000000000000', payload: { space_id: 'group:realm:team', adapter: { id: 'group-adapter' } } },
      { id: '10000000-0000-4000-8000-000000000000', payload: { space_id: 'user:realm:user-1', adapter: { id: 'personal-adapter' } } }
    ]);

    const outcome = await runWithSpaceContextAsync(
      {
        userId: 'u',
        groupIds: [],
        allowedSpaceIds: ['user:realm:user-1', 'group:realm:team'],
        defaultWriteSpaceId: 'group:realm:team',
        personalSpaceId: 'user:realm:user-1'
      },
      () => findFirstStepMemoryUuidBySlug(conn as never, 'demo-slug')
    );

    expect(outcome.disambiguation_note).toContain('personal > group > app/system');
    expect(outcome.disambiguation_note).toContain('Candidates: personal-adapter@user:realm:user-1, group-adapter@group:realm:team');
  });
});
