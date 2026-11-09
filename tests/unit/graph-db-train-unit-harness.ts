/**
 * Shared doubles for the train-path graph projection unit suites.
 *
 * Honest naming: these are UNIT doubles. `getGraphDb(store)` is the only graph seam
 * `train-store` uses, so the double is a plain object rather than a database. Real
 * LadybugDB/LanceDB coverage (nodes-before-edges ordering, failed-node behaviour,
 * history persistence) lives in tests/integration/graph-db-*.test.ts.
 *
 * The memory store double mirrors the three methods the train path calls: `storeAdapter`
 * (write), `getMemory` (read-back of the stored head) and `scrollSpace` (parent lookup).
 */
import { jest } from '@jest/globals';

export const mockWarn = jest.fn();
export const mockDebug = jest.fn();
export const mockInfo = jest.fn();
export const mockError = jest.fn();

/** Whether the store has an attached graph (unavailable when false). */
export const graphState = { available: false };

export const mockUpsertAdapterFromFrontmatter = jest.fn<any>();
export const mockGetAdapter = jest.fn<any>();
export const mockWriteInheritanceEdges = jest.fn<any>();
export const mockClearInheritanceEdges = jest.fn<any>();
/** Descendant gate lookup: an adapter with no stored children gates nothing. */
export const mockGetChildren = jest.fn<any>();
/** Graph-native history: `null` means this write is the adapter's first snapshot. */
export const mockGetLatestVersion = jest.fn<any>();
export const mockAppendVersion = jest.fn<any>();

export function graphOwnerFactory() {
  // The graph is owned by the memory/runtime instance (WeakMap): the only seam is
  // `getGraphDb(store)`. There is no process-global graph path in this flow.
  return {
    getGraphDb: (_store: unknown) => {
      if (!graphState.available) return null;
      return {
        isInitialized: () => true,
        upsertAdapterFromFrontmatter: mockUpsertAdapterFromFrontmatter,
        getAdapter: mockGetAdapter,
        writeInheritanceEdges: mockWriteInheritanceEdges,
        clearInheritanceEdges: mockClearInheritanceEdges,
        getChildren: mockGetChildren,
        getLatestVersion: mockGetLatestVersion,
        appendVersion: mockAppendVersion
      };
    },
    attachGraphDb: jest.fn<any>(),
    detachGraphDb: jest.fn<any>()
  };
}

export function loggerFactory() {
  const loggerDouble = {
    debug: mockDebug,
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
    trace: jest.fn<any>(),
    fatal: jest.fn<any>(),
    child: () => loggerDouble
  };
  return {
    structuredLogger: loggerDouble,
    // `logger` is consumed by key-value-store-factory (pulled in via train.ts ->
    // dump.ts -> proof-of-work-store). Export it so the mock module is complete.
    logger: loggerDouble,
    writeAuditLine: jest.fn<any>()
  };
}

export function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
}

/** Reset the graph double and logger doubles. Call from `beforeEach`. */
export function resetTrainDoubles(): void {
  graphState.available = false;
  mockUpsertAdapterFromFrontmatter.mockReset();
  mockGetAdapter.mockReset();
  mockWriteInheritanceEdges.mockReset();
  mockClearInheritanceEdges.mockReset();
  mockGetChildren.mockReset();
  mockGetChildren.mockResolvedValue([]);
  mockGetLatestVersion.mockReset();
  mockGetLatestVersion.mockResolvedValue(null);
  mockAppendVersion.mockReset();
  mockAppendVersion.mockResolvedValue({ version_number: '1' });
  mockWarn.mockClear();
  mockDebug.mockClear();
  mockInfo.mockClear();
  mockError.mockClear();
}

/** Read the write scope from the same tenant context the production write uses. */
export async function readWriteSpace(): Promise<string> {
  const { getSpaceContextFromStorage } = await import('../../src/utils/tenant-context.js');
  return getSpaceContextFromStorage().defaultWriteSpaceId;
}

/** The head record the store returns after a successful write. */
export function storedHead(opts: {
  uuid: string;
  slug: string;
  version?: string;
  frontmatter?: Record<string, unknown>;
  name?: string;
  /** Stored scope. The projection keys the node from the record, never from the tenant. */
  spaceId?: string;
}) {
  return {
    memory_uuid: opts.uuid,
    label: opts.name ?? opts.slug,
    slug: opts.slug,
    ...(opts.spaceId ? { space_id: opts.spaceId } : {}),
    tags: ['test'],
    text: '# body',
    adapter: {
      id: `${opts.slug}-id`,
      name: opts.name ?? opts.slug,
      layer_index: 1,
      layer_count: 1,
      protocol_version: opts.version ?? '1.0.0',
      ...(opts.frontmatter ? { frontmatter: opts.frontmatter } : {})
    }
  };
}

/**
 * Memory-store double: `storeAdapter` resolves the stored head, `getMemory` returns it
 * for the projection read-back, and `scrollSpace` feeds parent resolution.
 */
export function makeAdapterStore(opts: {
  head?: unknown;
  scrollRecords?: unknown[];
  storeError?: Error;
}) {
  const head = opts.head as { memory_uuid?: string } | undefined;
  const storeAdapter = opts.storeError
    ? jest.fn<any>().mockRejectedValue(opts.storeError)
    : jest.fn<any>().mockResolvedValue(head ? [head] : []);
  return {
    storeAdapter,
    storeArtifact: jest.fn<any>(),
    getMemory: jest.fn<any>().mockImplementation(async (uuid: string) =>
      head && head.memory_uuid === uuid ? head : null
    ),
    scrollSpace: jest.fn<any>().mockResolvedValue(opts.scrollRecords ?? [])
  };
}

/** One stored adapter layer record as `scrollSpace` returns it. */
export function layerRecord(uuid: string, payload: Record<string, unknown>) {
  return { uuid, payload };
}

export function validMarkdown(opts: { slug?: string; frontmatter?: string[] } = {}): string {
  return [
    '---',
    `slug: ${opts.slug ?? 'test-adapter'}`,
    'version: 1.0.0',
    ...(opts.frontmatter ?? []),
    '---',
    '',
    '# Test Adapter',
    '',
    '## Activation Patterns',
    '',
    '- test',
    '',
    '## Step 1',
    '',
    'Do something.',
    '',
    '```json',
    '{"contract": {"type": "shell", "shell": {"cmd": "echo hi", "interpreter": "bash"}}}',
    '```',
    '',
    '## Reward Signal',
    '',
    'Done.'
  ].join('\n');
}

/**
 * A structurally valid document whose `inherits:`/`override:` the caller supplies raw,
 * so a test can express an invalid topology without restating the whole document shape.
 */
export function markdownWithFrontmatterLines(slug: string, frontmatter: string[]): string {
  return validMarkdown({ slug, frontmatter });
}
