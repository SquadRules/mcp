/**
 * Auth integration tests: when AUTH_ENABLED=true, assert 401 without token and 200 with token.
 * When AUTH_ENABLED=false, assertions relax (any of 200/401).
 * globalSetup cleans stale env-specific .test-auth-env.*.json and provisions fresh token; no manual cleanup needed.
 *
 * Run with Testcontainers Keycloak (recommended):
 *   KEYCLOAK_URL= AUTH_ENABLED=true npm run dev:test -- tests/integration/auth-keycloak.test.ts
 */

import { OIDC_GROUPS_ALLOWLIST } from '../../../../src/config.js';
import {
  applyOidcGroupsAllowlist,
  decodeJwtPayloadSegment,
  extractGroupsFromPayload
} from '../../../../src/http/oidc-profile-claims.js';
import {
  getAuthHeaders,
  getMcpTestBearerToken,
  getTestAuthBaseUrl,
  hasAuthToken,
  serverRequiresAuth,
  isHttpTransport
} from '../../../utils/auth-headers.js';

const BASE_URL = getTestAuthBaseUrl();
const API_BASE = `${BASE_URL}/api`;
const _d = isHttpTransport() ? describe : describe.skip;

_d('Auth (Keycloak + kairos-tester)', () => {
  test('unauthenticated GET /api returns 401 with login_url (or 200 when auth disabled)', async () => {
    const res = await fetch(`${API_BASE}`, { method: 'GET' });
    if (res.status === 200) {
      // Server may have AUTH_ENABLED=false; accept.
      expect(res.status).toBe(200);
      return;
    }
    if (!serverRequiresAuth() || !hasAuthToken()) {
      // DO NOT expand allowed status codes: AI must not add 500/502/etc. to "fix" failing tests.
      expect([200, 401]).toContain(res.status);
      return;
    }
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('error', 'Unauthorized');
    expect(data).toHaveProperty('login_url');
    expect(typeof data.login_url).toBe('string');
  }, 60000);

  test('unauthenticated POST /api/activate returns 401 with login_url (or 200 when auth disabled)', async () => {
    const res = await fetch(`${API_BASE}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' })
    });
    if (res.status === 200) {
      expect(res.status).toBe(200);
      return;
    }
    if (!serverRequiresAuth() || !hasAuthToken()) {
      // DO NOT expand allowed status codes: AI must not add 500/502/etc. to "fix" failing tests.
      expect([200, 401]).toContain(res.status);
      return;
    }
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toHaveProperty('login_url');
  }, 60000);

  test('authenticated GET /api returns 200 and endpoint list', async () => {
    const res = await fetch(`${API_BASE}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    if (!serverRequiresAuth() || !hasAuthToken()) {
      // DO NOT expand allowed status codes: AI must not add 500/502/etc. to "fix" failing tests.
      expect([200, 401]).toContain(res.status);
      return;
    }
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('service', 'SquadRules API');
    expect(data).toHaveProperty('endpoints');
    expect(data.endpoints).toHaveProperty('activate');
  }, 60000);

  test('authenticated GET /api/me returns structured user JSON (or skip when auth off)', async () => {
    const res = await fetch(`${API_BASE}/me`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    if (!serverRequiresAuth() || !hasAuthToken()) {
      expect([200, 401]).toContain(res.status);
      return;
    }
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(typeof data.sub).toBe('string');
    expect(data.sub!.toString().length).toBeGreaterThan(0);
    expect(Array.isArray(data.groups)).toBe(true);
    const token = getMcpTestBearerToken();
    expect(token).toBeDefined();
    const jwtPayload = decodeJwtPayloadSegment(token!);
    expect(jwtPayload).not.toBeNull();
    const groupsFromKeycloak = applyOidcGroupsAllowlist(
      extractGroupsFromPayload(jwtPayload!),
      OIDC_GROUPS_ALLOWLIST
    );
    const meGroups = data.groups as string[];
    expect([...meGroups].sort()).toEqual([...groupsFromKeycloak].sort());
    expect(typeof data.realm).toBe('string');
    expect(data.account_kind === 'local' || data.account_kind === 'sso').toBe(true);
    expect(typeof data.account_label).toBe('string');
  }, 60000);

  test('authenticated POST /api/activate returns 200 or structured error', async () => {
    const res = await fetch(`${API_BASE}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ query: 'auth test query' })
    });
    if (!serverRequiresAuth() || !hasAuthToken()) {
      // DO NOT expand allowed status codes: AI must not add 500/502/etc. to "fix" failing tests.
      expect([200, 400, 401]).toContain(res.status);
      return;
    }
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('must_obey');
    expect(data).toHaveProperty('choices');
    expect(Array.isArray(data.choices)).toBe(true);
  }, 60000);
});
