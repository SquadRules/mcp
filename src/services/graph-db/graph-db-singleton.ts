/**
 * Graph repository lifecycle and backend selection.
 *
 * Two entry points, deliberately separate:
 *
 *   `openGraphDb()`  Factory. Chooses the backend the operator configured and opens
 *                    it. Every caller that opens a graph owns it and closes it; two
 *                    instances opened this way are independent — separate handles,
 *                    separate lifetimes — which is what a second runtime in the same
 *                    process (or an isolated test fixture) needs.
 *
 *   `initGraphDb()`  Boot adapter. `openGraphDb()` plus registration for process
 *                    shutdown. It never memoizes: a second boot in the same process
 *                    gets its own instance and its own close.
 *
 * Backend selection is explicit (docs/adr/0044):
 *
 *   `SQUADRULES_GRAPH_BACKEND=embedded`  LadybugDB (default).
 *   `SQUADRULES_GRAPH_BACKEND=arango`    ArangoDB <= 3.11.
 *
 * A failing Arango deployment is **never** replaced by a local embedded file. The
 * open either returns `null` (degraded: no graph bookkeeping, error logged) or, with
 * `SQUADRULES_GRAPH_BACKEND_STRICT=true`, throws so a misconfiguration cannot hide.
 *
 * Framework-internal bookkeeping: no MCP tool, no HTTP route. The open here never
 * throws; readiness is surfaced by `/health`, which reports the graph and fails (503)
 * when it is enabled but unavailable (see http/http-health-routes.ts).
 */
import { structuredLogger } from '../../utils/structured-logger.js';
import { GRAPH_DB_ENABLED, resolveGraphDbDir } from '../../config/graph-db.js';
import {
  resolveGraphBackendKind,
  type ArangoConnectionConfig,
  type GraphBackendKind
} from '../../config/graph-backend.js';
import type { GraphRepository } from './graph-repository.js';
import { GraphDatabaseService } from './graph-database.service.js';
import { ArangoGraphRepository } from './arango/arango-graph-repository.js';

/** Graphs opened through `initGraphDb()`, closed together on process shutdown. */
const bootInstances = new Set<GraphRepository>();

export interface OpenGraphDbOptions {
  /** Directory holding the embedded database. Default: `resolveGraphDbDir()`. */
  databaseDir?: string;
  /** Master switch override. Default: `SQUADRULES_GRAPH_DB_ENABLED`. */
  enabled?: boolean;
  /** Backend override for tests/diagnostics. Default: `SQUADRULES_GRAPH_BACKEND`. */
  backend?: GraphBackendKind;
  /** ArangoDB connection override. Default: env-resolved configuration. */
  arango?: ArangoConnectionConfig;
}

function strictMode(): boolean {
  return (process.env['SQUADRULES_GRAPH_BACKEND_STRICT'] ?? '').trim().toLowerCase() === 'true';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function openEmbedded(options: OpenGraphDbOptions): Promise<GraphRepository | null> {
  const databaseDir = options.databaseDir ?? resolveGraphDbDir();
  let service: GraphDatabaseService | null = null;
  try {
    service = new GraphDatabaseService(databaseDir);
    await service.initialize();
    return service;
  } catch (err) {
    if (service) {
      try {
        await service.close();
      } catch {
        // A broken handle has nothing useful left to report.
      }
    }
    structuredLogger.warn(
      `graph db: embedded init failed at "${databaseDir}" (${describeError(err)}) — continuing without graph bookkeeping`
    );
    return null;
  }
}

async function openArango(options: OpenGraphDbOptions): Promise<GraphRepository | null> {
  try {
    const repository = new ArangoGraphRepository(options.arango);
    await repository.initialize();
    const capabilities = repository.getCapabilities();
    structuredLogger.debug(
      `graph db: arango ${capabilities?.version ?? 'unknown'} ready (transactions ${capabilities?.streamTransactions ?? 'unverified'})`
    );
    return repository;
  } catch (err) {
    const message = `graph db: arango unavailable (${describeError(err)}) — no embedded fallback is used`;
    if (strictMode()) {
      structuredLogger.error(message);
      throw err;
    }
    structuredLogger.error(`${message}; continuing without graph bookkeeping`);
    return null;
  }
}

/**
 * Open the configured graph repository. Never throws unless
 * `SQUADRULES_GRAPH_BACKEND_STRICT=true`.
 *
 * @returns the opened repository, or `null` when the graph is disabled or the
 *          selected backend failed. Callers must treat `null` as "no graph
 *          bookkeeping for this run".
 */
export async function openGraphDb(
  options: OpenGraphDbOptions = {}
): Promise<GraphRepository | null> {
  const enabled = options.enabled ?? GRAPH_DB_ENABLED;
  if (!enabled) {
    structuredLogger.debug('graph db: disabled (SQUADRULES_GRAPH_DB_ENABLED=false)');
    return null;
  }

  let kind: GraphBackendKind;
  try {
    kind = options.backend ?? resolveGraphBackendKind();
  } catch (err) {
    const message = `graph db: invalid backend configuration (${describeError(err)})`;
    if (strictMode()) {
      structuredLogger.error(message);
      throw err;
    }
    structuredLogger.error(`${message}; continuing without graph bookkeeping`);
    return null;
  }

  return kind === 'arango' ? openArango(options) : openEmbedded(options);
}

/**
 * Open the graph for a runtime boot and register it for shutdown.
 *
 * A second call opens a second, independent instance: budgets and fixtures that boot
 * twice must not share one database handle.
 */
export async function initGraphDb(
  options: OpenGraphDbOptions = {}
): Promise<GraphRepository | null> {
  const repository = await openGraphDb(options);
  if (repository) bootInstances.add(repository);
  return repository;
}

/**
 * Close every graph opened through `initGraphDb()` and forget them. Graphs a caller
 * opened directly with `openGraphDb()` are untouched — their creator closes them.
 */
export async function closeGraphDb(): Promise<void> {
  const instances = [...bootInstances];
  bootInstances.clear();
  for (const repository of instances) {
    try {
      await repository.close();
    } catch (err) {
      structuredLogger.debug(`graph db: close failed (${describeError(err)})`);
    }
  }
}
