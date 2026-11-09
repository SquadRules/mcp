/**
 * Shared doubles and fixtures for the activate inheritance unit suite.
 *
 * Honest naming: nothing here is a database. The graph owner, the effective-content
 * helper, the search tool, the logger and the transitive activate dependencies are module
 * doubles; real-database coverage of the same paths lives in
 * tests/integration/graph-db-instance-isolation.test.ts and
 * tests/integration/adapter-inheritance-effective-content.test.ts.
 *
 * Mocking strategy: `jest.resetModules()` + both `jest.doMock()` and
 * `jest.unstable_mockModule()`, registered through `registerMocks()` after each reset.
 */
import { jest } from '@jest/globals';

import type { ResolvedInheritance, AdapterNode } from '../../src/services/graph-db/graph-database.service.js';
import { activateHeavyDepMocks, STORED_SPACE } from './activate-heavy-dep-mocks.js';

/** Space the fake store reports for the stored child record. */
export { STORED_SPACE };

/** Layer UUID the fake qdrant service resolves for the top match slug. */
export const CHILD_LAYER_UUID = 'child-entry-layer';

export const mockWarn = jest.fn();
export const mockDebug = jest.fn();
export const mockInfo = jest.fn();
export const mockError = jest.fn();

/**
 * Whether the graph owner returns a graph (unavailable when false). An object rather than
 * a `let` so tests can flip it through an ESM import binding.
 */
export const graphState = { available: false };

export const mockResolveInheritance = jest.fn<any>();

/** Effective-content helper is mocked: activate's PRIMARY path vs the chain-only fallback. */
export const mockResolveEffectiveLayerContent = jest.fn<any>();
export const mockBuildMergedAdapterContent = jest.fn<any>();

/** Controlled search output consumed by the mocked executeSearch. */
export const searchState: { choices: any[] } = { choices: [] };

export function graphOwnerFactory() {
  // The graph is owned by the memory/runtime instance (WeakMap), not a process-global
  // singleton. `getGraphDb` is the only seam activate uses.
  return {
    getGraphDb: (_store: unknown) => {
      if (!graphState.available) return null;
      return {
        isInitialized: () => true,
        resolveInheritance: mockResolveInheritance,
        // activate also projects graph-native ontology context. These cases cover the
        // inheritance path only, so the adapter node is honestly absent — that yields a
        // `degraded` context, never a warning that a degradation-free path must not emit.
        getAdapter: jest.fn<any>().mockResolvedValue(null)
      };
    },
    attachGraphDb: jest.fn<any>(),
    detachGraphDb: jest.fn<any>()
  };
}

export function effectiveContentFactory() {
  return {
    resolveEffectiveLayerContent: mockResolveEffectiveLayerContent,
    buildMergedAdapterContent: mockBuildMergedAdapterContent
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
    logger: loggerDouble,
    httpLogger: loggerDouble,
    writeAuditLine: jest.fn<any>(),
    getClientIp: () => '',
    sanitizeLogMessage: (msg: string) => msg,
    sanitizeBindingsForAudit: (b: Record<string, unknown>) => b,
    buildAuditLine: () => ({})
  };
}

export function searchFactory() {
  return {
    executeSearch: jest.fn<any>().mockImplementation(async () => ({
      must_obey: true,
      message: 'Found 1 match.',
      next_action: 'Pick one.',
      choices: searchState.choices
    }))
  };
}

export function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.unstable_mockModule('../../src/tools/search.js', searchFactory);
  jest.doMock('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/tools/search.js', searchFactory);
  // The effective-content helper is the seam activate's primary path uses; it must be
  // re-registered after every `jest.resetModules()` alongside the other doubles.
  jest.unstable_mockModule('../../src/tools/adapter-effective-content.js', effectiveContentFactory);
  jest.doMock('../../src/tools/adapter-effective-content.js', effectiveContentFactory);
  activateHeavyDepMocks();
}

/** Reset graph availability, the doubles and the search output. Call from `beforeEach`. */
export function resetActivateDoubles(): void {
  graphState.available = false;
  searchState.choices = [];
  mockResolveInheritance.mockReset();
  mockResolveEffectiveLayerContent.mockReset();
  mockBuildMergedAdapterContent.mockReset();
  mockWarn.mockClear();
  mockDebug.mockClear();
  mockInfo.mockClear();
  mockError.mockClear();
}

/** Build a minimal match choice for the mocked search output. */
export function makeMatchChoice(slug: string, label = 'Test Adapter') {
  return {
    uri: `squadrules://adapter/${slug}`,
    label,
    adapter_name: label,
    score: 0.9,
    role: 'match' as const,
    tags: ['test'],
    next_action: `call forward with squadrules://adapter/${slug}`,
    adapter_version: '1.0.0',
    activation_patterns: ['test pattern'],
    space_name: 'Personal',
    slug
  };
}

/**
 * Stored child record + retrieval double. The space on this record is the ONLY
 * scope source activate may use to build the graph key.
 */
export function makeStoreAndService(slug: string) {
  const memoryStore = {
    getMemory: jest.fn<any>().mockImplementation(async (uuid: string) => ({
      memory_uuid: uuid,
      space_id: STORED_SPACE,
      slug
    }))
  } as any;
  const qdrantService = {
    findFirstStepMemoryUuidBySlug: jest.fn<any>().mockResolvedValue({ layerUuid: CHILD_LAYER_UUID })
  } as any;
  return { memoryStore, qdrantService };
}

/** Build a ResolvedInheritance result for mocking (keys are scope-qualified). */
export function makeResolvedInheritance(
  childSlug: string,
  ancestorSlugs: string[],
  resolvedOverrides: Record<string, any> = {}
): ResolvedInheritance {
  const childNode: AdapterNode = {
    key: `adapter:${STORED_SPACE}:${childSlug}`,
    type: 'adapter',
    slug: childSlug,
    version: '1.0.0',
    title: 'Child',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  };
  const chain: AdapterNode[] = ancestorSlugs.map((slug, i) => ({
    key: `adapter:${STORED_SPACE}:${slug}`,
    type: 'adapter' as const,
    slug,
    version: '1.0.0',
    title: `Ancestor ${i}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }));
  // inheritance_chain is sorted deepest-first (root first) per the service impl
  return {
    adapter: childNode,
    resolved_properties: { ...childNode, ...resolvedOverrides },
    inheritance_chain: [...chain].reverse()
  };
}
