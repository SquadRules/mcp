/**
 * UNIT tests (mocked graph) for the delete inheritance precondition.
 *
 * These are unit tests, not integration tests: `delete` is exercised with a fake
 * graph object supplied through the same seam production uses
 * (`graph-owner.getGraphDb`). The behaviour they pin:
 *
 *   - delete succeeds when no dependents exist
 *   - delete is refused, with a message naming the dependents, when they do
 *   - a dependent stored in another space is named with that space, because the same
 *     slug in two spaces is two different adapters
 *   - delete succeeds when the store has no graph (graceful degradation)
 *   - delete succeeds when `getChildren` throws (graceful degradation)
 *   - no cascade: dependents are not modified when delete is refused
 *   - the graph lookup is scoped by the stored record's own space
 *
 * The mock-free counterpart that uses a real LadybugDB is
 * `tests/integration/graph-db-instance-isolation.test.ts`.
 *
 * Mocking strategy: `jest.resetModules()` + both `jest.doMock()` and
 * `jest.unstable_mockModule()` per the established pattern (commit 11293c62).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockWarn = jest.fn();
const mockDebug = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();

/** Whether the store under test has a graph attached to it. */
let graphDbAvailable = false;

/** Space the stored record lives in — the scope the graph lookup must use. */
const STORED_SPACE = 'space:unit-personal';
/** Space of a dependent adapter that lives outside the parent's scope. */
const FOREIGN_SPACE = 'group:unit-team';

/** Scoped child identity, the shape `getChildren` returns. */
function childRef(slug: string, space: string) {
  return { key: `adapter:${space}:${slug}`, slug, space };
}

const mockGetChildren = jest.fn<any>();
// Methods that MUST NOT be called on the delete-refusal path (no cascade).
const mockClearInheritanceEdges = jest.fn<any>();
const mockUpsertAdapterNode = jest.fn<any>();
const mockCreateAdapterNode = jest.fn<any>();
const mockUpsertAdapterFromFrontmatter = jest.fn<any>();

/**
 * Fake of the graph the runtime attaches to a store. `getGraphDb` is the seam
 * `delete` uses, so the fake is reached exactly the way the real graph is.
 */
