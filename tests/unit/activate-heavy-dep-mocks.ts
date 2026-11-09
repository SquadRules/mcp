/**
 * Heavy transitive doubles for the activate unit suite.
 *
 * `activate.ts` pulls in the embedding / qdrant / search / config chain. Under ESM a
 * partial module double raises "does not provide an export named X", so every export of
 * each transitive module is mirrored here with an inert default. Kept in its own file
 * because the registry it writes is large and has nothing to do with what activate
 * asserts.
 */
import { jest } from '@jest/globals';

/** Space the fake store reports for the stored child record (also the tenant default). */
export const STORED_SPACE = 'space:test';

/** Register the transitive doubles activate needs in order to load at all. */
export function activateHeavyDepMocks(): void {
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
    allowedSpaceIds: [STORED_SPACE],
    defaultWriteSpaceId: STORED_SPACE,
    personalSpaceId: STORED_SPACE,
    spaceNamesById: { [STORED_SPACE]: 'Test' },
    requestId: 'test-request-id'
  });
  const tenantFactory = () => ({
    NO_AUTH_SPACE_ID: 'space:no-auth',
    defaultSpaceContext: defaultTestSpaceContext,
    runWithSpaceContext: (_ctx: unknown, fn: () => any) => fn(),
    runWithSpaceContextAsync: (_ctx: unknown, fn: () => Promise<any>) => fn(),
    getSpaceContextFromStorage: defaultTestSpaceContext,
    getSpaceIdFromStorage: () => STORED_SPACE,
    getRequestIdFromStorage: () => 'test-request-id',
    getSearchSpaceIds: () => [STORED_SPACE],
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
