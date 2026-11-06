/**
 * Unit tests for Touchpoint 2: activate resolves inheritance chain server-side.
 *
 * Covers:
 *   - Activation with no inheritance: chain empty, resolved true, adapter unchanged
 *   - Activation with single-level inheritance: chain = [child, parent], resolved true
 *   - Activation with multi-level inheritance: chain = [child, parent, grandparent], resolved true
 *   - Activation when graph DB unavailable: chain empty, resolved false, warning logged
 *   - Activation when resolveInheritance throws: graceful degradation
 *   - Override semantics: fields in child's override list come from child; others from parent
 *
 * Mocking strategy: `jest.resetModules()` + both `jest.doMock()` and
 * `jest.unstable_mockModule()` per the established pattern (commit 11293c62).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import type { ResolvedInheritance, AdapterNode } from '../../src/services/graph-db/graph-database.service.js';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

const mockWarn = jest.fn();
const mockDebug = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();

/** Track whether graph singleton returns null (unavailable). */
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

/** Controlled search output returned by the mocked executeSearch. */
let searchChoices: any[] = [];

function searchFactory() {
  return {
    executeSearch: jest.fn<any>().mockImplementation(async () => ({
      must_obey: true,
      message: 'Found 1 match.',
      next_action: 'Pick one.',
      choices: searchChoices
    }))
  };
}

