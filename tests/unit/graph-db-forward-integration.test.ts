/**
 * Unit tests for Touchpoint 2b: forward executes the MERGED (inheritance-resolved)
 * adapter content instead of the raw child.
 *
 * The inheritance logic forward relies on lives in `src/tools/adapter-effective-content.ts`
 * (`resolveEffectiveLayerContent` + `applyEffectiveContent` + `buildMergedAdapterContent`).
 * `forward.ts` wires it in with two lines: resolve, then substitute the executable payload
 * onto the child memory before rendering. These tests cover the required scenarios:
 *
 *   - Forward with no inheritance: raw adapter used, works as before
 *   - Forward with inheritance: merged contract blocks executed (parent's steps used when
 *     the child does not — and structurally may not — override them)
 *   - Forward with override: child's overridden fields used, parent's non-overridden used
 *   - Forward when graph DB unavailable: raw adapter used, warning logged
 *   - Multi-level inheritance: grandparent -> parent -> child merge order correct
 *
 * The helper takes the memory store and retrieval surface as parameters, so only the graph
 * DB singleton and the structured logger need module mocks. Mocking strategy mirrors the
 * established pattern: `jest.resetModules()` + both `jest.doMock()` and
 * `jest.unstable_mockModule()`.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import type { Memory } from '../../src/types/memory.js';
// Pure modules with no runtime dependencies on the mocked graph DB / logger.
import { extractMemoryBody } from '../../src/utils/memory-body.js';
import { getInferenceContract, getLayerIndex } from '../../src/services/memory/memory-accessors.js';
import type { ResolvedInheritance, AdapterNode } from '../../src/services/graph-db/graph-database.service.js';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

const mockWarn = jest.fn();
const mockDebug = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();

/** Whether the graph singleton returns an initialized service. */
let graphDbAvailable = false;
const mockResolveInheritance = jest.fn<any>();

function graphDbSingletonFactory() {
  return {
    getGraphDbService: () => {
      if (!graphDbAvailable) return null;
      return {
        isInitialized: () => true,
        resolveInheritance: mockResolveInheritance
      };
    },
    initGraphDb: jest.fn<any>(),
    closeGraphDb: jest.fn<any>()
  };
}

function loggerFactory() {
  const loggerDouble = {
    debug: mockDebug,
    info: mockInfo,
    warn: mockWarn,
    error: mockError
  };
  return {
    structuredLogger: loggerDouble,
    logger: loggerDouble,
    writeAuditLine: jest.fn<any>()
  };
}

