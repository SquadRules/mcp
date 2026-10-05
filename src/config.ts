/**
 * Centralized configuration for environment variables; all env parsing lives here.
 * KEY_VALUE_STORE_URL/REDIS_URL set → key-value backend, else in-memory. QDRANT_URL set
 * → Qdrant vector backend, else embedded LanceDB (see `isQdrantConfigured`).
 */

import path from 'path';
import { parseOidcScopesSupported } from './http/oidc-scopes.js';
import { normalizeRedisUrl } from './utils/normalize-redis-url.js';
import {
  SQUADRULES_LOCAL_ARTIFACT_DIRS_DEFAULT,
  parseLocalArtifactDirHints
} from './utils/squadrules-local-artifact-dirs.js';
export { parseLocalArtifactDirHints } from './utils/squadrules-local-artifact-dirs.js';

/** Throws if key is missing or empty (after trim). Use for vars that must be set. */
function getEnvRequired(key: string, errorMessage?: string): string {
  const val = process.env[key];
  const trimmed = typeof val === 'string' ? val.trim() : '';
  if (!trimmed) {
    const msg = errorMessage ?? `SquadRules requires ${key} to be set. Set it in .env or environment.`;
    throw new Error(msg);
  }
  return trimmed;
}
function getEnvString(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}
function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
function getEnvFloat(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? defaultValue : parsed;
}
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const low = String(val).trim().toLowerCase();
  if (low === 'false' || low === '0' || low === 'no' || low === 'n') return false;
  if (low === 'true' || low === '1' || low === 'yes' || low === 'y') return true;
  return defaultValue;
}
// KEY_VALUE_STORE_URL (or REDIS_URL) set (non-empty) → network store.
const KEY_VALUE_STORE_URL_RAW = getEnvString('KEY_VALUE_STORE_URL', getEnvString('REDIS_URL', ''));
const KEY_VALUE_STORE_PASSWORD = getEnvString('KEY_VALUE_STORE_PASSWORD', getEnvString('REDIS_PASSWORD', ''));
export const REDIS_URL = normalizeRedisUrl(KEY_VALUE_STORE_URL_RAW, KEY_VALUE_STORE_PASSWORD);
/** Single source of truth: whether a shared key-value backend is available. */
export const isRedisConfigured = REDIS_URL.length > 0;
export const SQUADRULES_REDIS_PREFIX = getEnvString('SQUADRULES_KEY_VALUE_PREFIX', getEnvString('SQUADRULES_REDIS_PREFIX', 'squadrules:'));
export const OIDC_STATE_KEY_PREFIX = 'oidc-state:';
/**
 * Ordered URI hints emitted as the `squadrules_local_artifact_dir` response field
 * (preferred first). The client resolves a hint on its own filesystem and
 * exports `SQUADRULES_LOCAL_ARTIFACT_DIR`
 * for shell challenges. Override the defaults via the comma-separated env
 * `SQUADRULES_LOCAL_ARTIFACT_DIRS`.
 */
export const SQUADRULES_LOCAL_ARTIFACT_DIRS: readonly string[] = parseLocalArtifactDirHints(
  getEnvString('SQUADRULES_LOCAL_ARTIFACT_DIRS', SQUADRULES_LOCAL_ARTIFACT_DIRS_DEFAULT)
);
/** Memory cache key prefix; keys starting with this are global (no space namespace). One key per UUID. */
export const MEMORY_CACHE_KEY_PREFIX = 'mem:';
export const OPENAI_EMBEDDING_MODEL = getEnvString('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small');
/** Base URL for OpenAI API (e.g. https://api.openai.com or Azure endpoint). No trailing slash. */
export const OPENAI_API_URL = getEnvString('OPENAI_API_URL', 'https://api.openai.com').replace(/\/$/, '');
export const OPENAI_API_KEY = getEnvString('OPENAI_API_KEY', '');
/** Embedding backend: 'auto' (default) | 'openai' | 'tei' | 'fastembed'. Auto prefers a configured
 * external provider, else the local fastembed default (issue #11). */
