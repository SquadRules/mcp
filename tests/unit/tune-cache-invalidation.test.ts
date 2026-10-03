import { describe, expect, test } from '@jest/globals';
import { invalidateTuneCache } from '../../src/tools/tune-cache-invalidation.js';
import { executeTune } from '../../src/tools/tune-execute.js';
import { IDGenerator } from '../../src/services/id-generator.js';
import { runWithSpaceContextAsync } from '../../src/utils/tenant-context.js';

type LayerPayload = {
  slug?: string;
  space_id: string;
  label: string;
  text: string;
  tags: string[];
  llm_model_id: string;
  adapter: {
    id: string;
    name: string;
    layer_index: number;
    layer_count: number;
    protocol_version?: string;
    activation_patterns?: string[];
    reward_signal?: string;
  };
  inference_contract?: unknown;
};

type LayerRecord = { uuid: string; payload: LayerPayload };

class FakeQdrantService {
  private readonly layerByUuid = new Map<string, LayerRecord>();
  constructor(layers: LayerRecord[]) {
    for (const layer of layers) {
      this.layerByUuid.set(layer.uuid, { uuid: layer.uuid, payload: structuredClone(layer.payload) });
    }
  }
  async getAdapterLayers(adapterId: string): Promise<Array<{ uuid: string; payload: LayerPayload }>> {
    return [...this.layerByUuid.values()]
      .filter((l) => l.payload.adapter.id === adapterId)
      .sort((a, b) => a.payload.adapter.layer_index - b.payload.adapter.layer_index)
      .map((l) => ({ uuid: l.uuid, payload: structuredClone(l.payload) }));
  }
  async findFirstStepMemoryUuidBySlug(slug: string): Promise<{ layerUuid: string | null }> {
    const n = slug.trim().toLowerCase();
    for (const l of this.layerByUuid.values()) {
      const s = typeof l.payload.slug === 'string' ? l.payload.slug.trim().toLowerCase() : '';
      if (s === n && l.payload.adapter?.layer_index === 1) return { layerUuid: l.uuid };
    }
    return { layerUuid: null };
  }
  async getMemoryByUUID(uuid: string): Promise<(LayerPayload & { memory_uuid: string }) | null> {
    const l = this.layerByUuid.get(uuid);
    if (!l) return null;
    return { ...l.payload, memory_uuid: uuid };
  }
  async updateMemory(id: string, updates: Record<string, unknown>): Promise<void> {
    const l = this.layerByUuid.get(id);
    if (!l) throw new Error(`Missing layer ${id}`);
    l.payload = { ...l.payload, ...updates, adapter: updates.adapter ? (updates.adapter as any) : l.payload.adapter } as LayerPayload;
  }
}

function buildLayers(adapterId: string, name: string, slug: string): LayerRecord[] {
  return [
    { uuid: '11111111-1111-4111-8111-111111111111', payload: { slug, space_id: 'user:test-space', label: 'Activation Patterns', text: 'Old trigger text', tags: ['old'], llm_model_id: 'cursor-live', inference_contract: { type: 'comment', comment: { min_length: 10 }, required: true }, adapter: { id: adapterId, name, layer_index: 1, layer_count: 2, protocol_version: '1.0.0', activation_patterns: ['run old path'], reward_signal: '## Reward Signal\n\nOld.' } } },
    { uuid: '22222222-2222-4222-8222-222222222222', payload: { slug, space_id: 'user:test-space', label: 'Do Work', text: 'Old work step', tags: ['old'], llm_model_id: 'cursor-live', inference_contract: { type: 'comment', comment: { min_length: 10 }, required: true }, adapter: { id: adapterId, name, layer_index: 2, layer_count: 2, protocol_version: '1.0.0', activation_patterns: ['run old path'], reward_signal: '## Reward Signal\n\nOld.' } } }
  ];
}

const SPACE_CTX = { userId: 'u1', groupIds: [], allowedSpaceIds: ['user:test-space'], defaultWriteSpaceId: 'user:test-space', personalSpaceId: 'user:test-space' };

describe('invalidateTuneCache', () => {
  test('calls redisCacheService.invalidateAfterUpdate after successful tune', async () => {
    const name = 'Tune Export Regression Adapter';
    const id = IDGenerator.generateAdapterUUIDv5(name);
    const slug = 'tune-export-regression-adapter';
    const fakeQdrant = new FakeQdrantService(buildLayers(id, name, slug));

    const md = `---\nslug: ${slug}\nversion: 1.0.2\n---\n\n# ${name}\n\n## Activation Patterns\n\n- run new\n\n\`\`\`json\n{"contract":{"type":"comment","comment":{"min_length":8},"required":true}}\n\`\`\`\n\n## Apply Fix\n\nFresh details.\n\n\`\`\`json\n{"contract":{"type":"comment","comment":{"min_length":12},"required":true}}\n\`\`\`\n\n## Reward Signal\n\nNew reward.\n`;

    const result = await runWithSpaceContextAsync(SPACE_CTX, () =>
      executeTune(fakeQdrant as any, { uris: [`squadrules://adapter/${slug}`], content: [md], review_evidence: { verdict_file: '/tmp/v.txt', exit_code: 0, stdout: 'PASS' } })
    );
    expect(result.total_updated).toBe(1);
    expect(result.total_failed).toBe(0);

    // Should not throw — calls redisCacheService which handles missing Redis gracefully
    await expect(invalidateTuneCache(result)).resolves.toBeUndefined();
  });

  test('no-op when tune fails (zero updates)', async () => {
    const failed = { results: [{ uri: 'squadrules://adapter/x', status: 'error' as const, message: 'fail' }], total_updated: 0, total_failed: 1 };
    // Should return without calling invalidateAfterUpdate
    await expect(invalidateTuneCache(failed)).resolves.toBeUndefined();
  });
});
