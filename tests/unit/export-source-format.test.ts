import { createHash } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { exportFormatSchema } from '../../src/tools/export_schema.js';
import { executeExport } from '../../src/tools/export.js';

describe('export source format', () => {
  it('accepts source in export format schema', () => {
    const parsed = exportFormatSchema.safeParse('source');
    expect(parsed.success).toBe(true);
  });

  it('exports artifact content from squadrules://artifact URI with content_type', async () => {
    const memoryStore = {
      getMemory: async (id: string) =>
        id === '11111111-2222-3333-4444-555555555555'
          ? ({
              memory_uuid: id,
              label: 'artifact.py',
              tags: ['artifact', 'x-python'],
              text: 'print("ok")',
              llm_model_id: 'test-model',
              created_at: new Date().toISOString(),
              content_type: 'text/x-python',
              adapter: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Parent Adapter' }
            } as any)
          : null,
      getQdrantAccess: () => ({
        client: { scroll: async () => ({ points: [], next_page_offset: null }) },
        collection: 'squadrules'
      })
    } as any;

    const out = await executeExport(memoryStore, undefined, {
      uri: 'squadrules://artifact/11111111-2222-3333-4444-555555555555',
      format: 'source',
      include_reward: true
    });

    expect(out.format).toBe('source');
    expect(out.content_type).toBe('text/x-python');
    expect(out.content).toBe('print("ok")');
  });

  it('exports artifact content from squadrules://artifact URI without source format override', async () => {
    const memoryStore = {
      getMemory: async (id: string) =>
        id === '11111111-2222-3333-4444-555555555555'
          ? ({
              memory_uuid: id,
              label: 'artifact.py',
              tags: ['artifact', 'x-python'],
              text: 'print("ok")',
              llm_model_id: 'test-model',
              created_at: new Date().toISOString(),
              content_type: 'text/x-python',
              adapter: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Parent Adapter' }
            } as any)
          : null,
      getQdrantAccess: () => ({
        client: { scroll: async () => ({ points: [], next_page_offset: null }) },
        collection: 'squadrules'
      })
    } as any;

    const out = await executeExport(memoryStore, undefined, {
      uri: 'squadrules://artifact/11111111-2222-3333-4444-555555555555',
      format: 'markdown',
      include_reward: true
    });

    expect(out.format).toBe('source');
    expect(out.content_type).toBe('text/x-python');
    expect(out.content).toBe('print("ok")');
  });

  it('lists adapter artifacts when source export uses adapter URI', async () => {
    const adapterId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const adapterSlug = 'test-export-source-slug';
    const qdrantService = {
      async findFirstStepMemoryUuidBySlug(slug: string) {
        if (slug.trim().toLowerCase() === adapterSlug) {
          return { layerUuid: adapterId };
        }
        return { layerUuid: null };
      },
      async getAdapterLayers(id: string) {
        if (id === adapterId) return [{ uuid: adapterId }];
        return [];
      }
    };
    const memoryStore = {
      getMemory: async (id: string) =>
        id === adapterId
          ? ({
              memory_uuid: adapterId,
              label: 'Adapter head',
              text: '',
              tags: [],
              llm_model_id: 'test-model',
              created_at: new Date().toISOString(),
              adapter: { id: adapterId, name: 'Test' }
            } as any)
          : null,
      // Adapter artifacts are listed through the record store (src/tools/artifact-catalog.ts),
      // not through a raw Qdrant scroll.
      listAdapterArtifacts: async () => [
        {
          uuid: '11111111-2222-3333-4444-555555555555',
          payload: {
            label: 'artifact.py',
            content_type: 'text/x-python',
            tags: ['artifact', 'x-python']
          }
        }
      ]
    } as any;

    const out = await executeExport(memoryStore, qdrantService as any, {
      uri: `squadrules://adapter/${adapterSlug}`,
      format: 'source',
      include_reward: true
    });

    expect(out.format).toBe('source');
    expect(out.content_type).toBe('application/json');
    const parsed = JSON.parse(out.content) as { artifacts: Array<{ uri: string; content_type: string }> };
    expect(Array.isArray(parsed.artifacts)).toBe(true);
    expect(parsed.artifacts[0]?.uri).toBe('squadrules://artifact/11111111-2222-3333-4444-555555555555');
    expect(parsed.artifacts[0]?.content_type).toBe('text/x-python');
  });
});

const ARTIFACT_TEXT = 'print("ok")\r\n';
const ARTIFACT_ID = '11111111-2222-3333-4444-555555555555';

function artifactStore() {
  return {
    getMemory: async (id: string) =>
      id === ARTIFACT_ID
        ? ({
            memory_uuid: id,
            label: 'artifact.py',
            tags: ['artifact', 'x-python'],
            text: ARTIFACT_TEXT,
            llm_model_id: 'test-model',
            created_at: new Date().toISOString(),
            content_type: 'text/x-python',
            adapter: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Parent Adapter' }
          } as any)
        : null,
    getQdrantAccess: () => ({
      client: { scroll: async () => ({ points: [], next_page_offset: null }) },
      collection: 'squadrules'
    })
  } as any;
}

function sourceExport(input: Record<string, unknown>) {
  return executeExport(artifactStore(), undefined, {
    uri: `squadrules://artifact/${ARTIFACT_ID}`,
    include_reward: true,
    ...input
  } as any);
}

describe('export source digests (issue #231)', () => {
  it('names the digest of the stored bytes on a raw source export', async () => {
    const out = await sourceExport({ format: 'source' });
    expect(out.content).toBe(ARTIFACT_TEXT);
    expect(out.content_encoding).toBeUndefined();
    expect(out.sha256).toBe(createHash('sha256').update(ARTIFACT_TEXT, 'utf8').digest('hex'));
  });

  it('base64-delivers the identical bytes and digest when asked', async () => {
    const out = await sourceExport({ format: 'source', delivery: 'inline_base64' });
    expect(out.content_encoding).toBe('base64');
    expect(Buffer.from(out.content, 'base64').toString('utf8')).toBe(ARTIFACT_TEXT);
    expect(out.sha256).toBe(createHash('sha256').update(ARTIFACT_TEXT, 'utf8').digest('hex'));
  });
});
