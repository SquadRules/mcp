/**
 * Unit tests for Touchpoint 5: delete refuses when inheritance dependents exist.
 *
 * Covers:
 *   - Delete succeeds when no dependents
 *   - Delete refused with correct error message when dependents exist
 *   - Delete succeeds when graph DB is unavailable (graceful degradation)
 *   - Delete succeeds when getChildren throws (graceful degradation)
 *   - No cascade: dependents are NOT modified when delete is refused
 *
 * Mocking strategy: `jest.resetModules()` + both `jest.doMock()` and
 * `jest.unstable_mockModule()` per the established pattern (commit 11293c62).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockWarn = jest.fn();
const mockDebug = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();

/** Track whether the graph singleton returns null (unavailable). */
let graphDbAvailable = false;

const mockGetChildren = jest.fn<any>();
// Methods that MUST NOT be called on the delete-refusal path (no cascade).
const mockRemoveInheritanceEdges = jest.fn<any>();
const mockUpsertAdapterNode = jest.fn<any>();
const mockCreateAdapterNode = jest.fn<any>();
const mockWriteAdapterFromFrontmatter = jest.fn<any>();

function graphDbSingletonFactory() {
  return {
    getGraphDbService: () => {
      if (!graphDbAvailable) return null;
      return {
        isInitialized: () => true,
        getChildren: mockGetChildren,
        removeInheritanceEdges: mockRemoveInheritanceEdges,
        upsertAdapterNode: mockUpsertAdapterNode,
        createAdapterNode: mockCreateAdapterNode,
        writeAdapterFromFrontmatter: mockWriteAdapterFromFrontmatter
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
  const tenantFactory = () => ({
    getTenantId: () => 'test-tenant',
    getSpaceContext: () => ({ space: 'personal' })
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
  jest.unstable_mockModule('../../src/services/graph-db/graph-db-singleton.js', graphDbSingletonFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/services/graph-db/graph-db-singleton.js', graphDbSingletonFactory);
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
      adapter: { id: 'adapter-id-123' }
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
    mockRemoveInheritanceEdges.mockReset();
    mockUpsertAdapterNode.mockReset();
    mockCreateAdapterNode.mockReset();
    mockWriteAdapterFromFrontmatter.mockReset();
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
    expect(mockGetChildren).toHaveBeenCalledWith('parent-adapter');
    expect(qdrant.deleteMemory).toHaveBeenCalled();
  });

  test('delete refused with correct error message when dependents exist', async () => {
    jest.resetModules();
    registerMocks();
    deleteHeavyDepMocks();
    graphDbAvailable = true;
    mockGetChildren.mockResolvedValue(['child-alpha', 'child-beta']);

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

  test('no cascade: dependents are NOT modified when delete is refused', async () => {
    jest.resetModules();
    registerMocks();
    deleteHeavyDepMocks();
    graphDbAvailable = true;
    mockGetChildren.mockResolvedValue(['child-one', 'child-two', 'child-three']);

    const { executeDelete } = await import('../../src/tools/delete.js');
    const qdrant = makeQdrantService();

    const result = await executeDelete(qdrant as any, { uris: [ADAPTER_URI] });

    expect(result.total_failed).toBe(1);
    expect(result.results[0]!.status).toBe('error');
    // No mutation of the graph: no cascade, no edge removal, no adapter rewrites
    expect(mockRemoveInheritanceEdges).not.toHaveBeenCalled();
    expect(mockUpsertAdapterNode).not.toHaveBeenCalled();
    expect(mockCreateAdapterNode).not.toHaveBeenCalled();
    expect(mockWriteAdapterFromFrontmatter).not.toHaveBeenCalled();
    // No qdrant deletion either
    expect(qdrant.deleteMemory).not.toHaveBeenCalled();
    expect(qdrant.findFirstStepMemoryUuidBySlug).not.toHaveBeenCalled();
  });
});
