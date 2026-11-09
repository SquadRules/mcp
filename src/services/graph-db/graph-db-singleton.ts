/**
 * Shared embedded graph database.
 *
 * Mirrors `embedded-store-singleton.ts`: ONE `GraphDatabaseService` held in a module
 * singleton so boot, the CLI local backend and the graph-aware tools added by later
 * SquadRules 6 touchpoints all resolve the same instance regardless of import order.
 * Unlike the LanceDB singleton, this one does not lazily construct: an unopened graph
 * must stay absent rather than be opened as a side effect of a getter.
 *
 * Framework-internal bookkeeping only (Touchpoint 1): no MCP tool, no HTTP route, no
 * health/status surface. The observable contract is the boot debug line plus the unit
 * test, and `initGraphDb()` therefore never throws — a failed open logs a warning,
 * clears the reference and the app boots without the graph.
 */
import { structuredLogger } from '../../utils/structured-logger.js';
import { GRAPH_DB_ENABLED, resolveGraphDbDir } from '../../config/graph-db.js';
import { GraphDatabaseService } from './graph-database.service.js';

let instance: GraphDatabaseService | null = null;

/**
 * The opened graph database, or `null` when it has not been booted, is disabled, or
 * failed to open. Callers must treat `null` as "no graph bookkeeping for this run"
 * and keep working.
 */
export function getGraphDbService(): GraphDatabaseService | null {
  return instance;
}

/**
 * Open the embedded graph database and memoize it.
 *
 * Idempotent: a second call returns the instance opened earlier. Never throws — any
 * failure (missing native bindings, unwritable directory, schema error) is logged and
 * reported as `null` so `bootLocalRuntime()` can carry on without the graph.
 */
export async function initGraphDb(): Promise<GraphDatabaseService | null> {
  if (instance) return instance;

  if (!GRAPH_DB_ENABLED) {
    structuredLogger.debug('graph db: disabled (SQUADRULES_GRAPH_DB_ENABLED=false)');
    return null;
  }

  let service: GraphDatabaseService | null = null;
  try {
    service = new GraphDatabaseService(resolveGraphDbDir());
    await service.initialize();
    instance = service;
    return instance;
  } catch (err) {
    // Graceful degradation: release whatever the failed open left behind so a partial
    // native handle cannot pin the process, forget the instance, and carry on.
    instance = null;
    if (service) {
      try {
        await service.close();
      } catch {
        // A broken handle has nothing useful left to report.
      }
    }
    structuredLogger.warn(`graph db: init failed (${describeError(err)}) — continuing without graph bookkeeping`);
    return null;
  }
}

/**
 * Close the singleton and clear the reference. Idempotent and error-swallowing: it is
 * called from the signal handlers, where the process is about to exit and a second
 * shutdown must never turn into a rejection.
 */
export async function closeGraphDb(): Promise<void> {
  const service = instance;
  if (!service) return;
  instance = null;

  try {
    await service.close();
  } catch (err) {
    structuredLogger.debug(`graph db: close failed (${describeError(err)})`);
  }
}

/** Error message for a log line, tolerating non-Error throws. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
