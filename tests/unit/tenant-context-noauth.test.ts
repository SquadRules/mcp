// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { describe, expect, it } from '@jest/globals';
import { AUTH_ENABLED, KAIROS_APP_SPACE_ID } from '../../src/config.js';
import { getSpaceContext } from '../../src/utils/tenant-context.js';

describe('tenant-context no-auth defaults', () => {
  it('separates Personal and Squadrules app spaces in no-auth mode', async () => {
    if (AUTH_ENABLED) {
      return;
    }
    const ctx = getSpaceContext();
    expect(ctx.allowedSpaceIds).toContain(KAIROS_APP_SPACE_ID);
    expect(ctx.spaceNamesById?.[KAIROS_APP_SPACE_ID]).toBe('Squadrules app');
    expect(ctx.defaultWriteSpaceId).not.toBe(KAIROS_APP_SPACE_ID);
    expect(ctx.spaceNamesById?.[ctx.defaultWriteSpaceId]).toBe('Personal');
  });
});
