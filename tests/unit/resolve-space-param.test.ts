// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { describe, expect, it } from '@jest/globals';
import { KAIROS_APP_SPACE_ID } from '../../src/config.js';
import { resolveSpaceParamForContext } from '../../src/utils/resolve-space-param.js';
import type { SpaceContext } from '../../src/utils/tenant-context.js';

function ctx(partial: Partial<SpaceContext> & Pick<SpaceContext, 'allowedSpaceIds' | 'defaultWriteSpaceId'>): SpaceContext {
  const dw = partial.defaultWriteSpaceId;
  const personal =
    partial.personalSpaceId ??
    (dw.startsWith('user:') ? dw : partial.allowedSpaceIds.find((id) => id.startsWith('user:')) ?? '');
  return {
    userId: 'u',
    groupIds: [],
    allowedSpaceIds: partial.allowedSpaceIds,
    defaultWriteSpaceId: partial.defaultWriteSpaceId,
    personalSpaceId: personal,
    spaceNamesById: partial.spaceNamesById,
    requestId: partial.requestId
  };
}

describe('resolveSpaceParamForContext', () => {
  it('maps personal to JWT personal when default write is narrowed to a group', () => {
    const userId = 'user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a';
    const groupId = 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc';
    const c = ctx({
      allowedSpaceIds: [groupId],
      defaultWriteSpaceId: groupId,
      personalSpaceId: userId,
      spaceNamesById: { [groupId]: '/team' }
    });
    expect(resolveSpaceParamForContext(c, 'personal')).toEqual({ ok: true, spaceId: userId });
  });

  it('maps personal to default write space', () => {
    const c = ctx({
      allowedSpaceIds: ['user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a', 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc'],
      defaultWriteSpaceId: 'user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a',
      spaceNamesById: { 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc': '/team' }
    });
    expect(resolveSpaceParamForContext(c, 'personal')).toEqual({
      ok: true,
      spaceId: 'user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a'
    });
    expect(resolveSpaceParamForContext(c, 'Personal')).toEqual({
      ok: true,
      spaceId: 'user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a'
    });
  });

  it('resolves group by canonical full path', () => {
    const c = ctx({
      allowedSpaceIds: ['user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a', 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc'],
      defaultWriteSpaceId: 'user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a',
      spaceNamesById: { 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc': '/kairos-shares/kairos-operator' }
    });
    expect(resolveSpaceParamForContext(c, '/kairos-shares/kairos-operator')).toEqual({
      ok: true,
      spaceId: 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc'
    });
    expect(resolveSpaceParamForContext(c, 'Group: /kairos-shares/kairos-operator')).toEqual({
      ok: true,
      spaceId: 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc'
    });
  });

  it('accepts raw space id when allowed', () => {
    const c = ctx({
      allowedSpaceIds: ['user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a', 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc'],
      defaultWriteSpaceId: 'user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a',
      spaceNamesById: { 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc': '/team' }
    });
    expect(resolveSpaceParamForContext(c, 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc')).toEqual({
      ok: true,
      spaceId: 'group:r:7d75dbf1-07e1-5182-b95c-89e4ea7d89cc'
    });
  });

  it('rejects unknown group', () => {
    const c = ctx({
      allowedSpaceIds: ['user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a'],
      defaultWriteSpaceId: 'user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a'
    });
    const r = resolveSpaceParamForContext(c, 'nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SPACE_NOT_FOUND');
  });

  it('rejects Squadrules app as writable target by default', () => {
    const c = ctx({
      allowedSpaceIds: ['user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a'],
      defaultWriteSpaceId: 'user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a'
    });
    const r = resolveSpaceParamForContext(c, 'Squadrules app');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SPACE_READ_ONLY');
  });

  it('resolves Squadrules app for activate/search when flag is set', () => {
    const c = ctx({
      allowedSpaceIds: ['user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a'],
      defaultWriteSpaceId: 'user:r:6a4a7375-e6a6-5f7e-b972-f4fbf31a5e0a'
    });
    expect(resolveSpaceParamForContext(c, 'Squadrules app', { allowReadOnlyAppSearchScope: true })).toEqual({
      ok: true,
      spaceId: KAIROS_APP_SPACE_ID
    });
    expect(resolveSpaceParamForContext(c, KAIROS_APP_SPACE_ID, { allowReadOnlyAppSearchScope: true })).toEqual({
      ok: true,
      spaceId: KAIROS_APP_SPACE_ID
    });
  });
});