export const EMBEDDING_PROVIDER = getEnvString('EMBEDDING_PROVIDER', 'auto');
// FASTEMBED_MODEL / FASTEMBED_CACHE_DIR defaults live in ./config/embedding-fastembed.ts (max-lines).
export { FASTEMBED_MODEL, FASTEMBED_CACHE_DIR } from './config/embedding-fastembed.js';
// DEPRECATED (issue #11): TEI kept functional as an opt-in alternative; emits a startup warning.
export const TEI_BASE_URL = getEnvString('TEI_BASE_URL', '');
export const TEI_MODEL = getEnvString('TEI_MODEL', 'Alibaba-NLP/gte-large-en-v1.5');
export const TEI_API_KEY = getEnvString('TEI_API_KEY', '');
export const EMBEDDING_LATENCY_WARN_MS = getEnvInt('EMBEDDING_LATENCY_WARN_MS', 5000);
export const EMBEDDING_NORM_MIN = getEnvFloat('EMBEDDING_NORM_MIN', 0.5);
export const EMBEDDING_NORM_MAX = getEnvFloat('EMBEDDING_NORM_MAX', 2.0);
/** Retry policy for embedding 429/5xx/network. Exponential backoff+jitter; Retry-After honored; insufficient_quota fails fast. */
export const EMBEDDING_MAX_RETRIES = Math.max(0, getEnvInt('EMBEDDING_MAX_RETRIES', 2));
export const EMBEDDING_RETRY_BASE_DELAY_MS = Math.max(0, getEnvInt('EMBEDDING_RETRY_BASE_DELAY_MS', 500));
export const EMBEDDING_RETRY_MAX_DELAY_MS = Math.max(1, getEnvInt('EMBEDDING_RETRY_MAX_DELAY_MS', 8_000));
export const EMBEDDING_RETRY_AFTER_CAP_MS = Math.max(1, getEnvInt('EMBEDDING_RETRY_AFTER_CAP_MS', 10_000));
/** Total wall-clock budget for all embedding retries. Once exceeded, no further retries. */
export const EMBEDDING_RETRY_BUDGET_MS = Math.max(1, getEnvInt('EMBEDDING_RETRY_BUDGET_MS', 15_000));
/** Wall-clock cap for comment PoW semantic check. On timeout, fail open. Set to 0 to skip. */
export const COMMENT_SEMANTIC_VALIDATION_TIMEOUT_MS = getEnvInt('COMMENT_SEMANTIC_VALIDATION_TIMEOUT_MS', 10_000);
export const SEARCH_SCORE_WARN_THRESHOLD = getEnvFloat('SEARCH_SCORE_WARN_THRESHOLD', 0.1);
export const LOG_LEVEL = getEnvString('LOG_LEVEL', 'info');
export const LOG_FORMAT = getEnvString('LOG_FORMAT', 'text');
export const AUDIT_LOG_FILE = getEnvString('AUDIT_LOG_FILE', '').trim();
/**
 * Verbosity for MCP audit events written to AUDIT_LOG_FILE (0-3).
 * 0 = off, 1 = metadata only, 2 = + request args, 3 = + response body.
 * Existing audit.embedding / audit.anomaly events are unaffected.
 */
export const AUDIT_LOG_LEVEL = Math.max(0, Math.min(3, getEnvInt('AUDIT_LOG_LEVEL', 1)));
export const QDRANT_API_KEY = getEnvString('QDRANT_API_KEY', '');
export const QDRANT_COLLECTION_CURRENT = getEnvString('QDRANT_COLLECTION_CURRENT', '');
export const SQUADRULES_SEARCH_OVERFETCH_FACTOR = getEnvString('SQUADRULES_SEARCH_OVERFETCH_FACTOR', '4');
export const SQUADRULES_SEARCH_MAX_FETCH = getEnvInt('SQUADRULES_SEARCH_MAX_FETCH', 200);
/** Default number of match choices returned by search when the agent omits max_choices. */
export const SQUADRULES_SEARCH_MAX_CHOICES = getEnvInt('SQUADRULES_SEARCH_MAX_CHOICES', 10);
/** Absolute cap for search max_choices (prevents abuse and excessive resolveHead latency). */
export const SQUADRULES_SEARCH_LIMIT_CAP = getEnvInt('SQUADRULES_SEARCH_LIMIT_CAP', 50);
/** Minimum match choices when agent passes max_choices. */
export const SQUADRULES_SEARCH_LIMIT_MIN = getEnvInt('SQUADRULES_SEARCH_LIMIT_MIN', 5);
export const SQUADRULES_ENABLE_GROUP_COLLAPSE = getEnvBoolean('SQUADRULES_ENABLE_GROUP_COLLAPSE', true);
export const HTTP_JSON_BODY_LIMIT = getEnvString('HTTP_JSON_BODY_LIMIT', '1mb');
/** Max body size for POST /api/train/raw (`HTTP_TRAIN_RAW_BODY_LIMIT`, default 2mb). */
export const HTTP_TRAIN_RAW_BODY_LIMIT = getEnvString('HTTP_TRAIN_RAW_BODY_LIMIT', '2mb');