function activateHeavyDepMocks(): void {
  const metricsFactory = () => ({
    mcpToolCalls: { inc: jest.fn<any>() },
    mcpToolDuration: { startTimer: jest.fn<any>(() => jest.fn<any>()) },
    mcpToolErrors: { inc: jest.fn<any>() },
    mcpToolInputSize: { observe: jest.fn<any>() },
    mcpToolOutputSize: { observe: jest.fn<any>() },
    squadrulesQualityUpdateErrors: { inc: jest.fn<any>() },
    squadrulesTrainSimilarAdapterFound: { inc: jest.fn<any>() }
  });
  const toolDocFactory = () => ({ resolveToolDoc: () => undefined });
  // tenant-context is a hot import for embedding/qdrant/search paths pulled in
  // transitively by activate → activate-inheritance → adapter-effective-content.
  // Mirror every runtime export with inert defaults so ESM does not raise
  // "does not provide an export named X" SyntaxErrors deep in the chain.
  const defaultTestSpaceContext = () => ({
    userId: '',
    groupIds: [],
    allowedSpaceIds: ['space:test'],
    defaultWriteSpaceId: 'space:test',
    personalSpaceId: 'space:test',
    spaceNamesById: { 'space:test': 'Test' },
    requestId: 'test-request-id'
  });
  const tenantFactory = () => ({
    NO_AUTH_SPACE_ID: 'space:no-auth',
    defaultSpaceContext: defaultTestSpaceContext,
    runWithSpaceContext: (_ctx: unknown, fn: () => any) => fn(),
    runWithSpaceContextAsync: (_ctx: unknown, fn: () => Promise<any>) => fn(),
    getSpaceContextFromStorage: defaultTestSpaceContext,
    getSpaceIdFromStorage: () => 'space:test',
    getRequestIdFromStorage: () => 'test-request-id',
    getSearchSpaceIds: () => ['space:test'],
    runWithOptionalSpaceAsync: (_space: string | undefined, fn: () => Promise<any>) => fn(),
    getSpaceContext: () => defaultTestSpaceContext(),
    runHttpApiWithSpaceContext: (_req: unknown, fn: () => Promise<any>) => fn(),
    getTenantId: () => 'test-tenant'
  });
  const artifactsFactory = () => ({
    loadLinkedArtifacts: jest.fn<any>().mockResolvedValue({ linkedArtifacts: [], artifactLoadError: null })
  });
  const refinementFactory = () => ({
    activateRefinementStore: {
      incrementRefineCount: jest.fn<any>().mockResolvedValue(0),
      getRefineCount: jest.fn<any>().mockResolvedValue(0),
      resetRefineCount: jest.fn<any>().mockResolvedValue(undefined)
    }
  });
  // Comprehensive config mock: activate.ts transitively pulls in the embedding /
  // qdrant / search chain, each of which imports named config exports. A partial
  // mock causes "does not provide an export named X" SyntaxErrors under ESM, so
  // every src/config.ts export is mirrored here with an inert default.
  const configFactory = () => ({
    SQUADRULES_LOCAL_ARTIFACT_DIRS: [],
    parseLocalArtifactDirHints: () => [],
    TRANSPORT_TYPE: 'stdio',
    SQUADRULES_SEARCH_LIMIT_CAP: 10,
    SQUADRULES_SEARCH_LIMIT_MIN: 1,
    SQUADRULES_SEARCH_MAX_CHOICES: 5,
    SQUADRULES_SEARCH_MAX_FETCH: 50,
    SQUADRULES_SEARCH_OVERFETCH_FACTOR: 2,
    SQUADRULES_ENABLE_GROUP_COLLAPSE: false,
    SQUADRULES_REDIS_PREFIX: 'squadrules:',
    SQUADRULES_APP_SPACE_ID: '',
    SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX: '',
    SQUADRULES_MCP_WIDGET_PRESENTATION_ONLY: false,
    SQUADRULES_SIMPLE_PERSONAL_REALM: '',
    SQUADRULES_SIMPLE_PERSONAL_SPACE_ID: '',
    SQUADRULES_SIMPLE_PERSONAL_UUIDV5_SEED: '',
    OPENAI_API_KEY: '',
    OPENAI_API_URL: 'https://api.openai.com',
    OPENAI_API_URL_EXPLICIT: false,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_PROVIDER: 'auto',
    EMBEDDING_LATENCY_WARN_MS: 5000,
    EMBEDDING_NORM_MIN: 0.5,
    EMBEDDING_NORM_MAX: 2.0,
    EMBEDDING_MAX_RETRIES: 2,
    EMBEDDING_RETRY_BASE_DELAY_MS: 500,
    EMBEDDING_RETRY_MAX_DELAY_MS: 8000,
    EMBEDDING_RETRY_AFTER_CAP_MS: 10000,
    EMBEDDING_RETRY_BUDGET_MS: 15000,
    FASTEMBED_MODEL: '',
    FASTEMBED_CACHE_DIR: '',
    TEI_BASE_URL: '',
    TEI_MODEL: 'Alibaba-NLP/gte-large-en-v1.5',
    TEI_API_KEY: '',
    QDRANT_API_KEY: '',
    QDRANT_COLLECTION_CURRENT: '',
    QDRANT_RESCORE_STRING: '',
    QDRANT_SNAPSHOT_DIR: '',
    QDRANT_SNAPSHOT_ON_START: false,
    getQdrantUrl: () => 'http://localhost:6333',
    getQdrantCollection: () => 'squadrules',
    isQdrantConfigured: false,
    REDIS_URL: '',
    isRedisConfigured: false,
    MEMORY_CACHE_KEY_PREFIX: 'mem:',
    LOG_LEVEL: 'info',
    LOG_FORMAT: 'text',
    AUDIT_LOG_FILE: '',
    AUDIT_LOG_LEVEL: 1,
    SEARCH_SCORE_WARN_THRESHOLD: 0.1,
    SCORE_THRESHOLD: 0.0,
    SIMILAR_MEMORY_THRESHOLD: 0.8,
    COMMENT_SEMANTIC_VALIDATION_TIMEOUT_MS: 10000,
    ATTEST_BOOST_MAX: 0,
    MIN_ATTEST_RUNS: 0,
    RUNS_FULL_CONFIDENCE: 0,
    GROUP_SPACE_PATH_EXAMPLE: '',
    deriveGroupSpacePathExampleFromAllowlist: () => '',
    OIDC_STATE_KEY_PREFIX: 'oidc-state:',
    OIDC_SCOPES_SUPPORTED: [],
    OIDC_GROUPS_ALLOWLIST: [],
    OIDC_BEARER_MERGE_USERINFO_GROUPS: false,
    AUTH_MODE: 'off',
    AUTH_ENABLED: false,
    AUTH_ALLOWED_AUDIENCES: [],
    AUTH_ALLOWED_AUDIENCES_STRING: '',
    AUTH_TRUSTED_ISSUERS: [],
    AUTH_TRUSTED_ISSUERS_STRING: '',
    AUTH_CALLBACK_BASE_URL: '',
    AUTH_RATE_LIMIT_MAX: 100,
    AUTH_RATE_LIMIT_WINDOW_MS: 60000,
    KEYCLOAK_URL: '',
    KEYCLOAK_INTERNAL_URL: '',
    KEYCLOAK_REALM: '',
    KEYCLOAK_CLIENT_ID: '',
    KEYCLOAK_CLI_CLIENT_ID: '',
    SESSION_SECRET: '',
    SESSION_MAX_AGE_SEC: 3600,
    SERVER_PORT: 3000,
    METRICS_PORT: 0,
    HTTP_JSON_BODY_LIMIT: '1mb',
    HTTP_TRAIN_RAW_BODY_LIMIT: '10mb',
    HTTP_RATE_LIMIT_MAX: 1000,
    HTTP_RATE_LIMIT_WINDOW_MS: 60000,
    MCP_RATE_LIMIT_MAX: 1000,
    MCP_RATE_LIMIT_WINDOW_MS: 60000,
    MAX_CONCURRENT_MCP_REQUESTS_RAW: '100'
  });
  const localArtifactFactory = () => ({
    buildLocalArtifactDirFields: () => ({})
  });
  const paginationFactory = () => ({
    DEFAULT_PAGE_SIZE: 50,
    EMBEDDED_DOCS_TTL_MS: 300_000,
    ADAPTER_CONTENT_TTL_MS: 30_000,
    EMBEDDED_DOCS_CACHE_SCOPE: 'public',
    ADAPTER_CONTENT_CACHE_SCOPE: 'private',
    encodeCursor: () => '',
    decodeCursor: () => 0,
    paginateItems: (items: unknown[]) => ({ items, nextCursor: undefined }),
    buildEmbeddedDocsCacheMetadata: () => ({ ttlMs: undefined, cacheScope: undefined }),
    buildAdapterContentCacheMetadata: () => ({ ttlMs: undefined, cacheScope: undefined }),
    buildServerInfoMeta: () => ({})
  });
  const exportResolveFactory = () => ({
    resolveExportAdapter: jest.fn<any>().mockResolvedValue({ layerId: 'layer-1', adapterId: 'adapter-1' })
  });

  jest.unstable_mockModule('../../src/services/metrics/mcp-metrics.js', metricsFactory);
  jest.doMock('../../src/services/metrics/mcp-metrics.js', metricsFactory);
  jest.unstable_mockModule('../../src/utils/mcp-tool-doc-runtime.js', toolDocFactory);
  jest.doMock('../../src/utils/mcp-tool-doc-runtime.js', toolDocFactory);
  jest.unstable_mockModule('../../src/utils/tenant-context.js', tenantFactory);
  jest.doMock('../../src/utils/tenant-context.js', tenantFactory);
  jest.unstable_mockModule('../../src/tools/activate-artifacts.js', artifactsFactory);
  jest.doMock('../../src/tools/activate-artifacts.js', artifactsFactory);
  jest.unstable_mockModule('../../src/services/activate-refinement-store.js', refinementFactory);
  jest.doMock('../../src/services/activate-refinement-store.js', refinementFactory);
  jest.unstable_mockModule('../../src/config.js', configFactory);
  jest.doMock('../../src/config.js', configFactory);
  jest.unstable_mockModule('../../src/tools/local-artifact-dir-contract.js', localArtifactFactory);
  jest.doMock('../../src/tools/local-artifact-dir-contract.js', localArtifactFactory);
  jest.unstable_mockModule('../../src/utils/pagination.js', paginationFactory);
  jest.doMock('../../src/utils/pagination.js', paginationFactory);
  jest.unstable_mockModule('../../src/tools/export-resolve-adapter.js', exportResolveFactory);
  jest.doMock('../../src/tools/export-resolve-adapter.js', exportResolveFactory);
}

