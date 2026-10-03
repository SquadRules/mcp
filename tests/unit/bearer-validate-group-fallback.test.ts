// squadrules-compat-surface: references Keycloak realm/client or keyring service names (kairos-dev / kairos-prod / kairos-cli) provisioned in existing deployments
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { createHash } from 'node:crypto';

const payloadByToken = new Map<string, Record<string, unknown>>();

function tokenFor(payload: Record<string, unknown>): string {
  const key = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const token = `token-${key}`;
  payloadByToken.set(token, payload);
  return token;
}

jest.unstable_mockModule('jose/jwt/decode', () => ({
  decodeJwt: (token: string) => payloadByToken.get(token) ?? {}
}));

jest.unstable_mockModule('jose', () => ({
  createRemoteJWKSet: () => async () => ({}) as never,
  jwtVerify: async (token: string) => ({ payload: payloadByToken.get(token) ?? {} })
}));

jest.unstable_mockModule('../../src/http/oidc-profile-claims.js', () => ({
  applyOidcGroupsAllowlist: (groups: string[]) => groups,
  enrichAuthPayloadFromVerifiedJwt: () => ({ account_kind: 'local', account_label: 'Local' }),
  extractGroupsFromPayload: (payload: Record<string, unknown>) =>
    Array.isArray(payload.groups) ? payload.groups.filter((x): x is string => typeof x === 'string') : [],
  realmFromIssuer: (iss: string) => {
    const match = /\/realms\/([^/]+)/.exec(iss);
    return match?.[1] ?? 'default';
  }
}));

describe('validateBearerToken group extraction', () => {
  let validateBearerToken: typeof import('../../src/http/bearer-validate.js').validateBearerToken;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    ({ validateBearerToken } = await import('../../src/http/bearer-validate.js'));
  });

  afterEach(() => {
    payloadByToken.clear();
    globalThis.fetch = originalFetch;
  });

  test('uses id_token groups when access token has no groups', async () => {
    const issuer = 'https://kc.example/realms/kairos-dev';
    const token = tokenFor({
      iss: issuer,
      sub: 'user-1',
      aud: ['kairos-mcp'],
      id_token: tokenFor({
        groups: ['/SHARED/PE-TEAM']
      })
    });

    const auth = await validateBearerToken(token, [issuer], ['kairos-mcp']);
    expect(auth).not.toBeNull();
    expect(auth?.groups).toEqual(['/SHARED/PE-TEAM']);
  });

  test('uses OIDC userinfo when access token has no groups and no nested id_token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sub: 'user-1', groups: ['/SHARED/PE-TEAM'] })
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const issuer = 'https://kc.example/realms/kairos-dev';
    const token = tokenFor({
      iss: issuer,
      sub: 'user-1',
      aud: ['kairos-mcp']
    });

    const auth = await validateBearerToken(token, [issuer], ['kairos-mcp']);
    expect(fetchMock).toHaveBeenCalled();
    const callUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain('/protocol/openid-connect/userinfo');
    expect(auth).not.toBeNull();
    expect(auth?.groups).toEqual(['/SHARED/PE-TEAM']);
  });

  test('returns empty groups when DCR token has no groups and userinfo also lacks groups mapper', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sub: 'user-1',
        email_verified: true,
        name: 'Test User',
        preferred_username: 'test@example.com',
        email: 'test@example.com'
      })
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const issuer = 'https://kc.example/realms/kairos';
    const token = tokenFor({
      iss: issuer,
      sub: 'user-1',
      aud: ['account'],
      azp: '01361763-d756-4c79-a124-0180e58e3f8e',
      scope: 'openid email profile'
    });

    const auth = await validateBearerToken(token, [issuer], ['kairos-mcp', 'kairos-cli', 'account']);
    expect(fetchMock).toHaveBeenCalled();
    expect(auth).not.toBeNull();
    expect(auth?.groups).toEqual([]);
  });
});
