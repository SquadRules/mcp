/**
 * F2 invariant: a markdown CONTENT tune must never change or clear the stored
 * executable gate (`inference_contract`).
 *
 * `tuneAdapterMarkdownInPlace` used to put `inference_contract: next.inference_contract ??
 * null` into its update payload, so editing prose either replaced the gate with whatever
 * fence the document happened to contain or set it to null. The store merge keeps any key
 * the update omits, so the fix is to leave the field out of the payload entirely.
 *
 * Two halves, both at the boundary the tune code actually controls:
 *  1. the object handed to `updateMemory` by the real production function carries no
 *     `inference_contract` key at all;
 *  2. the merge the store performs then retains the existing gate for exactly that payload.
 *
 * WHAT IS A DOUBLE AND WHAT IS REAL (no mocks): the production function, the markdown
 * builder, the frontmatter parser, the version/CAS, layer-count, inheritance, descendant and
 * persistence guards all run for real. Only the Qdrant/Lance transport is replaced by
 * `StoredLayerStore`, because `updateMemory` needs a live connection. Its merge is a
 * labelled mirror of `src/services/qdrant/memory-updates.ts:130-145`
 * (`{ ...existingPayload, space_id, ...safeUpdates, ...timestamps }`); the retired
 * `description_*` strip, `created_by` and `quality_metadata` recalculation are omitted as
 * unrelated to the `inference_contract` key. No backend, HTTP or graph is contacted: the
 * store is not attached to a graph, so `getGraphDb` returns null and the derived-index work
 * after the write degrades exactly as production does. No verdict or review-evidence file
 * is created — this calls the markdown rewrite directly, and its critic-loop gate lives in
 * the `executeTune` dispatcher, not here.
 */
import { describe, expect, test } from '@jest/globals';
import { tuneAdapterMarkdownInPlace } from '../../src/tools/tune-adapter-markdown.js';
import { IDGenerator } from '../../src/services/id-generator.js';

const ADAPTER_NAME = 'Tune Contract Integrity Adapter';
const ADAPTER_SLUG = 'tune-contract-integrity-adapter';
const SPACE_ID = 'user:test-space';
const HEAD_UUID = '11111111-1111-4111-8111-111111111111';
const TAIL_UUID = '22222222-2222-4222-8222-222222222222';

/** The gate stored on every layer. Deliberately different from the tuned document's fences. */
const STORED_CONTRACT = { type: 'comment', comment: { min_length: 10 }, required: true };

/** The gate the tuned markdown declares instead. Content tune must never persist either. */
const FENCE_CONTRACT_HEAD = { type: 'comment', comment: { min_length: 8 }, required: true };

type LayerPayload = {
  slug: string;
  space_id: string;
  label: string;
  text: string;
  tags: string[];
  llm_model_id: string;
  inference_contract?: unknown;
  adapter: Record<string, unknown>;
};

function mergeLikeUpdateMemory(
  existingPayload: LayerPayload,
  updates: Record<string, unknown>
): LayerPayload {
  const { description_short: _short, description_full: _full, ...safeUpdates } = updates ?? {};
  return {
    ...existingPayload,
    space_id: existingPayload.space_id ?? SPACE_ID,
    ...safeUpdates,
    updated_at: new Date().toISOString(),
    modified_at: new Date().toISOString()
  } as LayerPayload;
}

function seedLayer(uuid: string, label: string, text: string, index: number): LayerPayload {
  return {
    slug: ADAPTER_SLUG,
    space_id: SPACE_ID,
    label,
    text,
    tags: ['old'],
    llm_model_id: 'unit-test',
    inference_contract: structuredClone(STORED_CONTRACT),
    adapter: {
      id: IDGenerator.generateAdapterUUIDv5(ADAPTER_NAME),
      name: ADAPTER_NAME,
      layer_index: index,
      layer_count: 2,
      protocol_version: '1.0.0',
      activation_patterns: ['run the old path'],
      reward_signal: '## Reward Signal\n\nOld reward text.'
    }
  };
}

class StoredLayerStore {
  readonly updateCalls: Array<{ id: string; updates: Record<string, unknown> }> = [];
  private readonly layers = new Map<string, LayerPayload>();

  constructor() {
    this.layers.set(HEAD_UUID, seedLayer(HEAD_UUID, 'Activation Patterns', 'Old trigger text', 1));
    this.layers.set(TAIL_UUID, seedLayer(TAIL_UUID, 'Do Work', 'Old work step', 2));
  }

