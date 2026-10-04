import { getAuthHeaders, getTestAuthBaseUrl, isHttpTransport } from '../../utils/auth-headers.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const BASE_URL = getTestAuthBaseUrl();
const API_BASE = `${BASE_URL}/api`;
const _d = isHttpTransport() ? describe : describe.skip;

function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers as Record<string, string>) }
  });
}

_d('POST /api/train (JSON)', () => {
  test('accepts JSON body with space and stores adapter', async () => {
    expect.hasAssertions();
    const markdown = `# JSON Train Test ${Date.now()}

## Activation Patterns
When to run.

## Step 1
JSON train endpoint.

\`\`\`json
{"contract": {"type": "comment", "description": "Minimal"}}
\`\`\`

## Reward Signal
Done.`;
    const response = await apiFetch(`${API_BASE}/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: markdown,
        llm_model_id: 'test-model',
        force_update: true,
        space: 'personal',
        review_evidence: MOCK_REVIEW_EVIDENCE
      })
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('status', 'stored');
    expect(data.items?.[0]?.adapter_uri).toMatch(/^squadrules:\/\/adapter\//);
  }, 30000);
});
