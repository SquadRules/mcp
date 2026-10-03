import { getAuthHeaders, getTestAuthBaseUrl, hasAuthToken, serverRequiresAuth, isHttpTransport } from '../../utils/auth-headers.js';

const BASE_URL = getTestAuthBaseUrl();
const API_BASE = `${BASE_URL}/api`;
const _d = isHttpTransport() ? describe : describe.skip;

function apiFetch(url: string, init: RequestInit = {}, headers: Record<string, string> = getAuthHeaders()): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) }
  });
}

function expectNoServerCrash(response: Response): void {
  expect(response.status).not.toBe(500);
  expect(response.status).not.toBe(502);
}

_d('Adversarial and robustness inputs', () => {
  test('rejects oversized JSON body (>1MB)', async () => {
    expect.hasAssertions();
    const response = await apiFetch(`${API_BASE}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'x'.repeat(1_150_000) })
    });

    expect(response.status).toBe(413);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('PAYLOAD_TOO_LARGE');
  }, 30000);

  test('handles oversized embedding input attempts (>8K chars) safely', async () => {
    expect.hasAssertions();
    const response = await apiFetch(`${API_BASE}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'z'.repeat(9_000) })
    });

    expectNoServerCrash(response);
    expect([200, 400, 413]).toContain(response.status);
  }, 30000);

  test('handles prototype pollution keys without crashing', async () => {
    expect.hasAssertions();
    const response = await apiFetch(`${API_BASE}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'security regression probe',
        __proto__: { polluted: true },
        constructor: { prototype: { polluted: true } }
      })
    });

    expectNoServerCrash(response);
    expect([200, 400]).toContain(response.status);
  }, 30000);

  test('handles regex DoS style payloads without latency-related crash', async () => {
    expect.hasAssertions();
    const evilRegexPayload = '(a+)+$'.repeat(1500);
    const response = await apiFetch(`${API_BASE}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: evilRegexPayload })
    });

    expectNoServerCrash(response);
    expect([200, 400, 413]).toContain(response.status);
  }, 30000);

  test('cross-tenant UUID probing does not return protocol content', async () => {
    expect.hasAssertions();
    const probeUuid = '00000000-0000-0000-0000-000000000000';
    const response = await apiFetch(`${API_BASE}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uri: `squadrules://layer/${probeUuid}`,
        format: 'markdown'
      })
    });

    expectNoServerCrash(response);
    expect([200, 403, 404]).toContain(response.status);
    const body = await response.json() as Record<string, unknown>;
    if (response.status !== 200) {
      expect(body.error).toBeDefined();
      return;
    }
    // V2 style 200 payload still must not include leaked memory content for unknown UUIDs.
    expect(body).not.toHaveProperty('text');
    expect(body).not.toHaveProperty('description_full');
  }, 30000);

  test('handles null bytes and unicode edge cases in train body', async () => {
    expect.hasAssertions();
    const uniqueTitle = `Adversarial Unicode ${Date.now()}`;
    const markdown = [
      `# ${uniqueTitle}`,
      '',
      '## Activation Patterns',
      'Run when input contains emoji and null-byte probes.',
      '',
      '## Step 1',
      'Payload includes null-byte \\u0000 and unicode 🧪 𝄞 測試 for parser robustness.',
      '',
      '```json',
      '{"contract":{"type":"comment","description":"Edge-case content accepted safely"}}',
      '```',
      '',
      '## Reward Signal',
      'Done.'
    ].join('\n');

    const response = await apiFetch(`${API_BASE}/train/raw?force=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body: markdown
    });

    expectNoServerCrash(response);
    expect([200, 400]).toContain(response.status);
  }, 30000);

  test('rejects invalid or malformed bearer tokens', async () => {
    expect.hasAssertions();
    const response = await apiFetch(`${API_BASE}`, {
      method: 'GET'
    }, {
      Authorization: 'Bearer malformed.not-a-jwt',
      'Content-Type': 'application/json'
    });

    if (!serverRequiresAuth() || !hasAuthToken()) {
      expect([200, 401]).toContain(response.status);
      return;
    }
    expect(response.status).toBe(401);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  }, 30000);

  test('handles SQL and NoSQL injection patterns safely', async () => {
    expect.hasAssertions();
    const injectionProbe = `' OR 1=1 -- {"$ne":null} {"$where":"return true"} UNION SELECT * FROM users`;
    const response = await apiFetch(`${API_BASE}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: injectionProbe })
    });

    expectNoServerCrash(response);
    expect([200, 400]).toContain(response.status);
  }, 30000);
});
