import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson } from '../../utils/expect-with-raw.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';
import { describeQdrantBackend } from '../../utils/vector-backend.js';

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION ?? 'squadrules';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY ?? '';

function postJson<T>(urlString: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (QDRANT_API_KEY) headers['api-key'] = QDRANT_API_KEY;

    const req = requestImpl(url, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : ({} as T));
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error(`Qdrant request failed (${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

describeQdrantBackend('Train artifact storage and source export', () => {
  let mcpConnection: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  }, 30000);

  afterAll(async () => {
    if (mcpConnection) await mcpConnection.close();
  });

  test('stores artifact outside activate search and exports via source format', async () => {
    const ts = Date.now().toString();
    const adapterSlug = `artifact-parent-${ts}`;
    const artifactName = `artifact-${ts}.py`;
    const artifactSlug = `artifact-${ts}-py`;
    const artifactBody = `#!/usr/bin/env python3
# squadrules-artifact:
#   slug: ${artifactSlug}
#   version: 1

print("artifact-${ts}")`;

    const adapterMarkdown = `---
slug: ${adapterSlug}
---

# Artifact Parent ${ts}

## Activation Patterns
Run when user asks for artifact test.

## Step 1
Parent step.

\`\`\`json
{"contract":{"type":"comment","description":"parent"}}
\`\`\`

## Reward Signal
Done.`;

    const trainAdapter = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: adapterMarkdown,
        llm_model_id: 'test-model',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const adapterParsed = parseMcpJson(trainAdapter, 'train adapter');
    expect(adapterParsed.status).toBe('stored');
    const adapterUri = adapterParsed.items?.[0]?.adapter_uri as string;
    expect(adapterUri).toMatch(/^squadrules:\/\/adapter\//);

    const trainArtifact = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: artifactBody,
        llm_model_id: 'test-model',
        mime: 'text/x-python',
        artifact_name: artifactName,
        adapter_uri: `squadrules://adapter/${adapterSlug}`
      }
    });
    const artifactParsed = parseMcpJson(trainArtifact, 'train artifact');
    expect(artifactParsed.status).toBe('stored');
    const artifactUri = artifactParsed.items?.[0]?.uri as string;
    const artifactUuid = artifactParsed.items?.[0]?.artifact_uuid as string;
    expect(artifactUuid).toMatch(/^[0-9a-f-]{36}$/i);
    expect(artifactUri).toBe(`squadrules://artifact/${artifactSlug}`);
    expect(artifactParsed.items?.[0]?.content_type).toBe('text/x-python');

    const qdrantPoint = await postJson<{
      result?: { points?: Array<{ vector?: Record<string, number[]>; payload?: Record<string, unknown> }> };
    }>(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/scroll`, {
      filter: {
        must: [{ key: 'content_type', match: { value: 'text/x-python' } }, { key: 'label', match: { value: artifactName } }]
      },
      limit: 5,
      with_vector: true
    });
    const point = qdrantPoint.result?.points?.[0];
    expect(point).toBeDefined();
    expect(point?.payload?.['content_type']).toBe('text/x-python');
    const artifactPayload = point?.payload?.['artifact'] as Record<string, unknown> | undefined;
    expect(artifactPayload?.['slug']).toBe(artifactSlug);
    expect(artifactPayload?.['version']).toBe('1');
    expect(typeof artifactPayload?.['sha256']).toBe('string');
    const vectors = point?.vector ?? {};
    const denseZeroArrays = Object.values(vectors).filter((v): v is number[] => Array.isArray(v));
    expect(denseZeroArrays.length).toBeGreaterThan(0);
    expect(denseZeroArrays.every((arr) => arr.every((v) => v === 0))).toBe(true);

    const activate = await mcpConnection.client.callTool({
      name: 'activate',
      arguments: { query: artifactName }
    });
    const activateParsed = parseMcpJson(activate, 'activate artifact');
    const labels = Array.isArray(activateParsed.choices)
      ? activateParsed.choices.map((c: any) => String(c?.label ?? ''))
      : [];
    expect(labels.some((l: string) => l.includes(artifactName))).toBe(false);

    const activateParent = await mcpConnection.client.callTool({
      name: 'activate',
      arguments: { query: `Artifact Parent ${ts}` }
    });
    const activateParentParsed = parseMcpJson(activateParent, 'activate parent artifact');
    const parentMatch = Array.isArray(activateParentParsed.choices)
      ? activateParentParsed.choices.find(
          (choice: any) => choice?.role === 'match' && String(choice?.adapter_name ?? '') === `Artifact Parent ${ts}`
        )
      : null;
    expect(parentMatch).toBeDefined();
    expect(Array.isArray(parentMatch?.linked_artifacts)).toBe(true);
    const linked = parentMatch?.linked_artifacts?.[0];
    expect(linked?.filename).toBe(artifactName);
    expect(String(linked?.download_url ?? '')).toContain('/export/artifact/');
    expect(String(linked?.materialize ?? '')).toContain('sha256sum -c');

    const exportMarkdown = await mcpConnection.client.callTool({
      name: 'export',
      arguments: { uri: adapterUri, format: 'markdown' }
    });
    const markdownParsed = parseMcpJson(exportMarkdown, 'export markdown');
    expect(markdownParsed.content_type).toBe('text/markdown');
    expect(String(markdownParsed.content)).not.toContain(artifactBody);

    const exportSourceArtifact = await mcpConnection.client.callTool({
      name: 'export',
      arguments: { uri: `squadrules://artifact/${artifactUuid}`, format: 'source' }
    });
    const sourceArtifactParsed = parseMcpJson(exportSourceArtifact, 'export source artifact');
    expect(sourceArtifactParsed.content_type).toBe('text/x-python');
    expect(sourceArtifactParsed.content).toBe(artifactBody);

    const exportSourceArtifactSlug = await mcpConnection.client.callTool({
      name: 'export',
      arguments: { uri: `squadrules://artifact/${artifactSlug}`, format: 'source' }
    });
    const sourceArtifactSlugParsed = parseMcpJson(exportSourceArtifactSlug, 'export source artifact slug');
    expect(sourceArtifactSlugParsed.content_type).toBe('text/x-python');
    expect(sourceArtifactSlugParsed.content).toBe(artifactBody);

    const exportSourceAdapter = await mcpConnection.client.callTool({
      name: 'export',
      arguments: { uri: `squadrules://adapter/${adapterSlug}`, format: 'source' }
    });
    const sourceAdapterParsed = parseMcpJson(exportSourceAdapter, 'export source adapter');
    expect(sourceAdapterParsed.content_type).toBe('application/json');
    const listed = JSON.parse(String(sourceAdapterParsed.content)) as {
      artifacts: Array<{
        artifact_uuid: string;
        uri: string;
        uuid_uri: string;
        label: string;
        slug: string;
        version: string;
        sha256: string;
      }>;
    };
    expect(Array.isArray(listed.artifacts)).toBe(true);
    expect(
      listed.artifacts.some(
        (a) =>
          a.artifact_uuid === artifactUuid &&
          a.uri === `squadrules://artifact/${artifactSlug}` &&
          a.uuid_uri === `squadrules://artifact/${artifactUuid}` &&
          a.slug === artifactSlug &&
          a.version === '1' &&
          typeof a.sha256 === 'string' &&
          a.sha256.length > 0
      )
    ).toBe(true);
  }, 60000);

  test('artifact MIME inference + force_update keeps single point and parent adapter name', async () => {
    const ts = Date.now().toString();
    const adapterSlug = `artifact-parent-force-${ts}`;
    const adapterTitle = `Artifact Parent Force ${ts}`;
    const artifactName = `helper-${ts}.py`;
    const artifactBodyV1 = `print("v1-${ts}")`;
    const artifactBodyV2 = `print("v2-${ts}")`;

    const adapterMarkdown = `---
slug: ${adapterSlug}
---

# ${adapterTitle}

## Activation Patterns
Run when user asks for force-update artifact test.

## Step 1
Parent step.

\`\`\`json
{"contract":{"type":"comment","description":"parent"}}
\`\`\`

## Reward Signal
Done.`;

    const trainAdapter = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: adapterMarkdown,
        llm_model_id: 'test-model',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const adapterParsed = parseMcpJson(trainAdapter, 'train adapter force');
    expect(adapterParsed.status).toBe('stored');

    const trainArtifactV1 = await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: artifactBodyV1,
        llm_model_id: 'test-model',
        artifact_name: artifactName,
        adapter_uri: `squadrules://adapter/${adapterSlug}`,
        relative_path: `scripts/${artifactName}`
      }
    });
    const artifactV1 = parseMcpJson(trainArtifactV1, 'train artifact v1 inferred');
    expect(artifactV1.status).toBe('stored');
    expect(artifactV1.items?.[0]?.content_type).toBe('text/x-python');

    await mcpConnection.client.callTool({
      name: 'train',
      arguments: {
        content: artifactBodyV2,
        llm_model_id: 'test-model',
        artifact_name: artifactName,
        adapter_uri: `squadrules://adapter/${adapterSlug}`,
        force_update: true
      }
    });

    const qdrantPoint = await postJson<{
      result?: { points?: Array<{ id?: string | number; payload?: Record<string, unknown> }> };
    }>(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/scroll`, {
      filter: {
        must: [
          { key: 'content_type', match: { value: 'text/x-python' } },
          { key: 'artifact.name', match: { value: artifactName } }
        ]
      },
      limit: 20,
      with_payload: true
    });
    const points = (qdrantPoint.result?.points ?? []).filter((point) => {
      const payload = (point.payload ?? {}) as Record<string, unknown>;
      const adapter = payload['adapter'] as Record<string, unknown> | undefined;
      return typeof adapter?.['id'] === 'string';
    });
    const matches = points.filter((point) => {
      const payload = (point.payload ?? {}) as Record<string, unknown>;
      const adapter = payload['adapter'] as Record<string, unknown> | undefined;
      const artifact = payload['artifact'] as Record<string, unknown> | undefined;
      return (
        adapter?.['id'] !== undefined &&
        artifact?.['name'] === artifactName &&
        String(adapter?.['name'] ?? '') === adapterTitle
      );
    });
    expect(matches.length).toBe(1);
    const matchedPayload = (matches[0]?.payload ?? {}) as Record<string, unknown>;
    expect(matchedPayload['text']).toBe(artifactBodyV2);
  }, 60000);
});