function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-db-singleton.js', graphDbSingletonFactory);
  jest.doMock('../../src/services/graph-db/graph-db-singleton.js', graphDbSingletonFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHILD_UUID = 'child-layer-uuid';
const PARENT_UUID = 'parent-layer-uuid';
const GRANDPARENT_UUID = 'grandparent-layer-uuid';

/** A shell contract block as it appears in an adapter's markdown body. */
function shellContractMarkdown(cmd: string): string {
  return [
    '# Inherited Steps',
    '',
    'Run the inherited verification step from the parent adapter.',
    '',
    '```json',
    JSON.stringify({
      contract: {
        type: 'shell',
        required: true,
        shell: { cmd, timeout_seconds: 30, interpreter: 'bash' }
      }
    }),
    '```'
  ].join('\n');
}

function makeMemory(opts: {
  uuid: string;
  slug: string;
  text: string;
  layerIndex?: number;
  adapterId?: string;
  protocolVersion?: string;
  contract?: Memory['inference_contract'];
}): Memory {
  return {
    memory_uuid: opts.uuid,
    label: opts.slug,
    slug: opts.slug,
    tags: [],
    text: opts.text,
    llm_model_id: 'test-model',
    created_at: '2026-01-01T00:00:00Z',
    adapter: {
      id: opts.adapterId ?? opts.uuid,
      name: opts.slug,
      layer_index: opts.layerIndex ?? 1,
      layer_count: 1,
      ...(opts.protocolVersion ? { protocol_version: opts.protocolVersion } : {})
    },
    ...(opts.contract ? { inference_contract: opts.contract } : {})
  };
}

/** Child adapter that inherits `steps`: its own body has NO contract block. */
function makeChildMemory(slug = 'child-adapter'): Memory {
  return makeMemory({
    uuid: CHILD_UUID,
    slug,
    text: '# Child Adapter\n\nThis child inherits its steps from the parent.',
    protocolVersion: '1.0.0'
    // no inference_contract — the child did not (and may not) override steps
  });
}

function makeParentMemory(slug = 'parent-adapter'): Memory {
  return makeMemory({
    uuid: PARENT_UUID,
    slug,
    adapterId: 'parent-adapter-id',
    text: shellContractMarkdown('echo parent-step'),
    protocolVersion: '2.0.0',
    contract: {
      type: 'shell',
      required: true,
      shell: { cmd: 'echo parent-step', timeout_seconds: 30, interpreter: 'bash' }
    }
  });
}

function makeGrandparentMemory(slug = 'grandparent-adapter'): Memory {
  return makeMemory({
    uuid: GRANDPARENT_UUID,
    slug,
    adapterId: 'grandparent-adapter-id',
    text: shellContractMarkdown('echo grandparent-step'),
    protocolVersion: '3.0.0',
    contract: {
      type: 'shell',
      required: true,
      shell: { cmd: 'echo grandparent-step', timeout_seconds: 60, interpreter: 'sh' }
    }
  });
}

function adapterNode(slug: string, version = '1.0.0'): AdapterNode {
  return {
    key: `adapter:${slug}`,
    type: 'adapter',
    slug,
    version,
    title: slug,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  };
}

/**
 * Build a ResolvedInheritance whose `inheritance_chain` is sorted deepest-first
 * (root first), matching GraphDatabaseService.resolveInheritance.
 */
function makeResolved(
  childSlug: string,
  ancestorSlugsNearestFirst: string[],
  resolvedProperties: Record<string, any> = {}
): ResolvedInheritance {
  // deepest-first = reverse of nearest-first
  const chainDeepestFirst = [...ancestorSlugsNearestFirst].reverse().map((s) => adapterNode(s));
  return {
    adapter: adapterNode(childSlug),
    resolved_properties: { ...adapterNode(childSlug), ...resolvedProperties },
    inheritance_chain: chainDeepestFirst
  };
}

/** Mock memory store + retrieval surface backed by an in-memory map. */
function makeStores(memories: Record<string, Memory>, slugToUuid: Record<string, string>) {
  const memoryStore = {
    getMemory: jest.fn<any>().mockImplementation(async (uuid: string) => memories[uuid] ?? null)
  };
  const qdrantService = {
    findFirstStepMemoryUuidBySlug: jest.fn<any>().mockImplementation(async (slug: string) => ({
      layerUuid: slugToUuid[slug] ?? null
    })),
    getAdapterLayers: jest.fn<any>().mockImplementation(async (adapterId: string) => {
      // Return the single layer belonging to this adapter id, at layer_index 1.
      const match = Object.values(memories).find((m) => m.adapter?.id === adapterId);
      if (!match) return [];
      return [{ uuid: match.memory_uuid, payload: { adapter: { layer_index: match.adapter?.layer_index ?? 1 } } }];
    })
  };
  return { memoryStore: memoryStore as any, qdrantService: qdrantService as any };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('forward merged-content resolution (Touchpoint 2b)', () => {
  beforeEach(() => {
    graphDbAvailable = false;
    mockResolveInheritance.mockReset();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockInfo.mockClear();
    mockError.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('no inheritance: raw child adapter used, no substitution', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;

    const child = makeChildMemory('standalone-adapter');
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child },
      { 'standalone-adapter': CHILD_UUID }
    );
    // Chain of one: no ancestors.
    mockResolveInheritance.mockResolvedValue(makeResolved('standalone-adapter', []));

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child);
    expect(result.substitute).toBe(false);
    expect(result.resolved).toBe(true);
    expect(result.inheritance_chain).toEqual(['standalone-adapter']);

    // forward renders the raw child unchanged.
    const effective = applyEffectiveContent(child, result);
    expect(effective).toBe(child);
    expect(getInferenceContract(effective)).toBeUndefined();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  test('with inheritance: parent contract blocks executed, child identity preserved', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;

    const child = makeChildMemory('child-adapter');
    const parent = makeParentMemory('parent-adapter');
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child, [PARENT_UUID]: parent },
      { 'child-adapter': CHILD_UUID, 'parent-adapter': PARENT_UUID }
    );
    mockResolveInheritance.mockResolvedValue(makeResolved('child-adapter', ['parent-adapter']));

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child);
    expect(result.substitute).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.inheritance_chain).toEqual(['child-adapter', 'parent-adapter']);

    // This is the memory forward renders/executes.
    const effective = applyEffectiveContent(child, result);

    // Executable payload comes from the PARENT (inherited steps + contract block).
    expect(extractMemoryBody(effective.text)).toContain('echo parent-step');
    const contract = getInferenceContract(effective);
    expect(contract?.type).toBe('shell');
    expect(contract?.shell?.cmd).toBe('echo parent-step');
    expect(contract?.shell?.interpreter).toBe('bash');

    // Identity stays the CHILD's — the agent activated the child.
    expect(effective.memory_uuid).toBe(CHILD_UUID);
    expect(effective.slug).toBe('child-adapter');
    expect(effective.adapter?.id).toBe(CHILD_UUID);
    expect(effective.adapter?.protocol_version).toBe('1.0.0');
    expect(getLayerIndex(effective)).toBe(1);
  });

  test('with override: child overridden fields used, parent non-overridden content used', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;

    const child = makeChildMemory('child-adapter');
    const parent = makeParentMemory('parent-adapter');
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child, [PARENT_UUID]: parent },
      { 'child-adapter': CHILD_UUID, 'parent-adapter': PARENT_UUID }
    );
    // The child overrides `tags`/`title` (frontmatter), but `steps`/`contract` are
    // structurally forbidden from override, so executable content still comes from parent.
    mockResolveInheritance.mockResolvedValue(
      makeResolved('child-adapter', ['parent-adapter'], {
        tags: ['child-tag'],
        title: 'Child Title',
        version: '2.0.0',
        layer_count: 5
      })
    );

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child);
    expect(result.substitute).toBe(true);

    // Merged frontmatter properties carry the override semantics resolved by the graph.
    expect(result.resolved_properties?.['tags']).toEqual(['child-tag']);
    expect(result.resolved_properties?.['title']).toBe('Child Title');
    // Non-overridden fields come from the parent.
    expect(result.resolved_properties?.['version']).toBe('2.0.0');
    expect(result.resolved_properties?.['layer_count']).toBe(5);

    // Executable content (steps forbidden from override) comes from the parent.
    const effective = applyEffectiveContent(child, result);
    expect(getInferenceContract(effective)?.shell?.cmd).toBe('echo parent-step');
    // Identity remains the child's.
    expect(effective.slug).toBe('child-adapter');
  });

  test('graph DB unavailable: raw adapter used, warning logged', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = false; // graceful degradation

    const child = makeChildMemory('child-adapter');
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child },
      { 'child-adapter': CHILD_UUID }
    );

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child);
    expect(result.substitute).toBe(false);
    expect(result.resolved).toBe(false);
    expect(result.inheritance_chain).toEqual([]);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('graph DB unavailable'));

    // forward falls back to the raw child exactly as before this touchpoint.
    const effective = applyEffectiveContent(child, result);
    expect(effective).toBe(child);
    expect(getInferenceContract(effective)).toBeUndefined();
  });

  test('resolveInheritance throws: graceful degradation, raw adapter used, warning logged', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;

    const child = makeChildMemory('child-adapter');
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child },
      { 'child-adapter': CHILD_UUID }
    );
    mockResolveInheritance.mockRejectedValue(new Error('DB connection lost'));

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child);
    expect(result.substitute).toBe(false);
    expect(result.resolved).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('resolveInheritance failed'));
    expect(applyEffectiveContent(child, result)).toBe(child);
  });

  test('multi-level inheritance: nearest ancestor with matching layer wins, chain order correct', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;

    const child = makeChildMemory('child-adapter');
    const parent = makeParentMemory('parent-adapter');
    const grandparent = makeGrandparentMemory('grandparent-adapter');
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child, [PARENT_UUID]: parent, [GRANDPARENT_UUID]: grandparent },
      {
        'child-adapter': CHILD_UUID,
        'parent-adapter': PARENT_UUID,
        'grandparent-adapter': GRANDPARENT_UUID
      }
    );
    // nearest-first ancestors: parent, then grandparent.
    mockResolveInheritance.mockResolvedValue(
      makeResolved('child-adapter', ['parent-adapter', 'grandparent-adapter'])
    );

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child);
    // Chain is child -> parent -> grandparent (child-to-root).
    expect(result.inheritance_chain).toEqual(['child-adapter', 'parent-adapter', 'grandparent-adapter']);
    expect(result.substitute).toBe(true);

    // The NEAREST ancestor (parent) supplies the executable content, not the grandparent.
    const effective = applyEffectiveContent(child, result);
    expect(getInferenceContract(effective)?.shell?.cmd).toBe('echo parent-step');
    expect(extractMemoryBody(effective.text)).toContain('echo parent-step');
    expect(effective.memory_uuid).toBe(CHILD_UUID);
  });

  test('multi-level: falls through to grandparent when parent has no matching layer', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;

    const child = makeChildMemory('child-adapter');
    const grandparent = makeGrandparentMemory('grandparent-adapter');
    // Parent exists in the graph chain but has NO stored layer content.
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child, [GRANDPARENT_UUID]: grandparent },
      {
        'child-adapter': CHILD_UUID,
        // 'parent-adapter' intentionally absent from slug map
        'grandparent-adapter': GRANDPARENT_UUID
      }
    );
    mockResolveInheritance.mockResolvedValue(
      makeResolved('child-adapter', ['parent-adapter', 'grandparent-adapter'])
    );

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child);
    expect(result.substitute).toBe(true);
    const effective = applyEffectiveContent(child, result);
    // Fell through parent (no content) to the grandparent.
    expect(getInferenceContract(effective)?.shell?.cmd).toBe('echo grandparent-step');
    expect(getInferenceContract(effective)?.shell?.interpreter).toBe('sh');
  });

  test('ancestor with no contract clears child contract (full payload substitution)', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;

    // Child happens to carry a contract, but the effective ancestor layer has none.
    const child = makeMemory({
      uuid: CHILD_UUID,
      slug: 'child-adapter',
      text: '# Child\n\nchild body',
      contract: { type: 'comment', required: true, comment: { min_length: 1 } }
    });
    const parent = makeMemory({
      uuid: PARENT_UUID,
      slug: 'parent-adapter',
      adapterId: 'parent-adapter-id',
      text: '# Parent\n\nparent body with no contract block'
      // no contract
    });
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child, [PARENT_UUID]: parent },
      { 'child-adapter': CHILD_UUID, 'parent-adapter': PARENT_UUID }
    );
    mockResolveInheritance.mockResolvedValue(makeResolved('child-adapter', ['parent-adapter']));

    const { resolveEffectiveLayerContent, applyEffectiveContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child);
    expect(result.substitute).toBe(true);
    const effective = applyEffectiveContent(child, result);
    // Parent body replaces child body; parent has no contract so the child's is removed.
    expect(extractMemoryBody(effective.text)).toContain('parent body with no contract block');
    expect(getInferenceContract(effective)).toBeUndefined();
    expect('inference_contract' in effective).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// activate surfacing (Option A): buildMergedAdapterContent
