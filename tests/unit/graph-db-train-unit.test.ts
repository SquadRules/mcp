/**
 * Graph projection on the train path (Touchpoint 3) — unit suite.
 *
 * Honest naming: the graph is a DOUBLE. These tests assert the ORDERING and SCOPE
 * CONTRACT of `executeTrainStore`'s projection calls, not that LadybugDB/LanceDB behave.
 * Real-database evidence (nodes before edges, failed node write, history rows, rebuild)
 * lives in tests/integration/graph-db-*.test.ts.
 *
 * Covers:
 *   - graph-db-unavailable still allows the memory write to succeed
 *   - the projection reads the STORED head record (not authoring markdown) and keys the
 *     node by the tenant write scope
 *   - parent resolution/edge write use the same scope the write used
 *   - a failed memory write projects no node; a failed node write never fails train
 *   - validation failures reject BEFORE the memory write
 *   - parent_missing is a warning, not an error
 *
 * Doubles live in `graph-db-train-unit-harness.ts`; validator rules and the MCP response
 * surface are covered by `adapter-inheritance-validators.test.ts` and
 * `graph-db-train-response.test.ts` after the 350-line split.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  graphState,
  layerRecord,
  makeAdapterStore,
  markdownWithFrontmatterLines,
  mockGetAdapter,
  mockUpsertAdapterFromFrontmatter,
  mockWarn,
  mockWriteInheritanceEdges,
  readWriteSpace,
  registerMocks,
  resetTrainDoubles,
  storedHead,
  validMarkdown
} from './graph-db-train-unit-harness.js';

describe('train-store graph projection (Touchpoint 3, unit)', () => {
  beforeEach(() => {
    resetTrainDoubles();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('graph-db unavailable: memory write still succeeds and nothing is projected', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;

    const { executeTrainStore } = await import('../../src/tools/train-store.js');
    const store = makeAdapterStore({
      head: storedHead({ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', slug: 'test-adapter' })
    });

    const result = await executeTrainStore(
      store as any,
      { content: validMarkdown(), llm_model_id: 'test-model' } as any,
      async (fn: any) => fn()
    );

    expect(result.status).toBe('stored');
    expect(result.items).toHaveLength(1);
    expect(store.storeAdapter).toHaveBeenCalledTimes(1);
    expect(mockUpsertAdapterFromFrontmatter).not.toHaveBeenCalled();
  });

  test('projection reads the stored head record and keys the node by the write scope', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;
    mockUpsertAdapterFromFrontmatter.mockResolvedValue(undefined);

    const writeSpace = await readWriteSpace();
    expect(writeSpace.length).toBeGreaterThan(0);

    const { executeTrainStore } = await import('../../src/tools/train-store.js');
    const head = storedHead({
      uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      slug: 'test-adapter',
      version: '1.0.0',
      spaceId: writeSpace,
      // Topology as persisted by storeAdapter — the projection's only source.
      frontmatter: {
        slug: 'test-adapter',
        version: '1.0.0',
        inherits: 'parent-adapter',
        override: ['tags']
      }
    });
    const parentRecord = layerRecord('parent-layer-uuid', {
      slug: 'parent-adapter',
      space_id: writeSpace,
      adapter: {
        id: 'parent-adapter-id',
        name: 'parent-adapter',
        layer_index: 1,
        layer_count: 1,
        frontmatter: { slug: 'parent-adapter', version: '2.0.0', tags: ['review'] }
      }
    });
    const store = makeAdapterStore({ head, scrollRecords: [parentRecord] });

    // Parent lookup resolves in the child's own scope first.
    mockGetAdapter.mockImplementation(async (key: string) =>
      key === `adapter:${writeSpace}:parent-adapter` ? { key } : null
    );
    mockWriteInheritanceEdges.mockResolvedValue(`adapter:${writeSpace}:parent-adapter`);

    const result = await executeTrainStore(
      store as any,
      { content: validMarkdown({ frontmatter: ['inherits: parent-adapter', 'override: [tags]'] }), llm_model_id: 'test-model' } as any,
      async (fn: any) => fn()
    );

    expect(result.status).toBe('stored');

    // Validation ran against the parent frontmatter that is actually stored.
    expect(store.scrollSpace).toHaveBeenCalledWith(writeSpace, { paginate: true });

    // Two nodes are projected: the stored parent snapshot first, then the child. Without
    // the parent node the child's edge has nothing to link to, so the order is the
    // contract — a parent trained a moment ago is discoverable without a reboot.
    expect(mockUpsertAdapterFromFrontmatter).toHaveBeenCalledTimes(2);
    expect(mockUpsertAdapterFromFrontmatter.mock.calls[0]?.[0]).toBe('parent-adapter');
    expect(mockUpsertAdapterFromFrontmatter.mock.calls[1]?.[0]).toBe('test-adapter');
    expect(mockUpsertAdapterFromFrontmatter).toHaveBeenCalledWith(
      'test-adapter',
      '1.0.0',
      expect.objectContaining({ inherits: 'parent-adapter', override: ['tags'] }),
      expect.objectContaining({ spaceId: writeSpace })
    );

    // Edge written against the same scope the node was keyed with.
    expect(mockWriteInheritanceEdges).toHaveBeenCalledWith(
      `adapter:${writeSpace}:test-adapter`,
      expect.objectContaining({ inherits: 'parent-adapter' }),
      { parentSpaceId: writeSpace }
    );
    // The read-back is fresh, so the projection never projects unpersisted data.
    expect(store.getMemory).toHaveBeenCalledWith(head.memory_uuid, { fresh: true });
  });

  test('failed memory write: no graph node is projected', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;

    const { executeTrainStore } = await import('../../src/tools/train-store.js');
    const store = makeAdapterStore({ storeError: new Error('vector store write failed') });

    await expect(
      executeTrainStore(
        store as any,
        { content: validMarkdown(), llm_model_id: 'test-model' } as any,
        async (fn: any) => fn()
      )
    ).rejects.toThrow(/vector store write failed/);

    expect(mockUpsertAdapterFromFrontmatter).not.toHaveBeenCalled();
    expect(mockWriteInheritanceEdges).not.toHaveBeenCalled();
  });

  test('graph node write failure does not propagate (logged and continues)', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = true;
    mockUpsertAdapterFromFrontmatter.mockRejectedValue(new Error('LadybugDB: disk full'));

    const { executeTrainStore } = await import('../../src/tools/train-store.js');
    const store = makeAdapterStore({
      head: storedHead({
        uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        slug: 'test-adapter',
        frontmatter: { slug: 'test-adapter', version: '1.0.0', inherits: 'parent-adapter' }
      })
    });

    const result = await executeTrainStore(
      store as any,
      {
        content: validMarkdown({ frontmatter: ['inherits: parent-adapter'] }),
        llm_model_id: 'test-model'
      } as any,
      async (fn: any) => fn()
    );

    expect(result.status).toBe('stored');
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('node write failed'));
    // No edge is written for a node that did not land.
    expect(mockWriteInheritanceEdges).not.toHaveBeenCalled();
  });

  test('structural_override_forbidden fails the tool call BEFORE memory write', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;

    const { executeTrainStore } = await import('../../src/tools/train-store.js');
    const store = makeAdapterStore({});

    const invalidMarkdown = markdownWithFrontmatterLines('bad-adapter', [
      'inherits: critic-loop',
      'override: [contract, tags]'
    ]);

    await expect(
      executeTrainStore(
        store as any,
        { content: invalidMarkdown, llm_model_id: 'test-model' } as any,
        async (fn: any) => fn()
      )
    ).rejects.toThrow(/structural_override_forbidden/);

    expect(store.storeAdapter).not.toHaveBeenCalled();
  });

  test('single_parent array inherits fails BEFORE memory write', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;

    const { executeTrainStore } = await import('../../src/tools/train-store.js');
    const store = makeAdapterStore({});

    const invalidMarkdown = markdownWithFrontmatterLines('bad-adapter', [
      'inherits: [parent-a, parent-b]'
    ]);

    await expect(
      executeTrainStore(
        store as any,
        { content: invalidMarkdown, llm_model_id: 'test-model' } as any,
        async (fn: any) => fn()
      )
    ).rejects.toThrow(/single_parent/);

    expect(store.storeAdapter).not.toHaveBeenCalled();
  });

  test('parent_missing produces a warning in the output, not an error', async () => {
    jest.resetModules();
    registerMocks();
    graphState.available = false;

    const { executeTrainStore } = await import('../../src/tools/train-store.js');
    const store = makeAdapterStore({
      head: storedHead({ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', slug: 'child-adapter', name: 'Child Adapter' }),
      // No stored parent anywhere in the candidate spaces.
      scrollRecords: []
    });

    const result = await executeTrainStore(
      store as any,
      {
        content: validMarkdown({ slug: 'child-adapter', frontmatter: ['inherits: nonexistent-parent', 'override: [tags]'] }),
        llm_model_id: 'test-model'
      } as any,
      async (fn: any) => fn()
    );

    expect(result.status).toBe('stored');
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings![0]!.code).toBe('parent_missing');
  });
});