export const HTTP_RATE_LIMIT_WINDOW_MS = getEnvInt('HTTP_RATE_LIMIT_WINDOW_MS', 60_000);
export const HTTP_RATE_LIMIT_MAX = getEnvInt('HTTP_RATE_LIMIT_MAX', 10_000);
export const AUTH_RATE_LIMIT_WINDOW_MS = getEnvInt('AUTH_RATE_LIMIT_WINDOW_MS', 60_000);
export const AUTH_RATE_LIMIT_MAX = getEnvInt('AUTH_RATE_LIMIT_MAX', 10);
export const MCP_RATE_LIMIT_WINDOW_MS = getEnvInt('MCP_RATE_LIMIT_WINDOW_MS', 60_000);
export const MCP_RATE_LIMIT_MAX = getEnvInt('MCP_RATE_LIMIT_MAX', 1000);
/**
 * When true, served MCP App widget HTML skips `ui/initialize` / `initialized` and ignores
 * tool-result notifications (static chrome only). Use to isolate host crashes tied to the bridge.
 */
export const SQUADRULES_MCP_WIDGET_PRESENTATION_ONLY = getEnvBoolean('SQUADRULES_MCP_WIDGET_PRESENTATION_ONLY', false);
// Auth (Keycloak OIDC). One Keycloak per env: each env file sets KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID.
// AUTH_ENABLED defaults to true. If it is explicitly set to true, missing auth env is a startup error.
// If it is left unset and auth env is incomplete, the server stays fail-closed at request time.
export const AUTH_ENABLED = getEnvBoolean('AUTH_ENABLED', true);
export const KEYCLOAK_URL = getEnvString('KEYCLOAK_URL', '');
/** When set, used for server-side calls (e.g. token exchange). When unset, KEYCLOAK_URL is used. Use keycloak:8080 in Docker. */
export const KEYCLOAK_INTERNAL_URL = getEnvString('KEYCLOAK_INTERNAL_URL', '');
export const KEYCLOAK_REALM = getEnvString('KEYCLOAK_REALM', 'squadrules-dev');
export const KEYCLOAK_CLIENT_ID = getEnvString('KEYCLOAK_CLIENT_ID', 'squadrules-mcp');
/** CLI browser login: public client ID (e.g. squadrules-cli). Overridable at runtime by KEYCLOAK_CLI_CLIENT_ID. */
export const KEYCLOAK_CLI_CLIENT_ID = getEnvString('KEYCLOAK_CLI_CLIENT_ID', 'squadrules-cli');
/** Base URL for redirect_uri (e.g. http://localhost:3500). Must match Keycloak client redirect URIs. */
export const AUTH_CALLBACK_BASE_URL = getEnvString('AUTH_CALLBACK_BASE_URL', '');
export const SESSION_SECRET = getEnvString('SESSION_SECRET', '');
/** Session cookie and payload exp lifetime in seconds; default 7 hours. */
export const SESSION_MAX_AGE_SEC = getEnvInt('SESSION_MAX_AGE_SEC', 25_200);

/**
 * Comma-separated scopes advertised from `/.well-known/oauth-protected-resource`.
 * Defaults to the baseline OIDC scopes required by SquadRules discovery; set explicitly
 * to add scopes such as `offline_access` without rebuilding the container image.
 */
