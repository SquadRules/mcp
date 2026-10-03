import { describe, expect, test } from '@jest/globals';
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
  readonly updateCalls: Array<{ id: string; updates: Record<string, unknown> }> = [];

  constructor(layers: LayerRecord[]) {
    for (const layer of layers) {
      this.layerByUuid.set(layer.uuid, {
        uuid: layer.uuid,
        payload: structuredClone(layer.payload)
      });
    }
  }

  async getAdapterLayers(adapterId: string): Promise<Array<{ uuid: string; payload: LayerPayload }>> {
    const rows = [...this.layerByUuid.values()]
      .filter((layer) => layer.payload.adapter.id === adapterId)
      .sort((left, right) => left.payload.adapter.layer_index - right.payload.adapter.layer_index)
      .map((layer) => ({ uuid: layer.uuid, payload: structuredClone(layer.payload) }));
    return rows;
  }

  async findFirstStepMemoryUuidBySlug(slug: string): Promise<{ layerUuid: string | null }> {
    const normalized = slug.trim().toLowerCase();
    for (const layer of this.layerByUuid.values()) {
      const pSlug =
        typeof layer.payload.slug === 'string' ? layer.payload.slug.trim().toLowerCase() : '';
      const li = layer.payload.adapter?.layer_index;
      if (pSlug === normalized && li === 1) {
        return { layerUuid: layer.uuid };
      }
    }
    return { layerUuid: null };
  }

  async getMemoryByUUID(uuid: string): Promise<(LayerPayload & { memory_uuid: string }) | null> {
    const layer = this.layerByUuid.get(uuid);
    if (!layer) return null;
    return { ...layer.payload, memory_uuid: uuid };
  }

  async updateMemory(id: string, updates: Record<string, unknown>): Promise<void> {
    const layer = this.layerByUuid.get(id);
    if (!layer) {
      throw new Error(`Missing layer ${id}`);
    }
    const mergedPayload = {
      ...layer.payload,
      ...updates,
      adapter: updates.adapter ? (updates.adapter as LayerPayload['adapter']) : layer.payload.adapter
    } as LayerPayload;
    this.layerByUuid.set(id, { uuid: id, payload: mergedPayload });
    this.updateCalls.push({ id, updates });
  }

  getLayer(uuid: string): LayerRecord | undefined {
    return this.layerByUuid.get(uuid);
  }
}

function buildInitialLayers(adapterId: string, adapterName: string, slug: string): LayerRecord[] {
  const layer1Uuid = '11111111-1111-4111-8111-111111111111';
  const layer2Uuid = '22222222-2222-4222-8222-222222222222';
  return [
    {
      uuid: layer1Uuid,
      payload: {
        slug,
        space_id: 'user:test-space',
        label: 'Activation Patterns',
        text: 'Old trigger text',
        tags: ['old'],
        llm_model_id: 'cursor-live-adapter-update',
        inference_contract: { type: 'comment', comment: { min_length: 10 }, required: true },
        adapter: {
          id: adapterId,
          name: adapterName,
          layer_index: 1,
          layer_count: 2,
          protocol_version: '1.0.0',
          activation_patterns: ['run old path'],
          reward_signal: '## Reward Signal\n\nOld reward text.'
        }
      }
    },
    {
      uuid: layer2Uuid,
      payload: {
        slug,
        space_id: 'user:test-space',
        label: 'Do Work',
        text: 'Old work step',
        tags: ['old', 'work'],
        llm_model_id: 'cursor-live-adapter-update',
        inference_contract: { type: 'comment', comment: { min_length: 10 }, required: true },
        adapter: {
          id: adapterId,
          name: adapterName,
          layer_index: 2,
          layer_count: 2,
          protocol_version: '1.0.0',
          activation_patterns: ['run old path'],
          reward_signal: '## Reward Signal\n\nOld reward text.'
        }
      }
    }
  ];
}