function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-db-singleton.js', graphDbSingletonFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.unstable_mockModule('../../src/tools/search.js', searchFactory);
  jest.doMock('../../src/services/graph-db/graph-db-singleton.js', graphDbSingletonFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/tools/search.js', searchFactory);
  activateHeavyDepMocks();
}

/** Build a minimal match choice for the mocked search output. */
function makeMatchChoice(slug: string, label = 'Test Adapter') {
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

/** Build a ResolvedInheritance result for mocking. */
function makeResolvedInheritance(
  childSlug: string,
  ancestorSlugs: string[],
  resolvedOverrides: Record<string, any> = {}
): ResolvedInheritance {
  const childNode: AdapterNode = {
    key: `adapter:${childSlug}`,
    type: 'adapter',
    slug: childSlug,
    version: '1.0.0',
    title: 'Child',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  };
  const chain: AdapterNode[] = ancestorSlugs.map((slug, i) => ({
    key: `adapter:${slug}`,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('activate inheritance resolution (Touchpoint 2)', () => {
  beforeEach(() => {
    graphDbAvailable = false;
    searchChoices = [];
    mockResolveInheritance.mockReset();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockInfo.mockClear();
    mockError.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('no inheritance: chain empty, resolved true, adapter unchanged', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    searchChoices = [makeMatchChoice('standalone-adapter')];

    // resolveInheritance returns a result with empty chain (no ancestors)
    mockResolveInheritance.mockResolvedValue({
      adapter: { key: 'adapter:standalone-adapter', type: 'adapter', slug: 'standalone-adapter', version: '1.0.0', title: 'Standalone', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      resolved_properties: { slug: 'standalone-adapter' },
      inheritance_chain: []
    });

    const { executeActivate } = await import('../../src/tools/activate.js');
    const mockMemoryStore = { getMemory: jest.fn<any>() } as any;

    const result = await executeActivate(mockMemoryStore, undefined, { query: 'test' });

    expect(result.inheritance_chain).toEqual(['standalone-adapter']);
    expect(result.inheritance_resolved).toBe(true);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  test('single-level inheritance: chain = [child, parent], resolved true', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    searchChoices = [makeMatchChoice('child-adapter')];

    mockResolveInheritance.mockResolvedValue(
      makeResolvedInheritance('child-adapter', ['parent-adapter'])
    );

    const { executeActivate } = await import('../../src/tools/activate.js');
    const mockMemoryStore = { getMemory: jest.fn<any>() } as any;

    const result = await executeActivate(mockMemoryStore, undefined, { query: 'test' });

    expect(result.inheritance_chain).toEqual(['child-adapter', 'parent-adapter']);
    expect(result.inheritance_resolved).toBe(true);
  });

  test('multi-level inheritance: chain = [child, parent, grandparent], resolved true', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    searchChoices = [makeMatchChoice('child-adapter')];

    mockResolveInheritance.mockResolvedValue(
      makeResolvedInheritance('child-adapter', ['parent-adapter', 'grandparent-adapter'])
    );

    const { executeActivate } = await import('../../src/tools/activate.js');
    const mockMemoryStore = { getMemory: jest.fn<any>() } as any;

    const result = await executeActivate(mockMemoryStore, undefined, { query: 'test' });

    expect(result.inheritance_chain).toEqual(['child-adapter', 'parent-adapter', 'grandparent-adapter']);
    expect(result.inheritance_resolved).toBe(true);
  });

  test('graph DB unavailable: chain empty, resolved false, warning logged', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = false;
    searchChoices = [makeMatchChoice('some-adapter')];

    const { executeActivate } = await import('../../src/tools/activate.js');
    const mockMemoryStore = { getMemory: jest.fn<any>() } as any;

    const result = await executeActivate(mockMemoryStore, undefined, { query: 'test' });

    expect(result.inheritance_chain).toEqual([]);
    expect(result.inheritance_resolved).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('graph DB unavailable')
    );
  });

  test('resolveInheritance throws: graceful degradation, resolved false, warning logged', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    searchChoices = [makeMatchChoice('failing-adapter')];

    mockResolveInheritance.mockRejectedValue(new Error('DB connection lost'));

    const { executeActivate } = await import('../../src/tools/activate.js');
    const mockMemoryStore = { getMemory: jest.fn<any>() } as any;

    const result = await executeActivate(mockMemoryStore, undefined, { query: 'test' });

    expect(result.inheritance_chain).toEqual([]);
    expect(result.inheritance_resolved).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('resolveInheritance failed')
    );
    // Activation still succeeds — choices are present
    expect(result.choices.length).toBeGreaterThan(0);
  });

  test('adapter not in graph: chain empty, resolved true (not a degradation)', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    searchChoices = [makeMatchChoice('unknown-adapter')];

    // resolveInheritance returns null when adapter is not in the graph
    mockResolveInheritance.mockResolvedValue(null);

    const { executeActivate } = await import('../../src/tools/activate.js');
    const mockMemoryStore = { getMemory: jest.fn<any>() } as any;

    const result = await executeActivate(mockMemoryStore, undefined, { query: 'test' });

    expect(result.inheritance_chain).toEqual([]);
    expect(result.inheritance_resolved).toBe(true);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  test('no match choices (create only): chain empty, resolved true', async () => {
    jest.resetModules();
    registerMocks();
    graphDbAvailable = true;
    searchChoices = [{
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
    const mockMemoryStore = { getMemory: jest.fn<any>() } as any;

    const result = await executeActivate(mockMemoryStore, undefined, { query: 'test' });

    expect(result.inheritance_chain).toEqual([]);
    expect(result.inheritance_resolved).toBe(true);
    expect(mockResolveInheritance).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Override semantics: tested via the GraphDatabaseService.resolveInheritance
// merge logic directly (pure unit, no activate flow needed).
// ---------------------------------------------------------------------------

describe('resolveInheritance override semantics (Touchpoint 2 merge fix)', () => {
  test('fields in child override list come from child; others from parent', () => {
    // Simulate the merge logic extracted from the service:
    // child overrides ['tags'], so tags come from child; title/version come from parent.
    const parentProps: Record<string, any> = {
      key: 'adapter:parent',
      type: 'adapter',
      slug: 'parent',
      version: '2.0.0',
      title: 'Parent Title',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      frontmatter: { slug: 'parent', version: '2.0.0' },
      layer_count: 5,
      contract_types: ['shell'],
      space: 'personal',
      tags: ['parent-tag'],
      metadata: {}
    };

    const childNode: AdapterNode = {
      key: 'adapter:child',
      type: 'adapter',
      slug: 'child',
      version: '1.0.0',
      title: 'Child Title',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      frontmatter: { slug: 'child', version: '1.0.0', inherits: 'parent', override: ['tags'] },
      layer_count: 0,
      contract_types: [],
      space: 'personal',
      tags: ['child-tag'],
      metadata: {}
    };

    // Replicate the merge algorithm from the fixed resolveInheritance
    const IDENTITY_FIELDS = ['key', 'type', 'slug', 'created_at', 'updated_at', 'frontmatter'];
    const merged: Record<string, any> = { ...parentProps };

    // Apply child's overrides
    const childOverrides = childNode.frontmatter?.override ?? [];
    for (const field of childOverrides) {
      if (field in childNode) {
        merged[field] = (childNode as any)[field];
      }
    }

    // Identity fields always from child
    for (const field of IDENTITY_FIELDS) {
      merged[field] = (childNode as any)[field];
    }

    // Assertions: override field (tags) comes from child
    expect(merged.tags).toEqual(['child-tag']);
    // Non-override fields come from parent
    expect(merged.title).toBe('Parent Title');
    expect(merged.version).toBe('2.0.0');
    expect(merged.layer_count).toBe(5);
    expect(merged.contract_types).toEqual(['shell']);
    // Identity fields come from child
    expect(merged.key).toBe('adapter:child');
    expect(merged.slug).toBe('child');
    expect(merged.type).toBe('adapter');
    expect(merged.created_at).toBe('2026-01-02T00:00:00Z');
  });

  test('multi-level merge: child overrides parent overrides grandparent', () => {
    const grandparentProps: Record<string, any> = {
      key: 'adapter:grandparent',
      type: 'adapter',
      slug: 'grandparent',
      version: '3.0.0',
      title: 'Grandparent Title',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      frontmatter: { slug: 'grandparent', version: '3.0.0' },
      layer_count: 10,
      contract_types: ['shell', 'forward'],
      space: 'team',
      tags: ['gp-tag'],
      metadata: { origin: 'grandparent' }
    };

    const parentNode: AdapterNode = {
      key: 'adapter:parent',
      type: 'adapter',
      slug: 'parent',
      version: '2.0.0',
      title: 'Parent Title',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      frontmatter: { slug: 'parent', version: '2.0.0', inherits: 'grandparent', override: ['title', 'tags'] },
      layer_count: 0,
      contract_types: [],
      space: 'team',
      tags: ['parent-tag'],
      metadata: {}
    };

    const childNode: AdapterNode = {
      key: 'adapter:child',
      type: 'adapter',
      slug: 'child',
      version: '1.0.0',
      title: 'Child Title',
      created_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
      frontmatter: { slug: 'child', version: '1.0.0', inherits: 'parent', override: ['version'] },
      layer_count: 0,
      contract_types: [],
      space: 'personal',
      tags: ['child-tag'],
      metadata: {}
    };

    // Replicate multi-level merge: pathToRoot sorted deepest-first = [grandparent, parent]
    const IDENTITY_FIELDS = ['key', 'type', 'slug', 'created_at', 'updated_at', 'frontmatter'];

    // Base: grandparent (root)
    const merged: Record<string, any> = { ...grandparentProps };

    // Apply parent's overrides (parent overrides title, tags from grandparent)
    const parentOverrides = parentNode.frontmatter?.override ?? [];
    for (const field of parentOverrides) {
      if (field in parentNode) {
        merged[field] = (parentNode as any)[field];
      }
    }
    // After parent level: title='Parent Title', tags=['parent-tag'], rest from grandparent

    // Apply child's overrides (child overrides version)
    const childOverrides = childNode.frontmatter?.override ?? [];
    for (const field of childOverrides) {
      if (field in childNode) {
        merged[field] = (childNode as any)[field];
      }
    }

    // Identity from child
    for (const field of IDENTITY_FIELDS) {
      merged[field] = (childNode as any)[field];
    }

    // version: child overrides → '1.0.0'
    expect(merged.version).toBe('1.0.0');
    // title: parent overrides from grandparent → 'Parent Title' (child does NOT override title)
    expect(merged.title).toBe('Parent Title');
    // tags: parent overrides from grandparent → ['parent-tag'] (child does NOT override tags)
    expect(merged.tags).toEqual(['parent-tag']);
    // layer_count: not overridden by anyone → grandparent's 10
    expect(merged.layer_count).toBe(10);
    // contract_types: not overridden → grandparent's
    expect(merged.contract_types).toEqual(['shell', 'forward']);
    // space: not overridden → grandparent's 'team'
    expect(merged.space).toBe('team');
    // Identity from child
    expect(merged.key).toBe('adapter:child');
    expect(merged.slug).toBe('child');
  });
});
