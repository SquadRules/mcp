/**
 * Runtime-mode resolution: transport, auth posture and the local-mode guards.
 *
 * Two modes are supported and they are not interchangeable:
 *
 * - **simple** (transport `stdio`) — a local, single-user MCP server spawned by an
 *   agent host. Embedded LanceDB only, no HTTP listener, therefore no `/api`, `/ui`,
 *   metrics or OAuth callback surface, and no per-client space context.
 * - **cluster** (transport `http`) — the deployed posture: REST API, Streamable HTTP
 *   MCP, browser UI and metrics, with authentication on by default.
 *
 * Everything here is a pure function over an env record so the rules can be unit
 * tested without re-evaluating the module-level constants in `../config.ts`.
 */

export type TransportType = 'stdio' | 'http';

/**
 * Set by the `squadrules-mcp` bin before it loads the server: this process is a
 * local stdio MCP server, so stdio is the default transport.
 */
export const MCP_STDIO_ENV_KEY = 'SQUADRULES_MCP_STDIO';

/** Set by `squadrules serve` before it spawns the bootstrap module. */
export const CLI_SERVE_ENV_KEY = 'SQUADRULES_CLI_SERVE';

function nonEmpty(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Mirrors `getEnvBoolean` in `../config.ts`: unparseable or unset returns
 * `undefined` so the caller's mode-derived default still applies.
 */
function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const low = value.trim().toLowerCase();
  if (low === 'false' || low === '0' || low === 'no' || low === 'n') return false;
  if (low === 'true' || low === '1' || low === 'yes' || low === 'y') return true;
  return undefined;
}

/**
 * An explicit `TRANSPORT_TYPE` always wins. Otherwise stdio is selected only when the
 * process was launched as a local MCP server — through the `squadrules-mcp` bin or
 * `squadrules serve`. Every other entrypoint (compose, container CMD,
 * `node dist/index.js`) keeps the historical `http` default.
 */
export function resolveTransportType(env: NodeJS.ProcessEnv = process.env): TransportType {
  if (nonEmpty(env['TRANSPORT_TYPE'])) {
    return env['TRANSPORT_TYPE']!.trim().toLowerCase() === 'http' ? 'http' : 'stdio';
  }
  const localServerLaunch =
    env[MCP_STDIO_ENV_KEY] === '1' || env[CLI_SERVE_ENV_KEY] === '1';
  return localServerLaunch ? 'stdio' : 'http';
}

/**
 * `AUTH_ENABLED` follows the mode unless stated otherwise: on for `http`, where a
 * real OIDC surface exists, off for `stdio`, where there is nothing to authenticate
 * against and no client identity to build a space filter from. An explicit value
 * always wins, and stdio + explicit `AUTH_ENABLED=true` is rejected by
 * {@link getStdioConfigViolations} rather than silently half-working.
 */
export function resolveAuthEnabled(
  env: NodeJS.ProcessEnv = process.env,
  transport: TransportType = resolveTransportType(env)
): boolean {
  const explicit = parseEnvBoolean(env['AUTH_ENABLED']);
  if (explicit !== undefined) return explicit;
  return transport !== 'stdio';
}

/** Human name for logs and the startup banner; `mode` is derived, never configured. */
export function describeRuntimeMode(transport: TransportType): 'simple' | 'cluster' {
  return transport === 'stdio' ? 'simple' : 'cluster';
}

/**
 * Configuration that contradicts local simple mode. Returns messages instead of
 * throwing so the rules are directly testable; `../config.ts` turns them into a
 * startup error.
 *
 * Both checks exist because the failure is otherwise silent:
 *
 * - auth on under stdio leaves every request with an empty space allowlist, which
 *   matches nothing on read and writes to `space:no-auth`;
 * - a Qdrant URL under stdio points a "local" install at a shared server while the
 *   in-process caches still assume single-user isolation.
 */
export function getStdioConfigViolations(
  env: NodeJS.ProcessEnv = process.env,
  transport: TransportType = resolveTransportType(env),
  authEnabled: boolean = resolveAuthEnabled(env, transport)
): string[] {
  if (transport !== 'stdio') return [];

  const violations: string[] = [];

  if (authEnabled) {
    violations.push(
      'TRANSPORT_TYPE=stdio cannot enable authentication: a stdio server opens no HTTP ' +
      'listener, so there is no OIDC callback surface and no per-client space context — ' +
      'reads would match an empty space allowlist and writes would land in "space:no-auth". ' +
      `Set AUTH_ENABLED=false — already the default in ${describeRuntimeMode('stdio')} mode — for local single-user use, ` +
      'or TRANSPORT_TYPE=http for an authenticated deployment.'
    );
  }

  if (nonEmpty(env['QDRANT_URL'])) {
    violations.push(
      'TRANSPORT_TYPE=stdio is local simple mode and must use the embedded LanceDB store: ' +
      'a stdio process keeps its key-value/cache state in memory, so sharing an external ' +
      'Qdrant collection from it would leave that state per-process. Unset or empty ' +
      'QDRANT_URL for local mode, or run TRANSPORT_TYPE=http (for example ' +
      '`squadrules serve --transport http`) when a clustered backend is intended.'
    );
  }

  return violations;
}

/**
 * Turn {@link getStdioConfigViolations} into a startup error. Called from
 * `../config.ts` after the Keycloak validation, so the resolved constants above stay
 * importable (and testable) without side effects.
 */
export function assertStdioConfigConsistency(
  transport: TransportType = TRANSPORT_TYPE,
  authEnabled: boolean = AUTH_ENABLED
): void {
  const violations = getStdioConfigViolations(process.env, transport, authEnabled);
  if (violations.length > 0) {
    throw new Error(violations.join(' '));
  }
}

/**
 * Resolved once per process, like every other setting in `../config.ts`. They live
 * here because `AUTH_ENABLED` derives its default from the transport — and because
 * `src/config.ts` is at the `max-lines` limit; it re-exports these three.
 */
export const TRANSPORT_TYPE: TransportType = resolveTransportType(process.env);

/** See {@link resolveAuthEnabled}. */
export const AUTH_ENABLED: boolean = resolveAuthEnabled(process.env, TRANSPORT_TYPE);

/** Whether an external Qdrant server is set (non-empty); else embedded LanceDB is selected. Mirrors `isRedisConfigured`. */
export const isQdrantConfigured: boolean = (process.env['QDRANT_URL'] ?? '').trim().length > 0;
