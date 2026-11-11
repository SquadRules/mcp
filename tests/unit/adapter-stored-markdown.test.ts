/**
 * Durable-state reconstruction for history snapshots (G3).
 *
 * WHAT THIS PINS
 * A snapshot must record the state a restore is supposed to recover, not the bytes a
 * caller submitted. `tune` deliberately preserves the stored `inference_contract` on a
 * prose edit, so a submitted document can describe a gate the adapter never had;
 * snapshotting those bytes would let a later restore activate behaviour the original
 * write never activated.
 *
 * The reconstruction is the inverse of the write path's own decomposition
 * (`buildHeaderMemoryAdapter`): the stored head supplies the frontmatter block and the
 * H1, and each layer's `text` is already its verbatim section (heading included).
 */
import { describe, expect, test, beforeEach } from '@jest/globals';
import {
  reconstructStoredAdapterMarkdown,
  serializeStoredFrontmatter
} from '../../src/services/graph-db/adapter-stored-markdown.js';
import { buildHeaderMemoryAdapter } from '../../src/services/memory/adapter-builder.js';
import { CodeBlockProcessor } from '../../src/services/code-block-processor.js';
import type { InferenceContractDefinition, Memory } from '../../src/types/memory.js';

const SPACE = 'space:unit-reconstruction';

/** One stored layer record, shaped as the store hands it back. */
function storedLayer(input: {
  layerIndex: number;
  layerCount?: number;
  text: string;
  frontmatter?: Record<string, unknown>;
  slug?: string;
  title?: string;
  contract?: InferenceContractDefinition;
  rewardSignal?: string;
}): Memory {
  const title = input.title ?? 'Demo Adapter';
  return {
    memory_uuid: `uuid-${input.layerIndex}`,
    label: title,
    tags: [],
    text: input.text,
    llm_model_id: 'unit-model',
    created_at: '2026-01-01T00:00:00.000Z',
    space_id: SPACE,
    slug: input.slug ?? 'demo',
    ...(input.contract ? { inference_contract: input.contract } : {}),
    adapter: {
      id: 'adapter-demo',
      name: title,
      layer_index: input.layerIndex,
      layer_count: input.layerCount ?? 2,
      ...(input.rewardSignal ? { reward_signal: input.rewardSignal } : {}),
      ...(input.frontmatter ? { frontmatter: input.frontmatter } : {})
    }
  } as unknown as Memory;
}

describe('stored adapter markdown reconstruction', () => {
  test('rebuilds the frontmatter block, the H1, every layer and its gate in layer order', () => {
    const state = reconstructStoredAdapterMarkdown([
      storedLayer({ layerIndex: 2, text: '## Apply Fix\n\nDo it.' }),
      storedLayer({
        layerIndex: 1,
        text: '## Activation Patterns\n\n- demo',
        frontmatter: { slug: 'demo', version: '2.1.0', inherits: 'base' },
        contract: { type: 'comment', required: true }
      })
    ]);

    expect(state).not.toBeNull();
    // Byte-exact: history content is compared and restored, so an unstable serialization
    // would make two identical states look different.
    expect(state!.markdown).toBe(
      [
        '---',
        'slug: demo',
        'version: 2.1.0',
        'inherits: base',
        '---',
        '',
        '# Demo Adapter',
        '',
        '## Activation Patterns',
        '',
        '- demo',
        '',
        '```json',
        '{"contract":{"required":true,"type":"comment"}}',
        '```',
        '',
        '## Apply Fix',
        '',
        'Do it.',
        ''
      ].join('\n')
    );
    expect(state!.source).toBe('stored-state');
    expect(state!.slug).toBe('demo');
    expect(state!.layer_count).toBe(2);
    // One re-emitted gate, and the split survives: the gate fences a non-final layer.
    expect(state!.contract_count).toBe(1);
    expect(state!.boundary_complete).toBe(true);
    expect(state!.reward_signal).toBe(false);
  });

  test('a non-final layer without a gate is reported as an incomplete boundary', () => {
    const state = reconstructStoredAdapterMarkdown([
      storedLayer({ layerIndex: 1, text: '## Step\n\nA' }),
      storedLayer({ layerIndex: 2, text: '## Step\n\nB' })
    ])!;

    // Only a fence delimits a layer, so the rebuilt document would restore as one layer.
    // That is disclosed, not hidden behind a `layer_count` that claims two.
    expect(state.contract_count).toBe(0);
    expect(state.boundary_complete).toBe(false);
  });

  test('re-emits the reward signal after the last gate so a restore keeps the reward', () => {
    const gated = reconstructStoredAdapterMarkdown([
      storedLayer({
        layerIndex: 1,
        text: '## Step\n\nA',
        contract: { type: 'comment', required: true },
        rewardSignal: '## Reward Signal\n\nDone.'
      })
    ])!;

    expect(gated.reward_signal).toBe(true);
    expect(gated.boundary_complete).toBe(true);
    expect(gated.markdown.endsWith('```\n\n## Reward Signal\n\nDone.\n')).toBe(true);

    // Without a trailing fence the converter reads the reward section as part of the
    // layer, so the metadata cannot be recovered — and the state says so.
    const ungated = reconstructStoredAdapterMarkdown([
      storedLayer({ layerIndex: 1, text: '## Step\n\nA', rewardSignal: '## Reward Signal\n\nDone.' })
    ])!;
    expect(ungated.reward_signal).toBe(true);
    expect(ungated.boundary_complete).toBe(false);
  });

  test('is independent of the order the records are read in', () => {
    const head = storedLayer({
      layerIndex: 1,
      text: '## Activation Patterns\n\n- demo',
      frontmatter: { slug: 'demo', version: '1.0.0' }
    });
    const tail = storedLayer({ layerIndex: 2, text: '## Apply Fix\n\nDo it.' });

    const forward = reconstructStoredAdapterMarkdown([head, tail])!;
    const reversed = reconstructStoredAdapterMarkdown([tail, head])!;
    expect(reversed.markdown).toBe(forward.markdown);
    expect(reversed.digest).toBe(forward.digest);
  });

  test('the digest is a stable identity of the rebuilt bytes', () => {
    const layers = [
      storedLayer({ layerIndex: 1, text: '## Step\n\nA', frontmatter: { slug: 'demo', version: '1.0.0' } })
    ];
    const first = reconstructStoredAdapterMarkdown(layers)!;
    const second = reconstructStoredAdapterMarkdown(layers)!;
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);

    const changed = reconstructStoredAdapterMarkdown([
      storedLayer({ layerIndex: 1, text: '## Step\n\nB', frontmatter: { slug: 'demo', version: '1.0.0' } })
    ])!;
    expect(changed.digest).not.toBe(first.digest);
  });

  test('refuses to snapshot a record set that cannot name its own adapter', () => {
    expect(reconstructStoredAdapterMarkdown([])).toBeNull();
    expect(
      reconstructStoredAdapterMarkdown([storedLayer({ layerIndex: 1, text: '## Step', slug: '' })])
    ).toBeNull();
  });
});

