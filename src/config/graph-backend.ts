/**
 * Graph backend selection and ArangoDB connection configuration.
 *
 * The backend is an explicit operator decision, never an implicit fallback:
 *
 *   `SQUADRULES_GRAPH_BACKEND=embedded`  (default) LadybugDB, embedded, MIT.
 *   `SQUADRULES_GRAPH_BACKEND=arango`    ArangoDB <= 3.11, shared, Apache-2.0.
 *
 * When `arango` is selected this module never resolves a local directory and the
 * runtime never substitutes an embedded file for a failing remote — a remote
 * failure degrades to "no graph", loudly, instead of silently reading other data.
 *
 * @see docs/adr/0044-graph-repository-port-and-arango-shared-backend.md
 */
import { isAbsolute } from 'node:path';

export type GraphBackendKind = 'embedded' | 'arango';

/** Raised when the operator's backend configuration cannot be used as written. */
export class GraphBackendConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphBackendConfigError';
  }
}

export interface ArangoConnectionConfig {
  /** Base URL without a trailing slash, e.g. `http://127.0.0.1:8529`. */
  url: string;
  database: string;
  username?: string;
  password?: string;
  timeoutMs: number;
}

/**
 * ArangoDB series this repository supports and tests against.
 *
 * The upper bound is deliberate: 3.12 changed transaction internals, so the
 * capability probe is pinned to the series the shared tests actually run on.
 * Older 3.x lines are also rejected rather than assumed compatible.
 */
export const SUPPORTED_ARANGO_SERIES = { minMinor: 10, maxMinor: 11, major: 3 } as const;

/** Parse `3.11.4` (or `3.11`) into a comparable `{major, minor}` pair. */
export function parseArangoVersion(version: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** Throws unless the server reports a supported ArangoDB series. */
export function assertSupportedArangoVersion(version: string): void {
  const parsed = parseArangoVersion(version);
  if (!parsed) {
    throw new GraphBackendConfigError(
      `ArangoDB reported an unparseable version "${version}"; expected ${SUPPORTED_ARANGO_SERIES.major}.${SUPPORTED_ARANGO_SERIES.minMinor}–${SUPPORTED_ARANGO_SERIES.major}.${SUPPORTED_ARANGO_SERIES.maxMinor}`
    );
  }
  const withinSeries =
    parsed.major === SUPPORTED_ARANGO_SERIES.major &&
    parsed.minor >= SUPPORTED_ARANGO_SERIES.minMinor &&
    parsed.minor <= SUPPORTED_ARANGO_SERIES.maxMinor;
  if (!withinSeries) {
    throw new GraphBackendConfigError(
      `ArangoDB ${version} is not supported; this repository supports ${SUPPORTED_ARANGO_SERIES.major}.${SUPPORTED_ARANGO_SERIES.minMinor}–${SUPPORTED_ARANGO_SERIES.major}.${SUPPORTED_ARANGO_SERIES.maxMinor} only`
    );
  }
}

/** Resolve the configured backend. An unknown value is a configuration error. */
export function resolveGraphBackendKind(): GraphBackendKind {
  const raw = (process.env['SQUADRULES_GRAPH_BACKEND'] ?? 'embedded').trim().toLowerCase();
  if (raw === '' || raw === 'embedded' || raw === 'ladybug' || raw === 'ladybugdb') {
    return 'embedded';
  }
  if (raw === 'arango' || raw === 'arangodb') {
    return 'arango';
  }
  throw new GraphBackendConfigError(
    `SQUADRULES_GRAPH_BACKEND="${raw}" is not a known backend; use "embedded" or "arango"`
  );
}

function requireEnv(key: string): string {
  const raw = process.env[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) {
    throw new GraphBackendConfigError(
      `${key} is required when SQUADRULES_GRAPH_BACKEND=arango (no embedded fallback is used)`
    );
  }
  return value;
}

function parseTimeout(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}

/**
 * Read the ArangoDB connection settings.
 *
 * Missing `SQUADRULES_ARANGO_URL` or `SQUADRULES_ARANGO_DATABASE` throws: the
 * runtime must not invent a remote, and it must not fall back to an embedded file
 * when the operator asked for the shared backend.
 */
export function resolveArangoConnectionConfig(): ArangoConnectionConfig {
  const url = requireEnv('SQUADRULES_ARANGO_URL');
  if (!/^https?:\/\//i.test(url)) {
    throw new GraphBackendConfigError(
      `SQUADRULES_ARANGO_URL must start with http:// or https:// (got "${url}")`
    );
  }
  const database = requireEnv('SQUADRULES_ARANGO_DATABASE');
  const username = process.env['SQUADRULES_ARANGO_USERNAME']?.trim();
  const password = process.env['SQUADRULES_ARANGO_PASSWORD'];

  const config: ArangoConnectionConfig = {
    url: url.replace(/\/+$/, ''),
    database,
    timeoutMs: parseTimeout(process.env['SQUADRULES_ARANGO_TIMEOUT_MS'])
  };
  if (username) config.username = username;
  if (password !== undefined && password.length > 0) config.password = password;
  return config;
}

/** True when the operator explicitly selected the shared backend. */
export function isArangoBackendSelected(): boolean {
  return resolveGraphBackendKind() === 'arango';
}

/** Absolute path helper kept exported so embedded callers do not re-implement it. */
export function isAbsoluteDatabaseDir(dir: string): boolean {
  return isAbsolute(dir);
}
