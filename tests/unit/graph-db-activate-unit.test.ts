/**
 * Unit tests for Touchpoint 2: activate resolves inheritance chain server-side.
 *
 * Honest naming: this is a UNIT test. The graph DB and the effective-content helper
 * are mocked; real-database coverage lives in
 * tests/integration/graph-db-instance-isolation.test.ts.
 *
 * Covers:
 *   - Primary path: effective content resolved from the stored child record (Option A)
 *   - Fallback: chain resolved from the graph using the STORED record's scope, never
 *     the bare slug (same slug may exist in several spaces)
 *   - Multi-level inheritance: chain = [child, parent, grandparent]
 *   - Graph DB unavailable / resolveInheritance throws: graceful degradation
 *   - Adapter not in graph: empty chain but `resolved: true`
 *   - No match choices: the graph is never consulted
 *
 * The backend-neutral property merge is covered separately, against the real function,
 * in `adapter-inheritance-merge.test.ts`. Every double lives in
 * `graph-db-activate-unit-harness.ts`.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  graphState,
  makeMatchChoice,
  makeResolvedInheritance,
  makeStoreAndService,
  mockBuildMergedAdapterContent,
  mockResolveEffectiveLayerContent,
  mockResolveInheritance,
  mockWarn,
  registerMocks,
  resetActivateDoubles,
  searchState,
  STORED_SPACE
} from './graph-db-activate-unit-harness.js';

describe('activate inheritance resolution (Touchpoint 2, unit)', () => {
  beforeEach(resetActivateDoubles);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('primary path: effective content from the stored child is surfaced with the chain (Option A)', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;
    searchState.choices = [makeMatchChoice('standalone-adapter')];

    mockResolveEffectiveLayerContent.mockResolvedValue({
      substitute: false,
      inheritance_chain: ['standalone-adapter'],
      resolved: true
    });
    const merged = {
      slug: 'standalone-adapter',
      version: '1.0.0',
      content: 'merged body',
      inheritance_chain: ['standalone-adapter'],
      resolved: true
    };
    mockBuildMergedAdapterContent.mockReturnValue(merged);

    const { executeActivate } = await import('../../src/tools/activate.js');
    const { memoryStore, qdrantService } = makeStoreAndService('standalone-adapter');

    const result = await executeActivate(memoryStore, qdrantService, { query: 'test' });

    expect(result.inheritance_chain).toEqual(['standalone-adapter']);
    expect(result.inheritance_resolved).toBe(true);
    // The effective content is attached to the top match choice — what forward executes.
    expect(result.choices[0].merged_adapter_content).toEqual(merged);
    // The primary path already resolved through the graph; no second lookup.
    expect(mockResolveInheritance).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  test('fallback: graph key is built from the STORED record scope, never the bare slug', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;
    searchState.choices = [makeMatchChoice('child-adapter')];

    // Force the chain-only fallback by making the primary path unavailable.
    mockResolveEffectiveLayerContent.mockRejectedValue(new Error('no effective content'));
    mockResolveInheritance.mockResolvedValue(makeResolvedInheritance('child-adapter', []));

    const { executeActivate } = await import('../../src/tools/activate.js');
    const { memoryStore, qdrantService } = makeStoreAndService('child-adapter');

    const result = await executeActivate(memoryStore, qdrantService, { query: 'test' });

    expect(mockResolveInheritance).toHaveBeenCalledWith(`adapter:${STORED_SPACE}:child-adapter`);
    expect(result.inheritance_chain).toEqual(['child-adapter']);
    expect(result.inheritance_resolved).toBe(true);
  });

  test('multi-level fallback: chain = [child, parent, grandparent], resolved true', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;
    searchState.choices = [makeMatchChoice('child-adapter')];

    mockResolveEffectiveLayerContent.mockRejectedValue(new Error('no effective content'));
    mockResolveInheritance.mockResolvedValue(
      makeResolvedInheritance('child-adapter', ['parent-adapter', 'grandparent-adapter'])
    );

    const { executeActivate } = await import('../../src/tools/activate.js');
    const { memoryStore, qdrantService } = makeStoreAndService('child-adapter');

    const result = await executeActivate(memoryStore, qdrantService, { query: 'test' });

    expect(result.inheritance_chain).toEqual(['child-adapter', 'parent-adapter', 'grandparent-adapter']);
    expect(result.inheritance_resolved).toBe(true);
  });

  test('graph DB unavailable: chain empty, resolved false, warning logged', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;
    searchState.choices = [makeMatchChoice('some-adapter')];

    mockResolveEffectiveLayerContent.mockRejectedValue(new Error('no effective content'));

    const { executeActivate } = await import('../../src/tools/activate.js');
    const { memoryStore, qdrantService } = makeStoreAndService('some-adapter');

    const result = await executeActivate(memoryStore, qdrantService, { query: 'test' });

    expect(result.inheritance_chain).toEqual([]);
    expect(result.inheritance_resolved).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('graph DB unavailable'));
    expect(mockResolveInheritance).not.toHaveBeenCalled();
  });

  test('resolveInheritance throws: graceful degradation, resolved false, warning logged', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;
    searchState.choices = [makeMatchChoice('failing-adapter')];

    mockResolveEffectiveLayerContent.mockRejectedValue(new Error('no effective content'));
    mockResolveInheritance.mockRejectedValue(new Error('DB connection lost'));

    const { executeActivate } = await import('../../src/tools/activate.js');
    const { memoryStore, qdrantService } = makeStoreAndService('failing-adapter');

    const result = await executeActivate(memoryStore, qdrantService, { query: 'test' });

    expect(result.inheritance_chain).toEqual([]);
    expect(result.inheritance_resolved).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('resolveInheritance failed'));
    // Activation still succeeds — choices are present.
    expect(result.choices.length).toBeGreaterThan(0);
  });

  test('adapter not in graph: chain empty, resolved true (not a degradation)', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;
    searchState.choices = [makeMatchChoice('unknown-adapter')];

    mockResolveEffectiveLayerContent.mockRejectedValue(new Error('no effective content'));
    // The graph has no node for this adapter.
    mockResolveInheritance.mockResolvedValue(null);

    const { executeActivate } = await import('../../src/tools/activate.js');
    const { memoryStore, qdrantService } = makeStoreAndService('unknown-adapter');

    const result = await executeActivate(memoryStore, qdrantService, { query: 'test' });

    expect(result.inheritance_chain).toEqual([]);
    expect(result.inheritance_resolved).toBe(true);
    expect(mockWarn).not.toHaveBeenCalledWith(expect.stringContaining('resolveInheritance failed'));
    expect(mockWarn).not.toHaveBeenCalledWith(expect.stringContaining('graph DB unavailable'));
  });

  test('no match choices (create only): chain empty, resolved true, graph not consulted', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;
    searchState.choices = [{
      uri: 'squadrules://adapter/new-thing',
      label: 'Create new',
      adapter_name: null,
      score: null,
      role: 'create',
      tags: [],
      next_action: 'create it',
      adapter_version: null,
      space_name: null,
      slug: null
    }];

    const { executeActivate } = await import('../../src/tools/activate.js');
    const { memoryStore, qdrantService } = makeStoreAndService('unused');

    const result = await executeActivate(memoryStore, qdrantService, { query: 'test' });

    expect(result.inheritance_chain).toEqual([]);
    expect(result.inheritance_resolved).toBe(true);
    expect(mockResolveInheritance).not.toHaveBeenCalled();
    expect(mockResolveEffectiveLayerContent).not.toHaveBeenCalled();
  });
});