function graphOwnerFactory() {
  return {
    getGraphDb: () => {
      if (!graphDbAvailable) return null;
      return {
        isInitialized: () => true,
        getChildren: mockGetChildren,
        clearInheritanceEdges: mockClearInheritanceEdges,
        upsertAdapterNode: mockUpsertAdapterNode,
        createAdapterNode: mockCreateAdapterNode,
        upsertAdapterFromFrontmatter: mockUpsertAdapterFromFrontmatter
      };
    },
    attachGraphDb: jest.fn<any>(),
    detachGraphDb: jest.fn<any>()
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

/**
 * Stub heavy transitive dependencies that cannot be require()'d from CJS test context.
 * delete.ts imports qdrant/index.js → service.ts → memory-store.ts → qdrant-metrics.ts
 * → registry.ts → build-version.ts (ESM-only). We stub the qdrant index and metrics
 * to break the chain.
 */
function deleteHeavyDepMocks(): void {
  const qdrantIndexFactory = () => ({
    qdrantService: {} as any
  });
  const metricsFactory = () => ({
    mcpToolCalls: { inc: jest.fn<any>() },
    mcpToolDuration: { startTimer: jest.fn<any>(() => jest.fn<any>()) },
    mcpToolErrors: { inc: jest.fn<any>() },
    mcpToolInputSize: { observe: jest.fn<any>() },
    mcpToolOutputSize: { observe: jest.fn<any>() }
  });
  const toolDocFactory = () => ({
    resolveToolDoc: () => undefined
  });
  // Scope resolution reads the tenant context, so the fake context carries the
  // same space the stored record is written in.
  const tenantFactory = () => ({
    getTenantId: () => 'test-tenant',
    getSpaceContext: () => ({ space: 'personal' }),
    getSpaceContextFromStorage: () => ({
      userId: 'test-user',
      groupIds: [],
      allowedSpaceIds: [STORED_SPACE],
      defaultWriteSpaceId: STORED_SPACE,
      personalSpaceId: STORED_SPACE,
      spaceNamesById: {},
      requestId: 'unit'
    })
  });
  jest.unstable_mockModule('../../src/services/qdrant/index.js', qdrantIndexFactory);
  jest.doMock('../../src/services/qdrant/index.js', qdrantIndexFactory);
  jest.unstable_mockModule('../../src/services/metrics/mcp-metrics.js', metricsFactory);
  jest.doMock('../../src/services/metrics/mcp-metrics.js', metricsFactory);
  jest.unstable_mockModule('../../src/utils/mcp-tool-doc-runtime.js', toolDocFactory);
  jest.doMock('../../src/utils/mcp-tool-doc-runtime.js', toolDocFactory);
  jest.unstable_mockModule('../../src/utils/tenant-context.js', tenantFactory);
  jest.doMock('../../src/utils/tenant-context.js', tenantFactory);
}

function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
}

function makeQdrantService(opts?: { slugFound?: boolean; layers?: any[] }) {
  const slugFound = opts?.slugFound ?? true;
  const layers = opts?.layers ?? [{ uuid: 'layer-uuid-1' }];
  return {
    findFirstStepMemoryUuidBySlug: jest.fn<any>().mockResolvedValue(
      slugFound ? { layerUuid: 'first-layer-uuid' } : { layerUuid: null }
    ),
    getMemoryByUUID: jest.fn<any>().mockResolvedValue({
      adapter: { id: 'adapter-id-123' },
      space_id: STORED_SPACE
    }),
    getAdapterLayers: jest.fn<any>().mockResolvedValue(layers),
    deleteMemory: jest.fn<any>().mockResolvedValue(undefined)
  };
}

const ADAPTER_URI = 'squadrules://adapter/parent-adapter';

describe('delete inheritance precondition (Touchpoint 5)', () => {
  beforeEach(() => {
    graphDbAvailable = false;
    mockGetChildren.mockReset();
    mockClearInheritanceEdges.mockReset();
    mockUpsertAdapterNode.mockReset();
    mockCreateAdapterNode.mockReset();
    mockUpsertAdapterFromFrontmatter.mockReset();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockInfo.mockClear();
    mockError.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('delete succeeds when no dependents exist (empty children list)', async () => {
    jest.resetModules();
    registerMocks();
    deleteHeavyDepMocks();
    graphDbAvailable = true;
    mockGetChildren.mockResolvedValue([]);

    const { executeDelete } = await import('../../src/tools/delete.js');
    const qdrant = makeQdrantService();

    const result = await executeDelete(qdrant as any, { uris: [ADAPTER_URI] });

    expect(result.total_deleted).toBe(1);
    expect(result.total_failed).toBe(0);
    expect(result.results[0]!.status).toBe('deleted');
    expect(mockGetChildren).toHaveBeenCalledWith(STORED_SPACE, 'parent-adapter');
    expect(qdrant.deleteMemory).toHaveBeenCalled();
  });

  test('delete refused with correct error message when dependents exist', async () => {
    jest.resetModules();
    registerMocks();
    deleteHeavyDepMocks();
    graphDbAvailable = true;
    mockGetChildren.mockResolvedValue([childRef('child-alpha', STORED_SPACE), childRef('child-beta', STORED_SPACE)]);

    const { executeDelete } = await import('../../src/tools/delete.js');
    const qdrant = makeQdrantService();

    const result = await executeDelete(qdrant as any, { uris: [ADAPTER_URI] });

    expect(result.total_deleted).toBe(0);
    expect(result.total_failed).toBe(1);
    expect(result.results[0]!.status).toBe('error');
    expect(result.results[0]!.message).toBe(
      "Cannot delete adapter 'parent-adapter': 2 adapter(s) inherit from it: child-alpha, child-beta. Remove or reparent the dependents first."
    );
    // Qdrant delete must NOT have been called
    expect(qdrant.deleteMemory).not.toHaveBeenCalled();
  });

  test('delete succeeds when graph DB is unavailable (graceful degradation)', async () => {
    jest.resetModules();
    registerMocks();
    deleteHeavyDepMocks();
    graphDbAvailable = false;

    const { executeDelete } = await import('../../src/tools/delete.js');
    const qdrant = makeQdrantService();

    const result = await executeDelete(qdrant as any, { uris: [ADAPTER_URI] });

    expect(result.total_deleted).toBe(1);
    expect(result.total_failed).toBe(0);
    expect(result.results[0]!.status).toBe('deleted');
    // Warning logged about graph DB unavailability
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('graph DB unavailable')
    );
    expect(qdrant.deleteMemory).toHaveBeenCalled();
  });

  test('delete succeeds when getChildren throws (graceful degradation)', async () => {
    jest.resetModules();
    registerMocks();
    deleteHeavyDepMocks();
    graphDbAvailable = true;
    mockGetChildren.mockRejectedValue(new Error('LadybugDB: connection lost'));

    const { executeDelete } = await import('../../src/tools/delete.js');
    const qdrant = makeQdrantService();

    const result = await executeDelete(qdrant as any, { uris: [ADAPTER_URI] });

    expect(result.total_deleted).toBe(1);
    expect(result.total_failed).toBe(0);
    expect(result.results[0]!.status).toBe('deleted');
    // Warning logged about the graph check failure
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('inheritance precondition check failed')
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('LadybugDB: connection lost')
    );
    expect(qdrant.deleteMemory).toHaveBeenCalled();
  });

  test('a dependent in another space is named with its scope', async () => {
    jest.resetModules();
    registerMocks();
    deleteHeavyDepMocks();
    graphDbAvailable = true;
    mockGetChildren.mockResolvedValue([
      childRef('child-alpha', STORED_SPACE),
      childRef('child-beta', FOREIGN_SPACE)
    ]);

    const { executeDelete } = await import('../../src/tools/delete.js');
    const qdrant = makeQdrantService();

    const result = await executeDelete(qdrant as any, { uris: [ADAPTER_URI] });

    expect(result.results[0]!.status).toBe('error');
    // The same-scope dependent stays a bare slug; the foreign one carries its space,
    // because without it the operator would look in the parent's space and not find it.
    expect(result.results[0]!.message).toBe(
      `Cannot delete adapter 'parent-adapter': 2 adapter(s) inherit from it: child-alpha, ` +
        `child-beta (in ${FOREIGN_SPACE}). Dependents are stored in more than one scope; ` +
        'remove or reparent each dependent in its own scope first.'
    );
    expect(qdrant.deleteMemory).not.toHaveBeenCalled();
  });

  test('no cascade: dependents are NOT modified when delete is refused', async () => {
    jest.resetModules();
    registerMocks();
    deleteHeavyDepMocks();
    graphDbAvailable = true;
    mockGetChildren.mockResolvedValue([
      childRef('child-one', STORED_SPACE),
      childRef('child-two', STORED_SPACE),
      childRef('child-three', STORED_SPACE)
    ]);

    const { executeDelete } = await import('../../src/tools/delete.js');
    const qdrant = makeQdrantService();

    const result = await executeDelete(qdrant as any, { uris: [ADAPTER_URI] });

    expect(result.total_failed).toBe(1);
    expect(result.results[0]!.status).toBe('error');
    // No mutation of the graph: no cascade, no edge removal, no adapter rewrites
    expect(mockClearInheritanceEdges).not.toHaveBeenCalled();
    expect(mockUpsertAdapterNode).not.toHaveBeenCalled();
    expect(mockCreateAdapterNode).not.toHaveBeenCalled();
    expect(mockUpsertAdapterFromFrontmatter).not.toHaveBeenCalled();
    // No qdrant deletion either
    expect(qdrant.deleteMemory).not.toHaveBeenCalled();
    // The stored record is read first: its space_id is what scopes the graph lookup,
    // so the lookup cannot run against a guessed scope.
    expect(qdrant.findFirstStepMemoryUuidBySlug).toHaveBeenCalledTimes(1);
  });
});
