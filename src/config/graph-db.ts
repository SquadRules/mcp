/**
 * Embedded graph database placement and switch (SquadRules 6, Touchpoint 1) — kept out
 * of `config.ts` to satisfy the max-lines budget, following the `src/config/*`
 * convention (see `mem-boot.ts`).
 *
 * LadybugDB is framework-internal bookkeeping: the adapter/concept graph has no MCP
 * tool and no HTTP route, so these two variables are its only operator controls.
 * Failure to open the database is a startup warning, never a boot failure — the
 * degradation contract lives in `services/graph-db/graph-db-singleton.ts`. `/health`
 * separately reports the graph and fails readiness (503) when it is enabled but
 * unavailable (see `http/http-health-routes.ts`).
 *
 * Env:
 *   `SQUADRULES_GRAPH_DB_PATH`    Directory holding the database. Default: `graph-db`
 *                                 under the shared SquadRules dir, i.e. a sibling of the
 *                                 embedded LanceDB store (`resolveLanceDbDir()`), so one
 *                                 `SQUADRULES_HOME` move relocates both stores together.
 *   `SQUADRULES_GRAPH_DB_ENABLED` Boolean, default `true`. `false` skips init entirely.
 */
import { isAbsolute, join, resolve } from 'node:path';
import { getSquadrulesConfigDir } from '../utils/squadrules-user-dirs.js';

/**
 * Env-parsed boolean. Unlike the positive-list helper in `mem-boot.ts`, a switch whose
 * default is `true` must also recognise an explicit **false**, so this follows the
 * `config.ts` shape: false-y words → false, truthy words → true, anything else (or
 * unset) → the default.
 */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const low = String(val).trim().toLowerCase();
  if (low === 'false' || low === '0' || low === 'no' || low === 'n') return false;
  if (low === 'true' || low === '1' || low === 'yes' || low === 'y') return true;
  return defaultValue;
}

/** Directory name under the shared SquadRules dir (sibling of `lancedb`). */
const GRAPH_DB_DIR_NAME = 'graph-db';

/** Master switch for the embedded graph database. Read once at process start. */
export const GRAPH_DB_ENABLED = getEnvBoolean('SQUADRULES_GRAPH_DB_ENABLED', true);

/**
 * Resolve the directory holding the embedded LadybugDB database.
 *
 * A function rather than a module constant, matching `resolveLanceDbDir()`: the base
 * directory is created on demand by `getSquadrulesConfigDir()`, and freezing it at
 * import time would ignore an `SQUADRULES_HOME` set later in the boot sequence.
 * A relative `SQUADRULES_GRAPH_DB_PATH` is resolved against the process working
 * directory (same treatment as `QDRANT_SNAPSHOT_DIR`).
 */
export function resolveGraphDbDir(): string {
  const raw = process.env['SQUADRULES_GRAPH_DB_PATH'];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length > 0) {
    return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
  }
  return join(getSquadrulesConfigDir(), GRAPH_DB_DIR_NAME);
}

/**
 * Env-parsed non-negative integer. Invalid values fall back to the default rather than
 * throwing: an operator typo must not take the runtime down.
 */
function getEnvNonNegativeInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

/**
 * Directory holding inheritance checkpoints for THIS runtime instance.
 *
 * Default: a sibling of the graph database (`<graph-db>/inheritance-checkpoints`), so the
 * directory moves with `SQUADRULES_GRAPH_DB_PATH` / `SQUADRULES_HOME` and a second
 * runtime with its own graph directory never replays the first runtime's checkpoints.
 * `SQUADRULES_INHERITANCE_CHECKPOINT_DIR` overrides the whole path.
 *
 * Checkpoints are recovery metadata, not proofs (see
 * `services/graph-db/inheritance-checkpoint.ts`).
 */
export function resolveInheritanceCheckpointDir(): string {
  const raw = process.env['SQUADRULES_INHERITANCE_CHECKPOINT_DIR'];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length > 0) {
    return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
  }
  return join(resolveGraphDbDir(), 'inheritance-checkpoints');
}

/**
 * Time-to-live for an abandoned inheritance checkpoint.
 *
 * `SQUADRULES_INHERITANCE_CHECKPOINT_TTL_HOURS`, default 24. `0` disables expiry (the
 * checkpoint then survives until terminal cleanup or manual removal).
 */
export const INHERITANCE_CHECKPOINT_TTL_MS =
  getEnvNonNegativeInt('SQUADRULES_INHERITANCE_CHECKPOINT_TTL_HOURS', 24) * 60 * 60 * 1000;

/**
 * Display depth for an ancestry tree in tool output.
 *
 * `SQUADRULES_TREE_DISPLAY_DEPTH`, default `0` = full tree. This trims ONLY the surfaced
 * `lineage` list; it never trims the effective content, the effective contracts, or the
 * materialisation walk — a display preference must not change what `forward` executes.
 */
export const TREE_DISPLAY_DEPTH = getEnvNonNegativeInt('SQUADRULES_TREE_DISPLAY_DEPTH', 0);
