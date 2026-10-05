import { getAuthHeaders, getTestAuthBaseUrl, isHttpTransport } from '../utils/auth-headers.js';
import { MOCK_REVIEW_EVIDENCE } from '../utils/mock-review-evidence.js';
import { testQdrantBackend } from '../utils/vector-backend.js';

const BASE_URL = getTestAuthBaseUrl();
const API_BASE = `${BASE_URL}/api`;
const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION ?? 'squadrules';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY ?? '';
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

function qdrantHeaders(): Record<string, string> {
  return QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : {};
}

function postMcp(body: object): Promise<Response> {
  return fetchWithRateLimitRetry(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...getAuthHeaders()
    },
    body: JSON.stringify(body)
  });
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
  const trainRes = await fetchWithRateLimitRetry(`${API_BASE}/train/raw?force=true&review_evidence=${encodeURIComponent(JSON.stringify(MOCK_REVIEW_EVIDENCE))}`, {
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

_d('MCP forward slug error guidance', () => {
  testQdrantBackend('resolves ambiguous adapter slug via MCP and includes slug_disambiguation_note', async () => {
    expect.hasAssertions();

    const targetSlug = `forward-mcp-ambiguous-${Date.now()}`;
    const secondSlug = `${targetSlug}-second`;
    const firstPointId = await trainProtocol(`Forward MCP Ambiguous A ${Date.now()}`, targetSlug, 'Ambiguous MCP branch A.');
    const secondPointId = await trainProtocol(`Forward MCP Ambiguous B ${Date.now()}`, secondSlug, 'Ambiguous MCP branch B.');
    expect(secondPointId).not.toBe(firstPointId);
    await setPointSlug(secondPointId, targetSlug);

    const response = await postMcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'forward',
        arguments: { uri: `squadrules://adapter/${targetSlug}` }
      }
    });

    const body = await response.json() as {
      jsonrpc?: string;
      result?: {
        isError?: boolean;
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      };
      id?: number | null;
    };

    const text = body.result?.content?.[0]?.text;
    expect(typeof text).toBe('string');
    const payload = JSON.parse(text as string) as {
      must_obey?: boolean;
      slug_disambiguation_note?: string;
      current_layer?: { uri?: string };
      contract?: { type?: string };
    };

    expect(body.jsonrpc).toBe('2.0');
    expect(body.result?.isError).not.toBe(true);
    expect(payload.must_obey).toBe(true);
    expect(typeof payload.slug_disambiguation_note).toBe('string');
    expect(payload.slug_disambiguation_note).toMatch(new RegExp(targetSlug, 'i'));
    expect(payload.slug_disambiguation_note).toMatch(/squadrules:\/\/adapter\//i);
    expect(payload.current_layer?.uri).toMatch(/^squadrules:\/\/layer\//);
  }, 30000);
});
