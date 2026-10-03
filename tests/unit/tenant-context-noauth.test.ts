import { describe, expect, it } from '@jest/globals';
import { AUTH_ENABLED, SQUADRULES_APP_SPACE_ID } from '../../src/config.js';
import { getSpaceContext } from '../../src/utils/tenant-context.js';

describe('tenant-context no-auth defaults', () => {
  it('separates Personal and Squadrules app spaces in no-auth mode', async () => {
    if (AUTH_ENABLED) {
      return;
    }
    const ctx = getSpaceContext();
    expect(ctx.allowedSpaceIds).toContain(SQUADRULES_APP_SPACE_ID);
    expect(ctx.spaceNamesById?.[SQUADRULES_APP_SPACE_ID]).toBe('Squadrules app');
    expect(ctx.defaultWriteSpaceId).not.toBe(SQUADRULES_APP_SPACE_ID);
    expect(ctx.spaceNamesById?.[ctx.defaultWriteSpaceId]).toBe('Personal');
  });
});
