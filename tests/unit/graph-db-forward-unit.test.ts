/**
 * forward effective-content resolution — UNIT.
 *
 * What this suite pins, against the real resolver and the real pure merge:
 *
 *   - no `inherits:` → nothing is substituted, `resolved: true`, the graph is not read
 *   - additive + selective merge: an unclaimed parent section is inherited, the child's
 *     own section survives, the same heading in the child is the recorded override, and
 *     the executable contract is exactly `effective_contracts[0]` — the child's
 *   - a declared parent with no stored record fails closed (`resolved: false`, reason)
 *   - a cycle fails closed (`resolved: false`, reason)
 *   - the graph only contributes `resolved_properties`; bodies merge from records, so a
 *     graph read failure degrades the properties, not the resolution
 *
 * Nothing here is a database. Every double, fixture and mock factory lives in
 * `graph-db-forward-unit-harness.ts`; the activate-side assertions on the same resolver
 * live in `graph-db-forward-merged-unit.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { getInferenceContract, getLayerIndex } from '../../src/services/memory/memory-accessors.js';
import {
  CHILD_UUID,
  TEST_SPACE,
  graphState,
  makeChildMemory,
  makeMemory,
  makeParentMemory,
  makeResolved,
  makeSource,
  mockResolveInheritance,
  mockWarn,
  registerMocks,
  resetGraphState
} from './graph-db-forward-unit-harness.js';

describe('forward effective-content resolution (Touchpoint 2b, unit)', () => {
  beforeEach(resetGraphState);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('no inheritance: the raw child is used, nothing is substituted, the graph is not read', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;

    const child = makeMemory({
      uuid: CHILD_UUID,
      slug: 'standalone-adapter',
      text: '## Rules\n\nStandalone rules.'
    });
    const source = makeSource([child]);

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(source as any, undefined, child);

    expect(result.substitute).toBe(false);
    expect(result.resolved).toBe(true);
    expect(result.effective).toBeUndefined();
    expect(mockResolveInheritance).not.toHaveBeenCalled();

    // forward renders the raw child unchanged.
    const effective = applyEffectiveContent(child, result);
    expect(effective).toBe(child);
    expect(getInferenceContract(effective)).toBeUndefined();
  });

  test('additive merge: parent sections are inherited, child sections survive, the child contract is what forward runs', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;

    const child = makeChildMemory();
    const parent = makeParentMemory();
    const source = makeSource([child, parent]);

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(source as any, undefined, child);

    expect(result.substitute).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.resolved_reason).toBeUndefined();
    // Child-to-root order, as the agent sees it.
    expect(result.inheritance_chain).toEqual(['child-adapter', 'parent-adapter']);

    const merged = result.effective!;
    // Root-first lineage tree, child last.
    expect(merged.lineage).toEqual(['parent-adapter', 'child-adapter']);
    // The child's `Rules` is the explicit override of the parent's.
    expect(merged.overrides).toEqual({ rules: 'child-adapter' });
    expect(merged.text).toContain('Parent policy: review schema changes.');
    expect(merged.text).toContain('Child rules: review the diff first.');
    expect(merged.text).not.toContain('Parent rules: never reached.');
    expect(merged.text).toContain('Child-only addition.');
    // One contract per contributing level, nearest first.
    expect(merged.effective_contracts.map((entry) => entry.source)).toEqual([
      'child-adapter',
      'parent-adapter'
    ]);
    expect(merged.inference_contract).toEqual({
      type: 'comment',
      required: true,
      comment: { text: 'child contract' }
    });

    // What forward executes is exactly `effective_contracts[0]`, on the child's identity.
    const effective = applyEffectiveContent(child, result);
    expect(effective).not.toBe(child);
    expect(effective.memory_uuid).toBe(CHILD_UUID);
    expect(effective.slug).toBe('child-adapter');
    expect(effective.adapter?.id).toBe(CHILD_UUID);
    expect(effective.space_id).toBe(TEST_SPACE);
    expect(getLayerIndex(effective)).toBe(1);
    expect(effective.text).toBe(merged.text);
    expect(getInferenceContract(effective)).toEqual(merged.effective_contracts[0]!.contract);
  });

  test('a declared parent with no stored record fails closed instead of resolving to the child alone', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;

    const child = makeChildMemory();
    // No parent record anywhere: the ancestry cannot be materialised.
    const source = makeSource([child]);

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(source as any, undefined, child);

    expect(result.substitute).toBe(false);
    expect(result.resolved).toBe(false);
    expect(result.resolved_reason).toContain('parent_missing');
    expect(result.inheritance_chain).toEqual(['child-adapter']);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('parent_missing'));
    // A failed resolution never claims the child was merged with anything.
    expect(applyEffectiveContent(child, result)).toBe(child);
  });

  test('a cycle in the stored ancestry fails closed with an explicit reason', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;

    const child = makeMemory({
      uuid: CHILD_UUID,
      slug: 'cycle-adapter',
      text: '## Rules\n\nCycle rules.',
      inherits: 'cycle-adapter'
    });
    const source = makeSource([child]);

    const { resolveEffectiveLayerContent } = await import('../../src/tools/adapter-effective-content.js');

    const result = await resolveEffectiveLayerContent(source as any, undefined, child);

    expect(result.resolved).toBe(false);
    expect(result.resolved_reason).toContain('inheritance_cycle');
    expect(result.substitute).toBe(false);
  });

  test('the graph supplies resolved_properties only; the merged body stays the record merge', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;

    const child = makeChildMemory();
    const parent = makeParentMemory();
    const source = makeSource([child, parent]);
    mockResolveInheritance.mockResolvedValue(makeResolved('child-adapter', { tags: ['child-tag'] }));

    const { resolveEffectiveLayerContent } = await import('../../src/tools/adapter-effective-content.js');

    const result = await resolveEffectiveLayerContent(source as any, undefined, child);

    // Scope-qualified key from the stored record, never `adapter:<slug>`.
    expect(mockResolveInheritance).toHaveBeenCalledWith(`adapter:${TEST_SPACE}:child-adapter`);
    expect(result.resolved).toBe(true);
    expect(result.resolved_properties?.['tags']).toEqual(['child-tag']);
    // The body is the record merge, not the graph's property bag.
    expect(result.effective?.text).toContain('Parent policy: review schema changes.');
  });

  test('a throwing graph degrades the properties, not the resolution', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;

    const child = makeChildMemory();
    const parent = makeParentMemory();
    const source = makeSource([child, parent]);
    mockResolveInheritance.mockRejectedValue(new Error('DB connection lost'));

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(source as any, undefined, child);

    expect(result.substitute).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.resolved_properties).toBeUndefined();
    expect(result.effective?.text).toContain('Parent policy: review schema changes.');
    expect(applyEffectiveContent(child, result).slug).toBe('child-adapter');
  });
});
