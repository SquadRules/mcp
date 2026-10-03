/**
 * Integration tests for OAuth 2.0 Protected Resource Metadata (RFC 9728).
 * Validates well-known endpoints and 401 WWW-Authenticate headers per the
 * MCP Authorization specification (2025-11-25).
 *
 * These tests run against the live dev server and do NOT require auth —
 * well-known discovery must be reachable without credentials.
 */

import { getTestAuthBaseUrl, serverRequiresAuth, isHttpTransport } from '../utils/auth-headers.js';
import { setupServerCheck } from './cli-commands-shared.js';

const BASE_URL = getTestAuthBaseUrl();
const _d = isHttpTransport() ? describe : describe.skip;

_d('Protected Resource Metadata (RFC 9728)', () => {
  let serverAvailable = false;

  beforeAll(async () => {
    serverAvailable = await setupServerCheck();
  }, 60000);

  describe('GET /.well-known/oauth-protected-resource (root)', () => {
    test('returns 200 with valid JSON structure', async () => {
      expect(serverAvailable).toBe(true);
      const res = await fetch(`${BASE_URL}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);

      const body = await res.json();
      expect(body).toHaveProperty('resource');
      expect(typeof body.resource).toBe('string');
      expect(body.resource).toMatch(/\/mcp$/);

      expect(body).toHaveProperty('authorization_servers');
      expect(Array.isArray(body.authorization_servers)).toBe(true);
      for (const entry of body.authorization_servers) {
        expect(typeof entry).toBe('string');
      }

      expect(body).toHaveProperty('scopes_supported');
      expect(Array.isArray(body.scopes_supported)).toBe(true);
      expect(body.scopes_supported).toContain('openid');

      expect(body).toHaveProperty('bearer_methods_supported');
      expect(body.bearer_methods_supported).toEqual(['header']);

      expect(body).toHaveProperty('resource_name');
      expect(typeof body.resource_name).toBe('string');

      // Required for MCP clients that build the auth URL themselves (e.g. Cursor with redirect_uri=cursor://).
      // If the client merges this into the auth request, Keycloak gets prompt=login and avoids already_logged_in.
      expect(body).toHaveProperty('authorization_request_parameters');
      expect(body.authorization_request_parameters).toEqual({ prompt: 'login' });

      // When auth is configured, endpoints are exposed so CLI can obtain login URL without 401.
      if (serverRequiresAuth()) {
        expect(body.authorization_servers?.length).toBeGreaterThan(0);
        expect(body).toHaveProperty('authorization_endpoint');
        expect(body).toHaveProperty('token_endpoint');
        expect(typeof body.authorization_endpoint).toBe('string');
        expect(typeof body.token_endpoint).toBe('string');
        expect(body.authorization_endpoint).toMatch(/\/protocol\/openid-connect\/auth$/);
        expect(body.token_endpoint).toMatch(/\/protocol\/openid-connect\/token$/);
        expect(body).toHaveProperty('squadrules_cli_client_id');
        expect(typeof body.squadrules_cli_client_id).toBe('string');
        expect(body.squadrules_cli_client_id).toBeTruthy();
      } else {
        expect(Array.isArray(body.authorization_servers)).toBe(true);
        expect(body.authorization_servers).toHaveLength(0);
        expect(body).not.toHaveProperty('authorization_endpoint');
        expect(body).not.toHaveProperty('token_endpoint');
        // The server may still expose a static CLI client id hint even when auth
        // is disabled; the hard requirement in simple mode is that it does not
        // advertise active authorization server endpoints.
        if (body.squadrules_cli_client_id !== undefined) {
          expect(typeof body.squadrules_cli_client_id).toBe('string');
          expect(body.squadrules_cli_client_id).toBeTruthy();
        }
      }
    });
  });

  describe('GET /.well-known/oauth-protected-resource/mcp (path-specific)', () => {
    test('returns 200 with same metadata as root', async () => {
      expect(serverAvailable).toBe(true);
      const [rootRes, pathRes] = await Promise.all([
        fetch(`${BASE_URL}/.well-known/oauth-protected-resource`),
        fetch(`${BASE_URL}/.well-known/oauth-protected-resource/mcp`)
      ]);
      expect(rootRes.status).toBe(200);
      expect(pathRes.status).toBe(200);

      const rootBody = await rootRes.json();
      const pathBody = await pathRes.json();
      expect(pathBody).toEqual(rootBody);
    });
  });

  // This endpoint proxies Keycloak's OpenID configuration. Whether it returns
  // 200 or 502 depends on whether an upstream auth server is reachable at
  // runtime — which may differ from the serverRequiresAuth() config flag
  // (e.g. CI SIMPLE mode still has Keycloak, local simple mode may not).
  // Skip content assertions; only verify the endpoint is reachable.
  describe('GET /.well-known/openid-configuration', () => {
    test('responds (200 with upstream or 502 without)', async () => {
      expect(serverAvailable).toBe(true);
      const res = await fetch(`${BASE_URL}/.well-known/openid-configuration`);
      expect([200, 502]).toContain(res.status);
      if (res.status === 200) {
        const json = await res.json();
        expect(json).toHaveProperty('registration_endpoint');
        // The server builds registration_endpoint from its internal config (e.g. port 3300),
        // which may differ from the test's BASE_URL (e.g. port 4300 in CI). Assert path only.
        expect(json.registration_endpoint).toMatch(/\/.well-known\/clients-registrations\/openid-connect$/);
      }
    });
  });

  const describeWhenAuthRequired = serverRequiresAuth() ? describe : describe.skip;
  describeWhenAuthRequired('MCP auth discovery behavior', () => {
    test('unauthenticated POST /mcp either advertises auth with 401 or allows anonymous discovery', async () => {
      const res = await fetch(`${BASE_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Match the MCP streamable HTTP content negotiation contract so auth is
          // evaluated before request format rejection.
          Accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1, params: {} })
      });

      if (res.status === 401) {
        const wwwAuth = res.headers.get('www-authenticate');
        expect(wwwAuth).toBeTruthy();
        expect(wwwAuth).toContain('Bearer');
        expect(wwwAuth).toMatch(/resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/);
        expect(wwwAuth).toMatch(/authorization_uri="[^"]+\/realms\/[^/]+\/\.well-known\/openid-configuration"/);
        expect(wwwAuth).toMatch(/scope="/);
        return;
      }

      expect(res.status).toBe(200);
      expect(res.headers.get('www-authenticate')).toBeNull();
      const body = await res.json();
      expect(body).toHaveProperty('result.tools');
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.length).toBeGreaterThan(0);
    });

    test('OPTIONS /mcp bypasses auth and returns CORS headers', async () => {
      expect(serverAvailable).toBe(true);
      const res = await fetch(`${BASE_URL}/mcp`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:6274',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type'
        }
      });

      expect(res.status).not.toBe(401);
      const allowMethods = res.headers.get('access-control-allow-methods');
      expect(allowMethods).toBeTruthy();
      expect(allowMethods).toContain('POST');
      const allowHeaders = res.headers.get('access-control-allow-headers');
      expect(allowHeaders).toBeTruthy();
      expect(allowHeaders!.toLowerCase()).toContain('mcp-protocol-version');
    });

    test('OPTIONS /.well-known/clients-registrations/openid-connect returns 204 for browser preflight', async () => {
      expect(serverAvailable).toBe(true);
      const res = await fetch(`${BASE_URL}/.well-known/clients-registrations/openid-connect`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:6274',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type'
        }
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:6274');
      const allowMethods = res.headers.get('access-control-allow-methods');
      expect(allowMethods).toBeTruthy();
      expect(allowMethods).toContain('POST');
    });

    test('OPTIONS /.well-known/oauth-authorization-server returns 204 for browser preflight', async () => {
      expect(serverAvailable).toBe(true);
      const res = await fetch(`${BASE_URL}/.well-known/oauth-authorization-server`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:6274',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'mcp-protocol-version'
        }
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:6274');
      const allowMethods = res.headers.get('access-control-allow-methods');
      expect(allowMethods).toBeTruthy();
      expect(allowMethods).toContain('GET');
    });

    test('OPTIONS /.well-known/openid-configuration returns 204 for browser preflight', async () => {
      expect(serverAvailable).toBe(true);
      const res = await fetch(`${BASE_URL}/.well-known/openid-configuration`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:6274',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'mcp-protocol-version'
        }
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:6274');
      const allowMethods = res.headers.get('access-control-allow-methods');
      expect(allowMethods).toBeTruthy();
      expect(allowMethods).toContain('GET');
    });

    test('WWW-Authenticate header contains authorization_uri matching Figma pattern', async () => {
      expect(serverAvailable).toBe(true);
      const res = await fetch(`${BASE_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } })
      });

      if (res.status === 401) {
        const wwwAuth = res.headers.get('www-authenticate');
        expect(wwwAuth).toBeTruthy();
        if (!wwwAuth) return;

        // Must include authorization_uri pointing to Keycloak OIDC config
        const authUriMatch = wwwAuth.match(/authorization_uri="([^"]+)"/);
        expect(authUriMatch).toBeTruthy();
        const authUri = authUriMatch![1];
        expect(authUri).toMatch(/\/realms\/[^/]+\/\.well-known\/openid-configuration$/);

        // Must include resource_metadata
        expect(wwwAuth).toMatch(/resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/);

        // Must include scope
        expect(wwwAuth).toMatch(/scope="[^"]*openid/);
      }
    });
  });
});
