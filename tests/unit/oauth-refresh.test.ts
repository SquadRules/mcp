import { describe, expect, it, jest } from '@jest/globals';
import {
    fetchOAuthProtectedResourceMetadata,
    jwtExpiresInSeconds,
    refreshAccessToken,
} from '../../src/cli/oauth-refresh.js';

describe('oauth-refresh', () => {
    it('jwtExpiresInSeconds returns seconds until exp', () => {
        const exp = Math.floor(Date.now() / 1000) + 200;
        const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
        const tok = `hdr.${payload}.sig`;
        const left = jwtExpiresInSeconds(tok);
        expect(left).not.toBeNull();
        expect(left!).toBeGreaterThanOrEqual(199);
    });

    it('jwtExpiresInSeconds returns null for malformed token', () => {
        expect(jwtExpiresInSeconds('not-a-jwt')).toBeNull();
    });

    it('fetchOAuthProtectedResourceMetadata returns null for unsafe base URL', async () => {
        const fetchMock = jest.fn() as typeof fetch;
        const out = await fetchOAuthProtectedResourceMetadata('file:///x', fetchMock);
        expect(out).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetchOAuthProtectedResourceMetadata returns endpoints from well-known', async () => {
        const fetchMock = jest.fn(async (url: string | URL) => {
            const u = String(url);
            if (u.endsWith('/.well-known/oauth-protected-resource')) {
                return new Response(
                    JSON.stringify({
                        token_endpoint: 'http://keycloak/realms/x/protocol/openid-connect/token',
                        authorization_endpoint: 'http://keycloak/realms/x/protocol/openid-connect/auth',
                    }),
                    { status: 200 }
                );
            }
            return new Response('', { status: 404 });
        }) as typeof fetch;
        const out = await fetchOAuthProtectedResourceMetadata('http://localhost:3300', fetchMock);
        expect(out?.tokenEndpoint).toContain('/token');
        expect(out?.authEndpoint).toContain('/auth');
    });

    it('refreshAccessToken posts refresh_token grant and returns tokens', async () => {
        let call = 0;
        const fetchMock = jest.fn(async (url: string | URL, init?: RequestInit) => {
            call += 1;
            if (call === 1) {
                return new Response(
                    JSON.stringify({
                        authorization_endpoint: 'http://idp/realms/x/protocol/openid-connect/auth',
                        token_endpoint: 'http://idp/realms/x/protocol/openid-connect/token',
                    }),
                    { status: 200 }
                );
            }
            expect(String(url)).toContain('idp');
            expect(init?.method).toBe('POST');
            const rawBody = init?.body;
            const params =
                rawBody instanceof URLSearchParams
                    ? rawBody
                    : new URLSearchParams(typeof rawBody === 'string' ? rawBody : String(rawBody));
            expect(params.get('grant_type')).toBe('refresh_token');
            expect(params.get('refresh_token')).toBe('old-refresh');
            expect(params.get('client_id')).toBe('squadrules-cli');
            return new Response(
                JSON.stringify({ access_token: 'new-access', refresh_token: 'rotated-refresh' }),
                { status: 200 }
            );
        }) as typeof fetch;
        const out = await refreshAccessToken('http://localhost:3300', 'old-refresh', fetchMock);
        expect(out?.access_token).toBe('new-access');
        expect(out?.refresh_token).toBe('rotated-refresh');
    });

    it('refreshAccessToken returns null when token endpoint fails', async () => {
        const fetchMock = jest.fn(async (url: string | URL) => {
            if (String(url).includes('well-known')) {
                return new Response(
                    JSON.stringify({
                        authorization_endpoint: 'http://idp/auth',
                        token_endpoint: 'http://idp/token',
                    }),
                    { status: 200 }
                );
            }
            return new Response('no', { status: 400 });
        }) as typeof fetch;
        const out = await refreshAccessToken('http://localhost:3300', 'r', fetchMock);
        expect(out).toBeNull();
    });
});
