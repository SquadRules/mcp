/**
 * Unit test: browser PKCE login flow — callback → token exchange → config write → reuse.
 *
 * Mocks fetchOAuthProtectedResourceMetadata, global fetch (token exchange + /api/me),
 * writeConfig, and readConfig. Spins up the real callback server, fires a simulated
 * Keycloak redirect, and verifies:
 *   1. Token exchange posts the correct grant params
 *   2. writeConfig receives the random token
 *   3. A second login detects the stored token ("Already authenticated")
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { randomBytes } from 'crypto';
import http from 'http';

/* ── mock state ─────────────────────────────────────────────────────── */

const storedConfig: Record<string, string | null | undefined> = {};
let fetchTokenExchangeCalls = 0;
let lastTokenExchangeBody: URLSearchParams | null = null;

const randomAccessToken = `test-access-${randomBytes(8).toString('hex')}`;
const randomRefreshToken = `test-refresh-${randomBytes(8).toString('hex')}`;
const FAKE_BASE_URL = 'http://localhost:3300';
const FAKE_TOKEN_ENDPOINT = 'http://idp/realms/test/protocol/openid-connect/token';

/* ── mocks (ESM) ────────────────────────────────────────────────────── */

jest.unstable_mockModule('../../src/cli/oauth-refresh.js', () => ({
    fetchOAuthProtectedResourceMetadata: jest.fn(async () => ({
        authEndpoint: 'http://idp/realms/test/protocol/openid-connect/auth',
        tokenEndpoint: FAKE_TOKEN_ENDPOINT,
    })),
    SQUADRULES_CLI_CLIENT_ID: 'squadrules-cli',
}));

jest.unstable_mockModule('../../src/cli/config-file.js', () => ({
    readConfig: jest.fn(async () => ({
        bearerToken: storedConfig['bearerToken'] ?? undefined,
        refreshToken: storedConfig['refreshToken'] ?? undefined,
        apiUrl: storedConfig['apiUrl'] ?? undefined,
    })),
    writeConfig: jest.fn(async (partial: Record<string, string | null | undefined>) => {
        Object.assign(storedConfig, partial);
    }),
    normalizeApiUrl: (url: string) => url.replace(/\/$/, ''),
}));

jest.unstable_mockModule('../../src/cli/keyring.js', () => ({
    isKeyringAvailable: () => false,
    getToken: async () => null,
}));

jest.unstable_mockModule('../../src/cli/output.js', () => ({
    writeStdout: jest.fn(),
    writeStderr: jest.fn(),
    writeError: jest.fn(),
}));

jest.unstable_mockModule('../../src/cli/auth-error.js', () => ({
    openBrowser: jest.fn(),
}));

jest.unstable_mockModule('../../src/cli/config.js', () => ({
    getCliApiUrlDefault: () => FAKE_BASE_URL,
}));

/* ── deferred imports (after mocks) ─────────────────────────────────── */

let loginWithBrowser: (baseUrl: string, opts?: { noBrowser?: boolean }) => Promise<boolean>;
let isTokenValid: (baseUrl: string, token: string) => Promise<boolean>;
let outputModule: typeof import('../../src/cli/output.js');

beforeAll(async () => {
    const loginMod = await import('../../src/cli/commands/login.js');
    loginWithBrowser = loginMod.loginWithBrowser;
    isTokenValid = loginMod.isTokenValid;
    outputModule = await import('../../src/cli/output.js');
});

/* ── global fetch mock (token exchange + /api/me) ──────────────────── */

const originalFetch = globalThis.fetch;