export const OIDC_SCOPES_SUPPORTED: readonly string[] = parseOidcScopesSupported(
  process.env['SQUADRULES_OIDC_SCOPES_SUPPORTED']
);

/** When set to oidc_bearer, Bearer tokens are validated (issuer, audience, exp); when unset, Bearer presence only (backward compat). */
export const AUTH_MODE = getEnvString('AUTH_MODE', '');
/** Comma-separated list of trusted JWT issuers (e.g. http://keycloak:8080/realms/squadrules-dev). Required when AUTH_MODE=oidc_bearer. */
export const AUTH_TRUSTED_ISSUERS_STRING = getEnvString('AUTH_TRUSTED_ISSUERS', '');
/** Comma-separated list of allowed JWT audiences (e.g. squadrules-mcp). Required when AUTH_MODE=oidc_bearer. */
export const AUTH_ALLOWED_AUDIENCES_STRING = getEnvString('AUTH_ALLOWED_AUDIENCES', '');
/**
 * Comma-separated group names (or /paths) allowed in the SQUADRULES auth session after OIDC.
 * Only JWT `groups` entries that match any entry are kept:
 * exact name or path (slash optional), or a **prefix** entry ending with `/` (e.g. `/shared/`
 * keeps every group whose path starts with that prefix). Matching is **case-insensitive** for paths.
 * Empty = do not filter: keep all token `groups` (recommended default so group spaces match IdP membership).
 * To restrict, set entries; to approximate “no group spaces”, use an allowlist that matches nothing you issue (e.g. a dedicated sentinel name).
 * Keycloak still issues full membership in the JWT; this filter controls what SQUADRULES forwards internally when non-empty.
 */