describe('executeTune adapter markdown updates', () => {
  test('updates all adapter layers in place and refreshes adapter metadata', async () => {
    const adapterName = 'Tune Export Regression Adapter';
    const adapterId = IDGenerator.generateAdapterUUIDv5(adapterName);
    const adapterSlug = 'tune-export-regression-adapter';
    const layers = buildInitialLayers(adapterId, adapterName, adapterSlug);
    const fakeQdrant = new FakeQdrantService(layers);

    const nextMarkdown = `---
slug: tune-export-regression-adapter
version: 1.0.2
---

# ${adapterName}

## Activation Patterns

- run new path

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":8},"required":true}}
\`\`\`

## Apply Fix

Fresh implementation details for the second layer.

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":12},"required":true}}
\`\`\`

## Reward Signal

New reward text after tune.
`;

    const output = await executeTune(fakeQdrant as any, {
      uris: [`squadrules://adapter/${adapterSlug}`],
      content: [nextMarkdown],
      review_evidence: { verdict_file: '/tmp/v.txt', exit_code: 0, stdout: 'PASS' }
    });

    expect(output.total_updated).toBe(1);
    expect(output.total_failed).toBe(0);
    expect(output.results[0]).toMatchObject({
      uri: 'squadrules://layer/11111111-1111-4111-8111-111111111111',
      status: 'updated'
    });
    expect(fakeQdrant.updateCalls).toHaveLength(2);

    const layer1 = fakeQdrant.getLayer('11111111-1111-4111-8111-111111111111');
    const layer2 = fakeQdrant.getLayer('22222222-2222-4222-8222-222222222222');
    expect(layer1?.payload.adapter.protocol_version).toBe('1.0.2');
    expect(layer1?.payload.adapter.activation_patterns).toContain('run new path');
    expect(layer1?.payload.adapter.reward_signal).toContain('New reward text after tune.');
    expect(layer2?.payload.label).toBe('Apply Fix');
    expect(layer2?.payload.text).toContain('Fresh implementation details for the second layer.');
  });

  test('rejects markdown that maps to a different adapter id', async () => {
    const adapterName = 'Tune Export Regression Adapter';
    const adapterId = IDGenerator.generateAdapterUUIDv5(adapterName);
    const adapterSlug = 'tune-export-regression-adapter';
    const layers = buildInitialLayers(adapterId, adapterName, adapterSlug);
    const fakeQdrant = new FakeQdrantService(layers);

    const wrongMarkdown = `# Different Adapter Title

## Activation Patterns

- invalid

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":5},"required":true}}
\`\`\`
`;

    const output = await executeTune(fakeQdrant as any, {
      uris: [`squadrules://adapter/${adapterSlug}`],
      content: [wrongMarkdown],
      review_evidence: { verdict_file: '/tmp/v.txt', exit_code: 0, stdout: 'PASS' }
    });

    expect(output.total_updated).toBe(0);
    expect(output.total_failed).toBe(1);
    expect(output.results[0]?.status).toBe('error');
    expect(output.results[0]?.message).toContain('Failed to update adapter layer');
    expect(fakeQdrant.updateCalls).toHaveLength(0);
  });

  test('blocks tune updates for app/system-backed adapters', async () => {
    const adapterName = 'Tune Protected Adapter';
    const adapterId = IDGenerator.generateAdapterUUIDv5(adapterName);
    const adapterSlug = 'tune-protected-adapter';
    const appOnlyLayers = buildInitialLayers(adapterId, adapterName, adapterSlug).map((layer) => ({
      ...layer,
      payload: {
        ...layer.payload,
        space_id: 'space:squadrules-app'
      }
    }));
    const fakeQdrant = new FakeQdrantService(appOnlyLayers);

    const output = await executeTune(fakeQdrant as any, {
      uris: [`squadrules://adapter/${adapterSlug}`],
      updates: { tags: ['blocked'] }
    });

    expect(output.total_updated).toBe(0);
    expect(output.total_failed).toBe(1);
    expect(output.results[0]?.status).toBe('error');
    expect(output.results[0]?.message).toContain('protected app/system spaces');
    expect(fakeQdrant.updateCalls).toHaveLength(0);
  });

  test('still updates writable personal override when app and personal layers share adapter id', async () => {
    const adapterName = 'Tune Mixed Space Adapter';
    const adapterId = IDGenerator.generateAdapterUUIDv5(adapterName);
    const adapterSlug = 'tune-mixed-space-adapter';
    const personalLayers = buildInitialLayers(adapterId, adapterName, adapterSlug).map((layer) => ({
      ...layer,
      payload: {
        ...layer.payload,
        space_id: 'user:test-space'
      }
    }));
    const appLayerUuids = [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    ];
    const appLayers = buildInitialLayers(adapterId, adapterName, adapterSlug).map((layer, index) => ({
      ...layer,
      uuid: appLayerUuids[index]!,
      payload: {
        ...layer.payload,
        space_id: 'space:squadrules-app'
      }
    }));
    const fakeQdrant = new FakeQdrantService([...personalLayers, ...appLayers]);

    const output = await runWithSpaceContextAsync(
      {
        userId: 'u1',
        groupIds: [],
        allowedSpaceIds: ['user:test-space'],
        defaultWriteSpaceId: 'user:test-space',
        personalSpaceId: 'user:test-space'
      },
      async () =>
        executeTune(fakeQdrant as any, {
          uris: [`squadrules://adapter/${adapterSlug}`],
          updates: { tags: ['personal-update'] }
        })
    );

    expect(output.total_updated).toBe(1);
    expect(output.total_failed).toBe(0);
    expect(fakeQdrant.updateCalls).toHaveLength(1);
    expect(fakeQdrant.updateCalls[0]?.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  test('detects silent no-op via post-write verification when updateMemory does not persist', async () => {
    const adapterName = 'Tune Export Regression Adapter';
    const adapterId = IDGenerator.generateAdapterUUIDv5(adapterName);
    const adapterSlug = 'tune-export-regression-adapter';
    const layers = buildInitialLayers(adapterId, adapterName, adapterSlug);

    // BrokenQdrantService: updateMemory records the call but does NOT update stored data,
    // simulating the false-success scenario from the bug report.
    class BrokenQdrantService extends FakeQdrantService {
      override async updateMemory(_id: string, _updates: Record<string, unknown>): Promise<void> {
        // Record the call but silently skip the actual write
        (this as any).updateCalls.push({ id: _id, updates: _updates });
      }
    }
    const brokenQdrant = new BrokenQdrantService(layers);

    const nextMarkdown = `---
slug: tune-export-regression-adapter
version: 1.0.2
---

# ${adapterName}

## Activation Patterns

- run new path

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":8},"required":true}}
\`\`\`

## Apply Fix

Fresh implementation details for the second layer.

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":12},"required":true}}
\`\`\`

## Reward Signal

New reward text after tune.
`;

    const output = await executeTune(brokenQdrant as any, {
      uris: [`squadrules://adapter/${adapterSlug}`],
      content: [nextMarkdown],
      review_evidence: { verdict_file: '/tmp/v.txt', exit_code: 0, stdout: 'PASS' }
    });

    // Post-write verification should catch the stale data and report error instead of false success
    expect(output.total_updated).toBe(0);
    expect(output.total_failed).toBe(1);
    expect(output.results[0]?.status).toBe('error');
    expect(output.results[0]?.message).toContain('Post-write verification failed');
  });
});
