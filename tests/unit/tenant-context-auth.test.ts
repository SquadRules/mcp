// squadrules-compat-surface: references Keycloak realm/client or keyring service names (kairos-dev / kairos-prod / kairos-cli) provisioned in existing deployments
import { describe, expect, it } from '@jest/globals';
import { getSpaceContext } from '../../src/utils/tenant-context.js';

const UUID_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('tenant-context auth-derived spaces', () => {
  it('derives deterministic user/group space ids from iss + sub/group path', () => {
    const req = {
      auth: {
        sub: 'ae10bea2-12cd-41c2-834c-f06f6607e42e',
        realm: 'kairos-dev',
        iss: 'https://kc.example.dev/realms/kairos-dev',
        groups: ['/kairos-shares/kairos-operator', 'kairos-auditor']
      }
    };
    const a = getSpaceContext(req);
    const b = getSpaceContext(req);

    expect(a.defaultWriteSpaceId).toBe(b.defaultWriteSpaceId);
    expect(a.personalSpaceId).toBe(a.defaultWriteSpaceId);
    expect(a.allowedSpaceIds).toEqual(b.allowedSpaceIds);
    expect(a.allowedSpaceIds).toHaveLength(3);
    expect(a.defaultWriteSpaceId).toMatch(/^user:kairos-dev:/);
    expect(a.defaultWriteSpaceId.split(':').pop()).toMatch(UUID_V5_RE);
    const groupIds = a.allowedSpaceIds.filter((id) => id.startsWith('group:kairos-dev:'));
    expect(groupIds).toHaveLength(2);
    for (const gid of groupIds) {
      expect(gid.split(':').pop()).toMatch(UUID_V5_RE);
    }
    expect(a.spaceNamesById?.[groupIds[0]!]).toBe('/kairos-shares/kairos-operator');
    expect(a.spaceNamesById?.[groupIds[1]!]).toBe('/kairos-auditor');
  });

  it('changes derived space ids when issuer changes', () => {
    const base = {
      sub: 'ae10bea2-12cd-41c2-834c-f06f6607e42e',
      realm: 'kairos-dev',
      groups: ['/kairos-shares/kairos-operator']
    };
    const a = getSpaceContext({
      auth: {
        ...base,
        iss: 'https://kc-a.example/realms/kairos-dev'
      }
    });
    const b = getSpaceContext({
      auth: {
        ...base,
        iss: 'https://kc-b.example/realms/kairos-dev'
      }
    });

    expect(a.defaultWriteSpaceId).not.toBe(b.defaultWriteSpaceId);
    const aGroup = a.allowedSpaceIds.find((id) => id.startsWith('group:kairos-dev:'));
    const bGroup = b.allowedSpaceIds.find((id) => id.startsWith('group:kairos-dev:'));
    expect(aGroup).toBeDefined();
    expect(bGroup).toBeDefined();
    expect(aGroup).not.toBe(bGroup);
  });
});