export const OIDC_GROUPS_ALLOWLIST: readonly string[] = (() => {
  const raw = getEnvString('OIDC_GROUPS_ALLOWLIST', '').trim();
  if (!raw) return Object.freeze([]);
  return Object.freeze(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
})();

/**
 * Bearer MCP auth: union groups from the verified access JWT with groups from OIDC userinfo (default true).
 * Browser sessions merge id_token + access_token; Bearer clients often send an access token whose `groups`
 * claim is incomplete or absent while userinfo still lists full membership — without merging, `spaces` omits
 * group rows even though the UI (session) shows them.
 */
export const OIDC_BEARER_MERGE_USERINFO_GROUPS = getEnvBoolean('OIDC_BEARER_MERGE_USERINFO_GROUPS', true);

/**
 * Suffix appended when building the example group path from a path-prefix
 * allowlist entry (see GROUP_SPACE_PATH_EXAMPLE). Default `pe-team`.
 */
const SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX_RAW = getEnvString('SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX', 'pe-team').trim();
export const SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX =
  SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX_RAW.length > 0
    ? SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX_RAW
    : 'pe-team';

/**
 * Derive an illustrative full group path from the first path-prefix entry in
 * `OIDC_GROUPS_ALLOWLIST` (entry ending with `/`). Returns null if none.
 */
export function deriveGroupSpacePathExampleFromAllowlist(
  allowlist: readonly string[],
  suffix: string
): string | null {
  for (const entry of allowlist) {
    const e = entry.trim();
    if (e.endsWith('/') && e.length > 1) {
      const base = e.replace(/\/+$/, '');
      return `${base}/${suffix}`;
    }
  }
  return null;
}

/**
 * Example group path interpolated into MCP tool descriptions (`activate`, `spaces`,
 * `train`, `tune`) at process start.
 *
 * - Set **`SQUADRULES_GROUP_SPACE_PATH_EXAMPLE`** to override completely.
 * - Otherwise, if **`OIDC_GROUPS_ALLOWLIST`** contains a path-prefix entry (e.g. `/shared/`),
 *   the example is `{prefix-without-trailing-slash}/{SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX}`.
 * - Otherwise default **`/shared/{suffix}`** (suffix from `SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX`).
 */
export const GROUP_SPACE_PATH_EXAMPLE: string = (() => {
  const explicit = getEnvString('SQUADRULES_GROUP_SPACE_PATH_EXAMPLE', '').trim();
  if (explicit) return explicit;
  const derived = deriveGroupSpacePathExampleFromAllowlist(
    OIDC_GROUPS_ALLOWLIST,
    SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX
  );
  if (derived) return derived;
  return `/shared/${SQUADRULES_GROUP_SPACE_EXAMPLE_SUFFIX}`;
})();

/** Main HTTP listener when `TRANSPORT_TYPE=http`: UI, REST API, and Streamable HTTP MCP. Ignored in stdio mode (no HTTP server). */
export const SERVER_PORT = getEnvInt('SERVER_PORT', 3000);

const AUTH_ENABLED_EXPLICIT = process.env['AUTH_ENABLED'] !== undefined;

if (AUTH_ENABLED && AUTH_ENABLED_EXPLICIT) {
  const missing: string[] = [];
  if (!KEYCLOAK_URL.trim()) missing.push('KEYCLOAK_URL');
  if (!KEYCLOAK_REALM.trim()) missing.push('KEYCLOAK_REALM');
  if (!KEYCLOAK_CLIENT_ID.trim()) missing.push('KEYCLOAK_CLIENT_ID');
  if (!AUTH_CALLBACK_BASE_URL.trim()) missing.push('AUTH_CALLBACK_BASE_URL');
  if (!SESSION_SECRET.trim()) missing.push('SESSION_SECRET');
  if (missing.length > 0) {
    throw new Error(
      `AUTH_ENABLED=true requires non-empty env: ${missing.join(', ')}. Set them in .env. See docs/install/README.md.`
    );
  }
}
export const QDRANT_RESCORE_STRING = getEnvString('QDRANT_RESCORE', 'true');
/** When non-empty, backup/snapshot is enabled; app creates dir if missing. Empty = not configured → 503 on POST /api/snapshot. */
export const QDRANT_SNAPSHOT_ON_START = getEnvBoolean('QDRANT_SNAPSHOT_ON_START', false);
const QDRANT_SNAPSHOT_DIR_RAW = getEnvString('QDRANT_SNAPSHOT_DIR', '').trim();
export const QDRANT_SNAPSHOT_DIR =
  QDRANT_SNAPSHOT_DIR_RAW === ''
    ? ''
    : path.isAbsolute(QDRANT_SNAPSHOT_DIR_RAW)
      ? QDRANT_SNAPSHOT_DIR_RAW
      : path.resolve(QDRANT_SNAPSHOT_DIR_RAW);

// Int configurations
export const METRICS_PORT = getEnvInt('METRICS_PORT', 9090);
/** Raw env: positive = override, -1 = disabled, 0 or unset = auto-detect from cgroup/memory. */
export const MAX_CONCURRENT_MCP_REQUESTS_RAW = getEnvInt('MAX_CONCURRENT_MCP_REQUESTS', 0);

// Float configurations (tunable via env; relaxed defaults so more results pass into choices)
export const SCORE_THRESHOLD = getEnvFloat('SCORE_THRESHOLD', 0.5);
/** Similar-memory: score >= this value triggers SIMILAR_MEMORY_FOUND. Set SIMILAR_MEMORY_THRESHOLD=1 to effectively disable. */
export const SIMILAR_MEMORY_THRESHOLD = getEnvFloat('SIMILAR_MEMORY_THRESHOLD', 0.9);

/** Attest boost: below this many runs we do not apply boost. */
export const MIN_ATTEST_RUNS = getEnvInt('MIN_ATTEST_RUNS', 3);
/** Attest boost: at this many runs confidence is 1. */
export const RUNS_FULL_CONFIDENCE = getEnvInt('RUNS_FULL_CONFIDENCE', 10);
/** Max additive boost from attest (tiebreaker within RRF bands). */
export const ATTEST_BOOST_MAX = getEnvFloat('ATTEST_BOOST_MAX', 0.08);

// Transport: stdio | http. Default http for non-CLI entrypoints (Docker/CI/bootstrap).
// `squadrules serve` sets SQUADRULES_CLI_SERVE=1 before spawning bootstrap so missing TRANSPORT_TYPE defaults to stdio there only.
const _cliServeValue = process.env['SQUADRULES_CLI_SERVE'];
const _transportDefault =
  _cliServeValue === '1' && !process.env['TRANSPORT_TYPE']?.trim() ? 'stdio' : 'http';
const TRANSPORT_TYPE_RAW = getEnvString('TRANSPORT_TYPE', _transportDefault);
export const TRANSPORT_TYPE: 'stdio' | 'http' =
  TRANSPORT_TYPE_RAW === 'http' ? 'http' : 'stdio';

// Required (throw at startup if missing)
export function getQdrantUrl(): string {
  return getEnvRequired('QDRANT_URL');
}

export function getQdrantCollection(defaultValue = 'squadrules'): string {
  return getEnvString('QDRANT_COLLECTION', defaultValue);
}

/** Whether an external Qdrant server is set (non-empty); else embedded LanceDB is selected. Mirrors `isRedisConfigured`. */
export const isQdrantConfigured = (process.env['QDRANT_URL'] ?? '').trim().length > 0;

// Trusted issuers: from env, or from KEYCLOAK_URL/REALM when unset. Add loopback alias (localhost <-> 127.0.0.1) so tokens match either.
const _authIssuersFromEnv = AUTH_TRUSTED_ISSUERS_STRING.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const _authIssuersBase =
  _authIssuersFromEnv.length > 0
    ? _authIssuersFromEnv
    : KEYCLOAK_URL && KEYCLOAK_REALM
      ? [`${KEYCLOAK_URL.replace(/\/$/, '')}/realms/${KEYCLOAK_REALM}`]
      : [];
const _authIssuersExpanded: string[] = [];
for (const iss of _authIssuersBase) {
  _authIssuersExpanded.push(iss);
  if (iss.includes('localhost')) {
    const other = iss.replace(/localhost/g, '127.0.0.1');
    if (!_authIssuersExpanded.includes(other)) _authIssuersExpanded.push(other);
  } else if (iss.includes('127.0.0.1')) {
    const other = iss.replace(/127\.0\.0\.1/g, 'localhost');
    if (!_authIssuersExpanded.includes(other)) _authIssuersExpanded.push(other);
  }
}
export const AUTH_TRUSTED_ISSUERS = _authIssuersExpanded;

// Allowed audiences: from env if set (explicit config wins), or default to server + CLI client IDs + account.
// If AUTH_ALLOWED_AUDIENCES is explicitly set, use it as-is (no magic injection).
const _authAudFromEnv = AUTH_ALLOWED_AUDIENCES_STRING.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const _authAudDefault: string[] = [];
if (KEYCLOAK_CLIENT_ID) _authAudDefault.push(KEYCLOAK_CLIENT_ID);
if (KEYCLOAK_CLI_CLIENT_ID && KEYCLOAK_CLI_CLIENT_ID !== KEYCLOAK_CLIENT_ID) {
  _authAudDefault.push(KEYCLOAK_CLI_CLIENT_ID);
}
const _authAudBase = _authAudFromEnv.length > 0 ? _authAudFromEnv : _authAudDefault;
// Add "account" for Keycloak access tokens when we have realm issuers
const _hasKeycloakRealm = _authIssuersBase.some((u) => u.includes('/realms/'));
export const AUTH_ALLOWED_AUDIENCES =
  _hasKeycloakRealm && !_authAudBase.includes('account')
    ? [..._authAudBase, 'account']
    : _authAudBase;
/** Embedded mem / default search space when AUTH_ENABLED=false; must follow space model (e.g. space:squadrules-app). */
export const SQUADRULES_APP_SPACE_ID = getEnvString('SQUADRULES_APP_SPACE_ID', 'space:squadrules-app');
/** Simple-mode writable personal space id when AUTH_ENABLED=false and UUIDv5 seed override is not provided. */
export const SQUADRULES_SIMPLE_PERSONAL_SPACE_ID = getEnvString('SQUADRULES_SIMPLE_PERSONAL_SPACE_ID', 'space:personal');
export const SQUADRULES_SIMPLE_PERSONAL_REALM = getEnvString('SQUADRULES_SIMPLE_PERSONAL_REALM', 'squadrules-simple');
export const SQUADRULES_SIMPLE_PERSONAL_UUIDV5_SEED = getEnvString('SQUADRULES_SIMPLE_PERSONAL_UUIDV5_SEED', '').trim();
