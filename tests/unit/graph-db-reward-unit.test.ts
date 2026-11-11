/**
 * UNIT tests (mocked graph) for reward anomaly bookkeeping.
 *
 * The graph is a fake supplied through `graph-owner.getGraphDb` — the same seam
 * production uses — so these are unit tests, not integration tests. They pin:
 *
 *   - anomaly written on failure (with parent inheritance -> routes_to parent)
 *   - routes_to falls back to the failing adapter when no inheritance
 *   - discovered_by falls back to the layer identity when resolution fails
 *   - no anomaly on success
 *   - an unattached graph still lets reward bookkeeping succeed (no throw)
 *   - createAnomaly failure is swallowed + warned (graceful degradation)
 *   - PROPOSAL-ONLY: no Adapter-rewrite method is ever called
 *   - the parent lookup is scoped by the stored record's own space
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

/** Space the stored record lives in — the scope every graph key must use. */
const STORED_SPACE = 'space:unit-personal';

const mockCreateAnomaly = jest.fn<any>();
const mockGetAdapter = jest.fn<any>();
// Adapter-rewrite methods: MUST never be called on the reward anomaly path.
const mockCreateAdapterNode = jest.fn<any>();
const mockUpsertAdapterNode = jest.fn<any>();
const mockUpsertAdapterFromFrontmatter = jest.fn<any>();

const mockGetResult = jest.fn<any>();

/** Fake graph reached through the production seam: `getGraphDb(store)`. */
function graphOwnerFactory() {
  return {
    getGraphDb: () => {
      if (!graphDbAvailable) return null;
      return {
        isInitialized: () => true,
        createAnomaly: mockCreateAnomaly,
        getAdapter: mockGetAdapter,
        createAdapterNode: mockCreateAdapterNode,
        upsertAdapterNode: mockUpsertAdapterNode,
        upsertAdapterFromFrontmatter: mockUpsertAdapterFromFrontmatter
      };
    },
    attachGraphDb: jest.fn<any>(),
    detachGraphDb: jest.fn<any>()
  };
}

function loggerFactory() {
  return {
    structuredLogger: {
      debug: mockDebug,
      info: mockInfo,
      warn: mockWarn,
      error: mockError
    },
    logger: {
      debug: mockDebug,
      info: mockInfo,
      warn: mockWarn,
      error: mockError
    }
  };
}

function proofStoreFactory() {
  return {
    MAX_RETRIES: 3,
    proofOfWorkStore: {
      getResult: mockGetResult
    }
  };
}

function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.unstable_mockModule('../../src/services/proof-of-work-store.js', proofStoreFactory);
  jest.doMock('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/services/proof-of-work-store.js', proofStoreFactory);
}

function makeQdrant(memory: unknown): any {
  return { getMemoryByUUID: jest.fn<any>().mockResolvedValue(memory) };
}

const LAYER_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const URI = `squadrules://layer/${LAYER_UUID}`;

