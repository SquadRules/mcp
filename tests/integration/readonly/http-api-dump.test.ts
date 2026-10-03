/**
 * Integration tests for POST /api/export.
 * Requires dev server; fails the suite if unavailable (no silent skip).
 */
import { getAuthHeaders, getTestAuthBaseUrl, isHttpTransport } from '../../utils/auth-headers.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const BASE_URL = getTestAuthBaseUrl();
const API_BASE = `${BASE_URL}/api`;
const _d = isHttpTransport() ? describe : describe.skip;

_d('POST /api/export', () => {
  test('requires uri and rejects empty', async () => {
    const response = await fetch(`${API_BASE}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({})
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty('error', 'INVALID_INPUT');
    expect(String(data.message ?? '')).toMatch(/uri/i);
  });

  test('returns 404 for non-existent memory UUID', async () => {
    const response = await fetch(`${API_BASE}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ uri: 'squadrules://layer/00000000-0000-0000-0000-000000000099' })
    });
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error', 'NOT_FOUND');
  });

  test('returns markdown content for valid URI (train then export)', async () => {
    const markdown = `# Dump HTTP ${Date.now()}

## Activation Patterns
When to run.

## Step 1
Content for HTTP export test.

\`\`\`json
{"contract": {"type": "comment", "description": "Minimal"}}
\`\`\`

## Reward Signal
Done.`;
    const trainRes = await fetch(`${API_BASE}/train/raw?force=true&review_evidence=${encodeURIComponent(JSON.stringify(MOCK_REVIEW_EVIDENCE))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown', 'X-LLM-Model-ID': 'test-model', ...getAuthHeaders() },
      body: markdown
    });
    expect(trainRes.status).toBe(200);
    const trainData = await trainRes.json();
    expect(trainData.items).toBeDefined();
    expect(trainData.items.length).toBeGreaterThanOrEqual(1);
    const uri = trainData.items[0].uri as string;

    const response = await fetch(`${API_BASE}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ uri, format: 'markdown' })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('content');
    expect(typeof data.content).toBe('string');
    expect(data.content.length).toBeGreaterThan(0);
    expect(data).toHaveProperty('uri', uri);
    expect(data).toHaveProperty('format', 'markdown');
    expect(data).toHaveProperty('content_type');
  }, 30000);

  test('returns full adapter markdown when URI resolves to adapter (browse case)', async () => {
    const title = `Export By Adapter ${Date.now()}`;
    const md = `# ${title}

## Activation Patterns
Browse adapter export.

## Step One
First step body.

\`\`\`json
{"contract": {"type": "comment", "description": "Step one"}}
\`\`\`

## Reward Signal
Done.`;
    const trainRes = await fetch(`${API_BASE}/train/raw?force=true&review_evidence=${encodeURIComponent(JSON.stringify(MOCK_REVIEW_EVIDENCE))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown', 'X-LLM-Model-ID': 'test-model', ...getAuthHeaders() },
      body: md
    });
    expect(trainRes.status).toBe(200);
    const trainData = await trainRes.json();
    const adapterUri = trainData.items?.[0]?.adapter_uri as string;
    expect(adapterUri).toMatch(/^squadrules:\/\/adapter\//);

    const response = await fetch(`${API_BASE}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ uri: adapterUri, format: 'markdown' })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('content');
    expect(typeof data.content).toBe('string');
    expect(data.content).toContain('First step body');
  }, 30000);
});
