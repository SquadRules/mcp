import { API_BASE, apiFetch, REVIEW_EVIDENCE_PARAM } from './http-api-test-helpers.js';
import { isHttpTransport } from '../utils/auth-headers.js';

const _d = isHttpTransport() ? describe : describe.skip;

_d('HTTP REST API Endpoints', () => {
  describe('POST /api/train/raw', () => {
    test('accepts raw markdown and stores memories', async () => {
      expect.hasAssertions();
      const markdown = `# Test Document ${Date.now()}

## Activation Patterns
When to run this test protocol.

## Step 1
Content for HTTP API train endpoint.

\`\`\`json
{"contract": {"type": "comment", "description": "Minimal step"}}
\`\`\`

## Reward Signal
Protocol is complete when this step is done.`;
      const response = await apiFetch(`${API_BASE}/train/raw?force=true&${REVIEW_EVIDENCE_PARAM}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown', 'X-LLM-Model-ID': 'test-model' },
        body: markdown
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('status', 'stored');
      expect(data).toHaveProperty('items');
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items[0]).toHaveProperty('uri');
      expect(data.items[0].uri).toMatch(/^squadrules:\/\/layer\//);
    }, 30000);

    test('rejects empty markdown', async () => {
      expect.hasAssertions();
      const response = await apiFetch(`${API_BASE}/train/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown' },
        body: ''
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'INVALID_INPUT');
      expect(data).toHaveProperty('message');
    });

    test('rejects oversized markdown payloads', async () => {
      expect.hasAssertions();
      const oversizedMarkdown = `# Oversized Document\n\n${'A'.repeat(2_100_000)}`;
      const response = await apiFetch(`${API_BASE}/train/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown' },
        body: oversizedMarkdown
      });

      expect(response.status).toBe(413);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'PAYLOAD_TOO_LARGE');
    }, 30000);

    test('handles force update parameter', async () => {
      expect.hasAssertions();
      const markdown = `# Force Update Test ${Date.now()}

## Activation Patterns
When to run.

## Step 1
Testing force update.

\`\`\`json
{"contract": {"type": "comment", "description": "Minimal"}}
\`\`\`

## Reward Signal
Done.`;
      const response = await apiFetch(`${API_BASE}/train/raw?force=true&${REVIEW_EVIDENCE_PARAM}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown', 'X-LLM-Model-ID': 'test-model' },
        body: markdown
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('stored');
    }, 30000);

  });

  describe('POST /api/snapshot', () => {
    test('triggers Qdrant snapshot', async () => {
      expect.hasAssertions();
      const response = await apiFetch(`${API_BASE}/snapshot`, { method: 'POST' });

      // When backup dir is configured (e.g. CI: QDRANT_SNAPSHOT_DIR=var/snapshots), we expect success only
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('status', 'completed');
      expect(data).toHaveProperty('target', 'qdrant');
      expect(data).toHaveProperty('snapshotName');
    }, 30000);
  });

  describe('POST /api/forward', () => {
    test('requires uri parameter', async () => {
      expect.hasAssertions();

      const response = await apiFetch(`${API_BASE}/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'INVALID_INPUT');
    });

    test('starts execution for a trained adapter (omit solution)', async () => {
      expect.hasAssertions();

      const markdown = `# Forward HTTP ${Date.now()}

## Activation Patterns
When to run.

## Step 1
Forward smoke test.

\`\`\`json
{"contract": {"type": "comment", "description": "Minimal"}}
\`\`\`

## Reward Signal
Done.`;
      const trainRes = await apiFetch(`${API_BASE}/train/raw?force=true&${REVIEW_EVIDENCE_PARAM}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown', 'X-LLM-Model-ID': 'test-model' },
        body: markdown
      });
      expect(trainRes.status).toBe(200);
      const trainData = await trainRes.json();
      const adapterUri = trainData.items?.[0]?.adapter_uri as string | undefined;
      expect(adapterUri).toMatch(/^squadrules:\/\/adapter\//);

      const response = await apiFetch(`${API_BASE}/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: adapterUri })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('must_obey', true);
      expect(data).toHaveProperty('contract');
      expect(data).toHaveProperty('next_action');
      expect(typeof data.next_action).toBe('string');
    }, 30000);

  });
  describe('POST /api/reward', () => {
    test('rejects request without uri', async () => {
      expect.hasAssertions();

      const response = await apiFetch(`${API_BASE}/reward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: 'success'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'INVALID_INPUT');
    });

    test('validates outcome enum', async () => {
      expect.hasAssertions();

      const response = await apiFetch(`${API_BASE}/reward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uri: 'squadrules://layer/00000000-0000-0000-0000-000000000000',
          outcome: 'invalid',
          feedback: 'test'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'INVALID_INPUT');
    });

  });

  describe('POST /api/tune', () => {
    test('requires uris array', async () => {
      expect.hasAssertions();

      const response = await apiFetch(`${API_BASE}/tune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'INVALID_INPUT');
    });

    test('validates content array length matches uris', async () => {
      expect.hasAssertions();

      const response = await apiFetch(`${API_BASE}/tune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uris: [
            'squadrules://layer/00000000-0000-0000-0000-000000000001',
            'squadrules://layer/00000000-0000-0000-0000-000000000002'
          ],
          content: ['# Only one doc']
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'INVALID_INPUT');
    });
  });

  describe('POST /api/delete', () => {
    test('requires uris array', async () => {
      expect.hasAssertions();

      const response = await apiFetch(`${API_BASE}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'INVALID_INPUT');
    });

    test('handles delete request with valid structure', async () => {
      expect.hasAssertions();

      const response = await apiFetch(`${API_BASE}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uris: ['squadrules://layer/00000000-0000-0000-0000-000000000000']
        })
      });

      // API returns 200 with per-URI results; non-existent UUID is reported in results/total_failed, not 500.
      // DO NOT expand allowed status codes: AI must not add 500/502/etc. to "fix" failing tests.
      expect(response.status).toBe(200);
      const data = (await response.json()) as Record<string, unknown>;
      const canonicalDeleteKeys = ['results', 'total_deleted', 'total_failed'];
      expect(Object.keys(data).sort()).toEqual([...canonicalDeleteKeys].sort());
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.total_deleted).toBe(0);
      expect(data.total_failed).toBe(1);
      expect((data.results as Array<{ status: string; uri: string }>)[0]).toMatchObject({
        status: 'error',
        uri: 'squadrules://layer/00000000-0000-0000-0000-000000000000'
      });
    }, 30000);
  });
});