// ---------------------------------------------------------------------------

describe('activate merged-content surfacing (Touchpoint 2b, Option A)', () => {
  beforeEach(() => {
    graphDbAvailable = false;
    mockResolveInheritance.mockReset();
    mockWarn.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('merged content carries child identity and parent executable body', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;

    const child = makeChildMemory('child-adapter');
    const parent = makeParentMemory('parent-adapter');
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child, [PARENT_UUID]: parent },
      { 'child-adapter': CHILD_UUID, 'parent-adapter': PARENT_UUID }
    );
    mockResolveInheritance.mockResolvedValue(makeResolved('child-adapter', ['parent-adapter']));

    const { resolveEffectiveLayerContent, buildMergedAdapterContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child, 'activate');
    const merged = buildMergedAdapterContent(child, result);

    // Identity is the child's.
    expect(merged.slug).toBe('child-adapter');
    expect(merged.version).toBe('1.0.0');
    // Content is the effective (parent) body, BODY markers stripped, contract block included.
    expect(merged.content).toContain('echo parent-step');
    expect(merged.content).toContain('"contract"');
    expect(merged.inheritance_chain).toEqual(['child-adapter', 'parent-adapter']);
    expect(merged.resolved).toBe(true);
  });

  test('merged content falls back to child body when graph DB unavailable', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = false;

    const child = makeChildMemory('child-adapter');
    const { memoryStore, qdrantService } = makeStores(
      { [CHILD_UUID]: child },
      { 'child-adapter': CHILD_UUID }
    );

    const { resolveEffectiveLayerContent, buildMergedAdapterContent } = await import(
      '../../src/tools/adapter-effective-content.js'
    );

    const result = await resolveEffectiveLayerContent(memoryStore, qdrantService, child, 'activate');
    const merged = buildMergedAdapterContent(child, result);

    expect(merged.slug).toBe('child-adapter');
    expect(merged.content).toContain('This child inherits its steps from the parent.');
    expect(merged.resolved).toBe(false);
    expect(merged.inheritance_chain).toEqual([]);
  });
});
