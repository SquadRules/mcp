/**
 * activate merged-content surfacing — UNIT.
 *
 * `activate` shows the agent the merged tree instead of one layer in isolation. This suite
 * pins only the projection: the child identity survives, the lineage is root-first, the
 * display is never trimmed below the full tree, and the child's contract stays first.
 *
 * The resolver assertions live in `graph-db-forward-unit.test.ts`; both suites share
 * `graph-db-forward-unit-harness.ts`.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { extractMemoryBody } from '../../src/utils/memory-body.js';
import {
  CHILD_UUID,
  commentContract,
  graphState,
  makeChildMemory,
  makeMemory,
  makeParentMemory,
  makeSource,
  mockWarn,
  registerMocks,
  resetGraphState
} from './graph-db-forward-unit-harness.js';

describe('activate merged-content surfacing (Touchpoint 2b, Option A, unit)', () => {
  beforeEach(() => {
    resetGraphState();
    mockWarn.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('merged content carries the child identity and the full lineage tree', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;

    const child = makeChildMemory();
    const parent = makeParentMemory();
    const source = makeSource([child, parent]);

    const { resolveEffectiveLayerContent, buildMergedAdapterContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(source as any, undefined, child, 'activate');
    const merged = buildMergedAdapterContent(child, result);

    expect(merged.slug).toBe('child-adapter');
    expect(merged.version).toBe('1.0.0');
    expect(merged.resolved).toBe(true);
    expect(merged.inheritance_chain).toEqual(['child-adapter', 'parent-adapter']);
    expect(merged.lineage).toEqual(['parent-adapter', 'child-adapter']);
    // Display depth never trims below the full tree by default.
    expect(merged.lineage_truncated).toBe(false);
    expect(merged.content).toContain('Parent policy: review schema changes.');
    expect(merged.content).toContain('Child-only addition.');
    expect(merged.effective_contracts[0]!.source).toBe('child-adapter');
    expect(extractMemoryBody(merged.content)).toBe(merged.content);
  });

  test('a child with no inheritance surfaces its own body and an empty tree', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;

    const child = makeMemory({
      uuid: CHILD_UUID,
      slug: 'standalone-adapter',
      text: '## Rules\n\nStandalone rules.',
      contract: commentContract('standalone contract')
    });
    const source = makeSource([child]);

    const { resolveEffectiveLayerContent, buildMergedAdapterContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(source as any, undefined, child, 'activate');
    const merged = buildMergedAdapterContent(child, result);

    expect(merged.slug).toBe('standalone-adapter');
    expect(merged.content).toContain('Standalone rules.');
    expect(merged.resolved).toBe(true);
    expect(merged.lineage).toEqual([]);
    expect(merged.effective_contracts).toEqual([]);
  });
});