describe('stored frontmatter serialization', () => {
  test('keeps a stable key order so equal state serializes identically', () => {
    const left = serializeStoredFrontmatter({ zeta: 'z', slug: 'demo', version: '1.0.0', alpha: 'a' });
    const right = serializeStoredFrontmatter({ alpha: 'a', zeta: 'z', version: '1.0.0', slug: 'demo' });
    expect(left).toBe(right);
    // Known topology keys lead, the rest follow sorted — never map-iteration order.
    expect(left.split('\n').map((line) => line.split(':')[0])).toEqual([
      'slug',
      'version',
      'alpha',
      'zeta'
    ]);
  });

  test('keeps one level of nesting and drops empty values instead of writing blanks', () => {
    expect(
      serializeStoredFrontmatter({
        slug: 'demo',
        version: '1.0.0',
        contract: { type: 'comment', text: 'recorded' },
        tags: ['a', 'b'],
        empty: [],
        missing: null
      })
    ).toBe(
      // Known topology keys lead, the rest follow sorted — never map-iteration order.
      ['slug: demo', 'version: 1.0.0', 'contract:', '  text: recorded', '  type: comment', 'tags: [a, b]'].join(
        '\n'
      )
    );
  });
});

/**
 * Round-trip against the real converter.
 *
 * This is the property the snapshot depends on: the rebuilt document must re-decompose
 * into the records it was built from. Anything less means a restore activates a
 * different adapter than the one snapshotted — a missing fence collapses two layers
 * into one, a dropped reward section removes the reward gate.
 */
describe('reconstruction agrees with the real write decomposition', () => {
  let processor: CodeBlockProcessor;

  beforeEach(() => {
    processor = new CodeBlockProcessor();
  });

  function build(body: string): Memory[] {
    const frontmatter = { slug: 'demo', version: '1.0.0' };
    return buildHeaderMemoryAdapter(body, 'unit-model', new Date('2026-01-01T00:00:00.000Z'), processor).map(
      (layer) => {
        // The store persists the slug on the record; the converter alone leaves it unset.
        const copy = { ...layer, space_id: SPACE, slug: frontmatter.slug } as Memory;
        copy.adapter = {
          ...(layer.adapter as NonNullable<Memory['adapter']>),
          frontmatter
        };
        return copy;
      }
    );
  }

  test('re-parsing the rebuilt document recovers every layer, gate and reward signal', () => {
    const body = [
      '# Demo Adapter',
      '',
      '## Activation Patterns',
      '',
      '- demo',
      '',
      '## Step 1',
      '',
      'Run the recorded path.',
      '',
      '```json',
      '{"contract": {"type": "comment", "text": "recorded"}}',
      '```',
      '',
      '## Step 2',
      '',
      'Then finish.',
      '',
      '```json',
      '{"contract": {"type": "review", "text": "approved"}}',
      '```',
      '',
      '## Reward Signal',
      '',
      'Done.'
    ].join('\n');

    const built = build(body);
    // Two fenced gates plus a trailing reward section: two layers, not three.
    expect(built).toHaveLength(2);
    const state = reconstructStoredAdapterMarkdown(built)!;

    expect(state.layer_count).toBe(built.length);
    expect(state.contract_count).toBe(built.length);
    expect(state.reward_signal).toBe(true);
    expect(state.boundary_complete).toBe(true);
    expect(state.markdown.split('\n').slice(0, 4)).toEqual(['---', 'slug: demo', 'version: 1.0.0', '---']);

    const reparsed = buildHeaderMemoryAdapter(
      state.markdown,
      'unit-model',
      new Date('2026-01-01T00:00:00.000Z'),
      processor
    );
    expect(reparsed).toHaveLength(built.length);
    for (let index = 0; index < built.length; index++) {
      expect(reparsed[index]!.text).toBe(built[index]!.text);
      expect(reparsed[index]!.inference_contract).toEqual(built[index]!.inference_contract);
      expect(reparsed[index]!.adapter?.reward_signal).toBe(built[index]!.adapter?.reward_signal);
    }

    // Idempotent: snapshotting the restored state reproduces the same bytes. Without this
    // the durable-byte no-change guard would append a redundant version on every repair.
    const second = reconstructStoredAdapterMarkdown(build(state.markdown))!;
    expect(second.digest).toBe(state.digest);
  });
});