describe('reward anomaly bookkeeping (unit, mocked graph)', () => {
  beforeEach(() => {
    graphDbAvailable = false;
    mockCreateAnomaly.mockReset();
    mockGetAdapter.mockReset();
    mockCreateAdapterNode.mockReset();
    mockUpsertAdapterNode.mockReset();
    mockUpsertAdapterFromFrontmatter.mockReset();
    mockGetResult.mockReset();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockInfo.mockClear();
    mockError.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('writes an anomaly on failure and routes_to the parent when inheritance is involved', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    mockCreateAnomaly.mockResolvedValue(undefined);
    mockGetAdapter.mockResolvedValue({ frontmatter: { inherits: 'parent-adapter' } });
    mockGetResult.mockResolvedValue({ status: 'failed', shell: { exit_code: 2 } });

    const { recordRewardAnomaly } = await import('../../src/tools/reward-anomaly.js');
    const qdrant = makeQdrant({ slug: 'failing-adapter', space_id: STORED_SPACE });

    await recordRewardAnomaly(qdrant, {
      uri: URI,
      layerUuid: LAYER_UUID,
      outcome: 'failure',
      feedback: 'gate did not pass'
    });

    expect(mockCreateAnomaly).toHaveBeenCalledTimes(1);
    const node = mockCreateAnomaly.mock.calls[0]![0] as Record<string, any>;
    expect(node.type).toBe('Anomaly');
    expect(node.discovered_by).toBe('failing-adapter');
    expect(node.routes_to).toBe('parent-adapter');
    expect(node.anomaly_type).toBe('failure');
    expect(node.status).toBe('open');
    expect(node.severity).toBe('high');
    expect(node.key).toMatch(/^anomaly:/);
    expect(typeof node.created_at).toBe('string');
    expect(node.description).toContain('gate did not pass');
    expect(node.description).toContain('exit_code 2');
    // Read-only parent lookup only, keyed by the stored record's own space.
    expect(mockGetAdapter).toHaveBeenCalledWith(`adapter:${STORED_SPACE}:failing-adapter`);
    // The row carries the scope it was written in, the exact target `routes_to` names and
    // the claim it reports, so a scoped frequency count can tell this row from the same
    // slug in another space. The parent is not projected in this fixture, so its identity
    // falls back to the reporter's own scope — the only one this path can prove.
    expect(node.metadata).toEqual({
      scope_space_id: STORED_SPACE,
      scope_source: 'stored-record',
      target_key: `adapter:${STORED_SPACE}:parent-adapter`,
      target_space_id: STORED_SPACE,
      field: 'reward_failure'
    });
  });

  test('routes_to falls back to the failing adapter when there is no inheritance', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    mockCreateAnomaly.mockResolvedValue(undefined);
    mockGetAdapter.mockResolvedValue({ frontmatter: {} });
    mockGetResult.mockResolvedValue(null);

    const { recordRewardAnomaly } = await import('../../src/tools/reward-anomaly.js');
    const qdrant = makeQdrant({ adapter: { name: 'lonely-adapter' }, space_id: STORED_SPACE });

    await recordRewardAnomaly(qdrant, {
      uri: URI,
      layerUuid: LAYER_UUID,
      outcome: 'failure'
    });

    expect(mockCreateAnomaly).toHaveBeenCalledTimes(1);
    const node = mockCreateAnomaly.mock.calls[0]![0] as Record<string, any>;
    expect(node.discovered_by).toBe('lonely-adapter');
    expect(node.routes_to).toBe('lonely-adapter');
    expect(node.severity).toBe('medium');
  });

  test('discovered_by falls back to the layer identity when resolution fails', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    mockCreateAnomaly.mockResolvedValue(undefined);
    mockGetAdapter.mockResolvedValue(null);
    mockGetResult.mockResolvedValue(null);

    const { recordRewardAnomaly } = await import('../../src/tools/reward-anomaly.js');
    const qdrant = { getMemoryByUUID: jest.fn<any>().mockRejectedValue(new Error('qdrant down')) };

    await recordRewardAnomaly(qdrant as any, {
      uri: URI,
      layerUuid: LAYER_UUID,
      outcome: 'failure'
    });

    expect(mockCreateAnomaly).toHaveBeenCalledTimes(1);
    const node = mockCreateAnomaly.mock.calls[0]![0] as Record<string, any>;
    expect(node.discovered_by).toBe(`layer:${LAYER_UUID}`);
    expect(node.routes_to).toBe(`layer:${LAYER_UUID}`);
  });

  test('does NOT write an anomaly on success', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;

    const { recordRewardAnomaly } = await import('../../src/tools/reward-anomaly.js');
    const qdrant = makeQdrant({ slug: 'failing-adapter', space_id: STORED_SPACE });

    await recordRewardAnomaly(qdrant, {
      uri: URI,
      layerUuid: LAYER_UUID,
      outcome: 'success'
    });

    expect(mockCreateAnomaly).not.toHaveBeenCalled();
    expect(qdrant.getMemoryByUUID).not.toHaveBeenCalled();
  });

  test('graph-db unavailable: reward anomaly bookkeeping is a silent no-op (no throw)', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = false;

    const { recordRewardAnomaly } = await import('../../src/tools/reward-anomaly.js');
    const qdrant = makeQdrant({ slug: 'failing-adapter', space_id: STORED_SPACE });

    await expect(
      recordRewardAnomaly(qdrant, {
        uri: URI,
        layerUuid: LAYER_UUID,
        outcome: 'failure',
        feedback: 'boom'
      })
    ).resolves.toBeNull();

    expect(mockCreateAnomaly).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  test('createAnomaly failure is swallowed and warned (graceful degradation)', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    mockCreateAnomaly.mockRejectedValue(new Error('LadybugDB: disk full'));
    mockGetAdapter.mockResolvedValue(null);
    mockGetResult.mockResolvedValue(null);

    const { recordRewardAnomaly } = await import('../../src/tools/reward-anomaly.js');
    const qdrant = makeQdrant({ slug: 'failing-adapter', space_id: STORED_SPACE });

    await expect(
      recordRewardAnomaly(qdrant, {
        uri: URI,
        layerUuid: LAYER_UUID,
        outcome: 'failure'
      })
    ).resolves.toBeNull();

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('createAnomaly failed'));
  });

  test('PROPOSAL-ONLY: never rewrites an Adapter node', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    mockCreateAnomaly.mockResolvedValue(undefined);
    mockGetAdapter.mockResolvedValue({ frontmatter: { inherits: 'parent-adapter' } });
    mockGetResult.mockResolvedValue({ status: 'failed', shell: { exit_code: 1 } });

    const { recordRewardAnomaly } = await import('../../src/tools/reward-anomaly.js');
    const qdrant = makeQdrant({ slug: 'failing-adapter', space_id: STORED_SPACE });

    await recordRewardAnomaly(qdrant, {
      uri: URI,
      layerUuid: LAYER_UUID,
      outcome: 'failure'
    });

    expect(mockCreateAnomaly).toHaveBeenCalledTimes(1);
    expect(mockCreateAdapterNode).not.toHaveBeenCalled();
    expect(mockUpsertAdapterNode).not.toHaveBeenCalled();
    expect(mockUpsertAdapterFromFrontmatter).not.toHaveBeenCalled();
  });
});
