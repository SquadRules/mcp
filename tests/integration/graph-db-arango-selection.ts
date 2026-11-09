/**
 * Shared-backend selection for the ArangoDB integration suites (ADR 0044, ADR 0048).
 *
 * The two Arango suites used to decide their own fate from `SQUADRULES_ARANGO_URL` and
 * `SQUADRULES_ARANGO_DATABASE` alone. That is correct for a developer running locally —
 * absence means "shared parity is unproven" and the suite says so loudly — but it is
 * wrong for a CI lane that exists to prove shared parity: a job whose `env:` block is
 * edited away would run zero tests and report green. `SQUADRULES_ARANGO_REQUIRED=true`
 * closes that hole: absence becomes a failing test naming the missing variables, so the
 * lane can never be satisfied by a skip.
 *
 * Selection is deliberately three-state, matching the suites' long-standing rule that a
 * half-configured environment is a failure rather than a silent fallback:
 *
 *   - `selected`  — a URL *or* a database is set. The suite runs; a missing half fails
 *                   its own completeness test. Never falls back to the embedded store.
 *   - `required`  — `SQUADRULES_ARANGO_REQUIRED` is truthy. With no configuration the
 *                   suite still must not pass, so the caller registers a failing test.
 *   - neither     — the suite skips loudly and the report must read "unproven".
 *
 * Pure function over an env bag: no I/O, so the contract is unit-testable on a host
 * without a container runtime.
 */

/** Environment variable that turns "unconfigured" into "failed" for a owning CI lane. */
export const ARANGO_REQUIRED_FLAG = 'SQUADRULES_ARANGO_REQUIRED';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export interface SharedBackendSelection {
  /** `SQUADRULES_ARANGO_URL`, trimmed. */
  url: string;
  /** `SQUADRULES_ARANGO_DATABASE`, trimmed. */
  database: string;
  /** A partial or complete shared configuration was supplied: the suite runs. */
  selected: boolean;
  /** The owning lane demanded shared evidence: absence must fail, never skip. */
  required: boolean;
  /** Names of the variables that are still missing, in a stable order. */
  missing: string[];
  /** Written to stderr when the suite is skipped, so the skip can never be silent. */
  skipBanner: string;
  /** Thrown by the registered failing test when `required` and unconfigured. */
  requirementMessage: string;
}

/**
 * Resolve the shared-backend suite contract from the process environment.
 * @param suite short suite name used in operator-facing messages
 * @param env environment bag; defaults to `process.env`
 */
export function selectSharedBackend(
  suite: string,
  env: NodeJS.ProcessEnv = process.env
): SharedBackendSelection {
  const url = (env['SQUADRULES_ARANGO_URL'] ?? '').trim();
  const database = (env['SQUADRULES_ARANGO_DATABASE'] ?? '').trim();
  const required = TRUTHY.has((env[ARANGO_REQUIRED_FLAG] ?? '').trim().toLowerCase());
  const missing = [
    ...(url.length === 0 ? ['SQUADRULES_ARANGO_URL'] : []),
    ...(database.length === 0 ? ['SQUADRULES_ARANGO_DATABASE'] : [])
  ];
  const runCommand =
    `    SQUADRULES_ARANGO_URL=http://127.0.0.1:8529 \\\n` +
    `    SQUADRULES_ARANGO_DATABASE=squadrules_it \\\n` +
    `    SQUADRULES_ARANGO_USERNAME=root SQUADRULES_ARANGO_PASSWORD=... \\\n` +
    `    NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/${suite}.test.ts --runInBand\n\n`;

  return {
    url,
    database,
    selected: url.length > 0 || database.length > 0,
    required,
    missing,
    skipBanner:
      `\n[${suite}] SKIPPED — SHARED-BACKEND PARITY IS NOT PROVEN.\n` +
      `  Run it against a real ArangoDB 3.10–3.11 with:\n${runCommand}`,
    requirementMessage:
      `[${suite}] ${ARANGO_REQUIRED_FLAG}=true but the shared backend is not configured ` +
      `(missing: ${missing.join(', ')}).\n` +
      `  This lane exists to prove shared parity; an unconfigured run is a failure, not a skip.\n${runCommand}`
  };
}
