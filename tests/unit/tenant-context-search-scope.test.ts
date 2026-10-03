import { describe, expect, it } from '@jest/globals';
import { SQUADRULES_APP_SPACE_ID } from '../../src/config.js';
import { getSearchSpaceIds, runWithSpaceContext } from '../../src/utils/tenant-context.js';
import type { SpaceContext } from '../../src/utils/tenant-context.js';

describe('getSearchSpaceIds', () => {
  it('returns only activateSpaceScope when set (no implicit app merge)', () => {
    const scoped: SpaceContext = {
      userId: 'u',
      groupIds: [],
      allowedSpaceIds: ['user:r:sub1'],
      defaultWriteSpaceId: 'user:r:sub1',
      personalSpaceId: 'user:r:sub1',
      activateSpaceScope: ['user:r:sub1']
    };
    runWithSpaceContext(scoped, () => {
      expect(getSearchSpaceIds()).toEqual(['user:r:sub1']);
    });
  });

  it('appends Squadrules app when scope is unset and app is not in allowed', () => {
    const full: SpaceContext = {
      userId: 'u',
      groupIds: [],
      allowedSpaceIds: ['user:r:sub1'],
      defaultWriteSpaceId: 'user:r:sub1',
      personalSpaceId: 'user:r:sub1'
    };
    runWithSpaceContext(full, () => {
      const ids = getSearchSpaceIds();
      expect(ids).toContain('user:r:sub1');
      expect(ids).toContain(SQUADRULES_APP_SPACE_ID);
    });
  });

  it('scoped app space returns only app id', () => {
    const appScoped: SpaceContext = {
      userId: 'u',
      groupIds: [],
      allowedSpaceIds: [SQUADRULES_APP_SPACE_ID],
      defaultWriteSpaceId: 'user:r:sub1',
      personalSpaceId: 'user:r:sub1',
      activateSpaceScope: [SQUADRULES_APP_SPACE_ID]
    };
    runWithSpaceContext(appScoped, () => {
      expect(getSearchSpaceIds()).toEqual([SQUADRULES_APP_SPACE_ID]);
    });
  });
});
