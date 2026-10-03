// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { getAuthHeaders, getTestAuthBaseUrl, isHttpTransport } from '../utils/auth-headers.js';

const BASE_URL = getTestAuthBaseUrl();
const API_BASE = `${BASE_URL}/api`;
const _d = isHttpTransport() ? describe : describe.skip;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRateLimitRetry(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url, {
      ...init,
      headers: { ...getAuthHeaders(), ...(init.headers as Record<string, string>) }
    });
    if (response.status !== 429 || attempt === attempts) {
      return response;
    }
    lastResponse = response;
    const retryAfterSeconds = Number(response.headers.get('Retry-After') ?? '1');
    await sleep(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 1000);
  }
  return lastResponse as Response;
}

_d('HTTP route error mapping', () => {
  test('POST /api/forward returns 404 for a non-existent layer uri', async () => {
    expect.hasAssertions();

    const response = await fetchWithRateLimitRetry(`${API_BASE}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'kairos://layer/00000000-0000-0000-0000-000000000099' })
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error', 'NOT_FOUND');
    expect(data).toHaveProperty('message', 'Layer or adapter not found');
  });

  test('POST /api/forward returns 404 for a non-existent adapter slug uri', async () => {
    expect.hasAssertions();

    const response = await fetchWithRateLimitRetry(`${API_BASE}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'kairos://adapter/non-existent-slug-for-test' })
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error', 'NOT_FOUND');
    expect(data).toHaveProperty('message', 'Layer or adapter not found');
  });

  test('POST /api/reward returns 404 for a non-existent layer uri', async () => {
    expect.hasAssertions();

    const response = await fetchWithRateLimitRetry(`${API_BASE}/reward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uri: 'kairos://layer/00000000-0000-0000-0000-000000000099',
        outcome: 'success',
        feedback: 'test'
      })
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error', 'MEMORY_NOT_FOUND');
    expect(String(data.message ?? '')).toMatch(/not found/i);
  });
});
