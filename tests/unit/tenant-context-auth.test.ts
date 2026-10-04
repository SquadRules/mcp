import { describe, expect, it } from '@jest/globals';
import { getSpaceContext } from '../../src/utils/tenant-context.js';

const UUID_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('tenant-context auth-derived spaces', () => {
  it('derives deterministic user/group space ids from iss + sub/group path', () => {
    const req = {
      auth: {
        sub: 'ae10bea2-12cd-41c2-834c-f06f6607e42e',
        realm: 'squadrules-dev',
        iss: 'https://kc.example.dev/realms/squadrules-dev',
        groups: ['/squadrules-shares/squadrules-operator', 'squadrules-auditor']
      }
    };
    const a = getSpaceContext(req);
    const b = getSpaceContext(req);

    expect(a.defaultWriteSpaceId).toBe(b.defaultWriteSpaceId);
    expect(a.personalSpaceId).toBe(a.defaultWriteSpaceId);
    expect(a.allowedSpaceIds).toEqual(b.allowedSpaceIds);
    expect(a.allowedSpaceIds).toHaveLength(3);
    expect(a.defaultWriteSpaceId).toMatch(/^user:squadrules-dev:/);
    expect(a.defaultWriteSpaceId.split(':').pop()).toMatch(UUID_V5_RE);
    const groupIds = a.allowedSpaceIds.filter((id) => id.startsWith('group:squadrules-dev:'));
    expect(groupIds).toHaveLength(2);
    for (const gid of groupIds) {
      expect(gid.split(':').pop()).toMatch(UUID_V5_RE);
    }
    expect(a.spaceNamesById?.[groupIds[0]!]).toBe('/squadrules-shares/squadrules-operator');
    expect(a.spaceNamesById?.[groupIds[1]!]).toBe('/squadrules-auditor');
  });

  it('changes derived space ids when issuer changes', () => {
    const base = {
      sub: 'ae10bea2-12cd-41c2-834c-f06f6607e42e',
      realm: 'squadrules-dev',
      groups: ['/squadrules-shares/squadrules-operator']
    };
    const a = getSpaceContext({
      auth: {
        ...base,
        iss: 'https://kc-a.example/realms/squadrules-dev'
      }
    });
    const b = getSpaceContext({
      auth: {
        ...base,
        iss: 'https://kc-b.example/realms/squadrules-dev'
      }
    });

    expect(a.defaultWriteSpaceId).not.toBe(b.defaultWriteSpaceId);
    const aGroup = a.allowedSpaceIds.find((id) => id.startsWith('group:squadrules-dev:'));
    const bGroup = b.allowedSpaceIds.find((id) => id.startsWith('group:squadrules-dev:'));
    expect(aGroup).toBeDefined();
    expect(bGroup).toBeDefined();
    expect(aGroup).not.toBe(bGroup);
  });
});