  async findFirstStepMemoryUuidBySlug(slug: string): Promise<{ layerUuid: string | null }> {
    for (const [uuid, payload] of this.layers) {
      if (payload.slug === slug.trim().toLowerCase() && payload.adapter['layer_index'] === 1) {
        return { layerUuid: uuid };
      }
    }
    return { layerUuid: null };
  }

  async getMemoryByUUID(uuid: string): Promise<LayerPayload | null> {
    const payload = this.layers.get(uuid);
    return payload ? structuredClone(payload) : null;
  }

  async getAdapterLayers(): Promise<Array<{ uuid: string; payload: LayerPayload }>> {
    return [...this.layers.entries()]
      .sort((a, b) => (a[1].adapter['layer_index'] as number) - (b[1].adapter['layer_index'] as number))
      .map(([uuid, payload]) => ({ uuid, payload: structuredClone(payload) }));
  }

  async updateMemory(id: string, updates: Record<string, unknown>): Promise<void> {
    const existing = this.layers.get(id);
    if (!existing) throw new Error(`Missing layer ${id}`);
    this.layers.set(id, mergeLikeUpdateMemory(existing, structuredClone(updates)));
    this.updateCalls.push({ id, updates });
  }

  getStored(id: string): LayerPayload {
    return structuredClone(this.layers.get(id)!);
  }
}

const TUNED_MARKDOWN = `---
slug: ${ADAPTER_SLUG}
version: 1.0.2
---

# ${ADAPTER_NAME}

## Activation Patterns

- run the new path

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":8},"required":true}}
\`\`\`

## Apply Fix

Fresh implementation prose for the second layer.

\`\`\`json
{"contract":{"type":"comment","comment":{"min_length":12},"required":true}}
\`\`\`

## Reward Signal

New reward text after tune.
`;

describe('content tune preserves the stored executable gate', () => {
  test('the payload passed to updateMemory has no inference_contract key', async () => {
    const store = new StoredLayerStore();

    await tuneAdapterMarkdownInPlace(store as never, `squadrules://adapter/${ADAPTER_SLUG}`, TUNED_MARKDOWN);

    // The tune really wrote: both layers got the new prose, so the key list below is not
    // vacuously short because nothing happened.
    expect(store.updateCalls.map((call) => call.id)).toEqual([HEAD_UUID, TAIL_UUID]);
    expect(store.getStored(HEAD_UUID).text).toContain('run the new path');
    expect(store.getStored(TAIL_UUID).label).toBe('Apply Fix');

    for (const call of store.updateCalls) {
      expect('inference_contract' in call.updates).toBe(false);
      expect(Object.keys(call.updates).sort()).toEqual(['adapter', 'label', 'tags', 'text']);
    }
  });

  test('the stored gate survives the store merge untouched — neither replaced nor cleared', async () => {
    const store = new StoredLayerStore();

    await tuneAdapterMarkdownInPlace(store as never, `squadrules://adapter/${ADAPTER_SLUG}`, TUNED_MARKDOWN);

    for (const uuid of [HEAD_UUID, TAIL_UUID]) {
      const stored = store.getStored(uuid);
      // Mirrors `safeUpdates` spread over `existingPayload` for the payload the tune built.
      const merged = mergeLikeUpdateMemory(
        { ...seedLayer(uuid, 'Activation Patterns', 'Old trigger text', 1) },
        store.updateCalls.find((call) => call.id === uuid)!.updates
      );
      expect(stored.inference_contract).toEqual(STORED_CONTRACT);
      expect(merged.inference_contract).toEqual(STORED_CONTRACT);
      expect(stored.inference_contract).not.toEqual(FENCE_CONTRACT_HEAD);
    }
  });

  test('the merge only loses the gate when a caller sends the key — the behaviour the fix removes', () => {
    const seed = seedLayer(HEAD_UUID, 'Activation Patterns', 'Old trigger text', 1);

    // The payload shape the tune used to send: a fence-less layer cleared the gate, and a
    // layer with a fence replaced it. Proving this keeps the invariant above meaningful.
    expect(mergeLikeUpdateMemory(seed, { inference_contract: null }).inference_contract).toBeNull();
    expect(
      mergeLikeUpdateMemory(seed, { inference_contract: FENCE_CONTRACT_HEAD }).inference_contract
    ).toEqual(FENCE_CONTRACT_HEAD);
    // Omitting the key is what preserves it.
    expect(mergeLikeUpdateMemory(seed, { text: 'new prose' }).inference_contract).toEqual(STORED_CONTRACT);
  });
});