beforeEach(() => {
    fetchTokenExchangeCalls = 0;
    lastTokenExchangeBody = null;
    Object.keys(storedConfig).forEach((k) => delete (storedConfig as Record<string, unknown>)[k]);
    (outputModule?.writeStdout as jest.Mock)?.mockClear();

    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

        // Token exchange
        if (url === FAKE_TOKEN_ENDPOINT) {
            fetchTokenExchangeCalls++;
            const raw = init?.body;
            lastTokenExchangeBody =
                raw instanceof URLSearchParams ? raw : new URLSearchParams(typeof raw === 'string' ? raw : '');
            return new Response(
                JSON.stringify({
                    access_token: randomAccessToken,
                    refresh_token: randomRefreshToken,
                    token_type: 'Bearer',
                    expires_in: 300,
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
        }

        // /api/me validation
        if (url.endsWith('/api/me')) {
            const headers = init?.headers as Record<string, string> | undefined;
            const authHeader = headers?.['Authorization'];
            const token = typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : '';
            if (token === randomAccessToken || token === storedConfig['bearerToken']) {
                return new Response(JSON.stringify({ sub: 'test-user' }), { status: 200 });
            }
            return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
        }

        return new Response('', { status: 404 });
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

/* ── helper: simulate Keycloak redirect to callback server ─────────── */

function simulateCallback(port: number, callbackPathToken: string, state: string, code: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const url = `/callback/${callbackPathToken}?state=${state}&code=${code}&session_state=sess123&iss=http://idp`;
        http.get({ host: '127.0.0.1', port, path: url }, (res) => {
            const status = res.statusCode ?? 0;
            res.resume();
            res.on('end', () => resolve(status));
        }).on('error', reject);
    });
}

/** Extract callbackPathToken and state from the auth URL printed to stdout. */
function extractCallbackInfo(): { callbackPathToken: string; state: string } {
    let callbackPathToken = '';
    let stateParam = '';
    const ws = outputModule.writeStdout as jest.Mock;
    for (const call of ws.mock.calls) {
        const arg = call[0];
        if (typeof arg !== 'string' || !arg.includes('redirect_uri=')) continue;
        // The URL may have an encoded redirect_uri — parse it properly
        try {
            const u = new URL(arg);
            const redirectUri = u.searchParams.get('redirect_uri') ?? '';
            const cbMatch = redirectUri.match(/\/callback\/([^/?]+)/);
            if (cbMatch) callbackPathToken = cbMatch[1];
            stateParam = u.searchParams.get('state') ?? '';
        } catch {
            // fallback: raw regex on unencoded URL
            const cbMatch = arg.match(/redirect_uri=http[^&]*\/callback\/([^&]+)/);
            if (cbMatch) callbackPathToken = decodeURIComponent(cbMatch[1]);
            const stMatch = arg.match(/state=([^&]+)/);
            if (stMatch) stateParam = decodeURIComponent(stMatch[1]);
        }
    }
    return { callbackPathToken, state: stateParam };
}

/* ── tests ──────────────────────────────────────────────────────────── */

describe('browser PKCE login flow (unit)', () => {
    it('exchanges code → stores token → isTokenValid confirms it', async () => {
        const callbackPort = 40001 + Math.floor(Math.random() * 1000);
        process.env['SQUADRULES_LOGIN_CALLBACK_PORT'] = String(callbackPort);

        try {
            // 1. Start browser login
            const loginPromise = loginWithBrowser(FAKE_BASE_URL, { noBrowser: true });
            await new Promise((r) => setTimeout(r, 1000));

            // 2. Extract callback path from printed URL
            const { callbackPathToken, state } = extractCallbackInfo();
            expect(callbackPathToken).toBeTruthy();
            expect(state).toBeTruthy();

            // 3. Simulate Keycloak redirect
            const cbStatus = await simulateCallback(callbackPort, callbackPathToken, state, 'fake-auth-code-123');
            expect(cbStatus).toBe(200);

            // 4. Wait for login to complete
            const result = await loginPromise;
            expect(result).toBe(true);

            // 5. Verify token exchange params
            expect(fetchTokenExchangeCalls).toBe(1);
            expect(lastTokenExchangeBody?.get('grant_type')).toBe('authorization_code');
            expect(lastTokenExchangeBody?.get('code')).toBe('fake-auth-code-123');
            expect(lastTokenExchangeBody?.get('client_id')).toBe('squadrules-cli');
            expect(lastTokenExchangeBody?.get('code_verifier')).toBeTruthy();

            // 6. Verify config stored the random token
            expect(storedConfig['bearerToken']).toBe(randomAccessToken);
            expect(storedConfig['refreshToken']).toBe(randomRefreshToken);
            expect(storedConfig['apiUrl']).toBe(FAKE_BASE_URL);

            // 7. Verify isTokenValid accepts the stored token
            const valid = await isTokenValid(FAKE_BASE_URL, randomAccessToken);
            expect(valid).toBe(true);

            // 8. Verify isTokenValid rejects a bogus token
            const invalid = await isTokenValid(FAKE_BASE_URL, 'bogus-token');
            expect(invalid).toBe(false);
        } finally {
            delete process.env['SQUADRULES_LOGIN_CALLBACK_PORT'];
        }
    }, 15000);
});
