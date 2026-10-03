import { getAuthHeaders, getTestAuthBaseUrl, isHttpTransport } from '../../utils/auth-headers.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const BASE_URL = getTestAuthBaseUrl();
const API_BASE = `${BASE_URL}/api`;
const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION ?? 'squadrules';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY ?? '';
const _d = isHttpTransport() ? describe : describe.skip;

function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers as Record<string, string>) }
  });
}

function qdrantHeaders(): Record<string, string> {
  return QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : {};
}

function buildProtocolMarkdown(title: string, slug: string, body: string): string {
  return `---
slug: ${slug}
---

# ${title}

## Activation Patterns
When to run.

## Step 1
${body}

\`\`\`json
{"contract": {"type": "comment", "description": "Minimal"}}
\`\`\`

## Reward Signal
Done.`;
}

function layerIdFromUri(uri: string): string {
  const base = uri.split('?')[0] ?? uri;
  return base.split('/').pop() ?? '';
}

async function setPointSlug(pointId: string, slug: string): Promise<void> {
  const response = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/payload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...qdrantHeaders()
    },
    body: JSON.stringify({
      payload: { slug },
      points: [pointId]
    })
  });
  expect(response.ok).toBe(true);
}

async function trainProtocol(title: string, slug: string, body: string): Promise<string> {
  const trainRes = await apiFetch(`${API_BASE}/train/raw?force=true&review_evidence=${encodeURIComponent(JSON.stringify(MOCK_REVIEW_EVIDENCE))}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/markdown', 'X-LLM-Model-ID': 'test-model' },
    body: buildProtocolMarkdown(title, slug, body)
  });
  expect(trainRes.status).toBe(200);
  const data = await trainRes.json() as { items?: Array<{ uri?: string }> };
  const headUri = data.items?.[0]?.uri;
  expect(typeof headUri).toBe('string');
  return layerIdFromUri(headUri as string);
}

_d('HTTP forward slug entry', () => {
  test('starts execution for a trained adapter addressed by slug URI', async () => {
    expect.hasAssertions();

    const slug = `forward-http-slug-${Date.now()}`;
    await trainProtocol(`Forward HTTP Slug ${Date.now()}`, slug, 'Forward slug smoke test.');

    const response = await apiFetch(`${API_BASE}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: `squadrules://adapter/${slug}` })
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('must_obey', true);
    expect(data).toHaveProperty('current_layer');
    expect(data.current_layer.uri).toMatch(/^squadrules:\/\/layer\//);
    expect(data).toHaveProperty('contract');
    expect(data).toHaveProperty('next_action');
    expect(typeof data.next_action).toBe('string');
  }, 30000);

  test('returns 404 for a non-existent adapter slug URI', async () => {
    expect.hasAssertions();

    const response = await apiFetch(`${API_BASE}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'squadrules://adapter/non-existent-slug-for-test' })
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error', 'NOT_FOUND');
    expect(data).toHaveProperty('message', 'Layer or adapter not found');
  }, 30000);

  test('resolves ambiguous adapter slug deterministically and returns disambiguation note', async () => {
    expect.hasAssertions();

    const targetSlug = `forward-http-ambiguous-${Date.now()}`;
    const secondSlug = `${targetSlug}-second`;
    const firstPointId = await trainProtocol(`Forward HTTP Ambiguous A ${Date.now()}`, targetSlug, 'Ambiguous slug branch A.');
    const secondPointId = await trainProtocol(`Forward HTTP Ambiguous B ${Date.now()}`, secondSlug, 'Ambiguous slug branch B.');
    expect(secondPointId).not.toBe(firstPointId);
    await setPointSlug(secondPointId, targetSlug);

    const response = await apiFetch(`${API_BASE}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: `squadrules://adapter/${targetSlug}` })
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('must_obey', true);
    expect(data).toHaveProperty('current_layer');
    expect(data.current_layer.uri).toMatch(/^squadrules:\/\/layer\//);
    expect(data).toHaveProperty('contract');
    expect(typeof data.slug_disambiguation_note).toBe('string');
    expect(String(data.slug_disambiguation_note)).toMatch(new RegExp(targetSlug, 'i'));
    expect(String(data.slug_disambiguation_note)).toMatch(/squadrules:\/\/adapter\//i);
  }, 30000);
});
