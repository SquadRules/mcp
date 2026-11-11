/**
 * SQUADRULES MCP Server
 *
 * Supports HTTP and stdio transports.
 */

import { structuredLogger } from './utils/structured-logger.js';
import { installGlobalErrorHandlers } from './utils/global-error-handlers.js';
import { startHttpTransport } from './http/http-server.js';
import { startStdioTransport } from './stdio/stdio-server.js';
import { bootLocalRuntime } from './runtime/boot-local-runtime.js';
import { createShutdownRegistry } from './runtime/shutdown-registry.js';
import { closeGraphDb } from './services/graph-db/graph-db-singleton.js';
import { startMetricsServer } from './metrics-server.js';
import {
  SERVER_PORT,
  METRICS_PORT,
  SQUADRULES_LOCAL_ARTIFACT_DIRS,
  TRANSPORT_TYPE
} from './config.js';
import { resolveLanceDbDir } from './services/vector-store/lancedb-connection.js';
import { composeStdioModeBanner } from './stdio/stdio-banner.js';
import { installQdrantFetchCompatibility } from './services/qdrant/undici-compat.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// Import system metrics to ensure they're initialized
import './services/metrics/system-metrics.js';

/** True when this file is the process entrypoint (e.g. `node dist/index.js`, container CMD). */
function isDirectRun(): boolean {
    const entry = process.argv[1];
    if (!entry) return false;
    try {
        return import.meta.url === pathToFileURL(path.resolve(entry)).href;
    } catch {
        return false;
    }
}

/**
 * Every listener this process owns, drained on shutdown. Registration is atomic against
 * the drain (see `src/runtime/shutdown-registry.ts`): a listener that finishes booting
 * after a drain began closes itself and is logged, so it can never be the abandoned
 * handle that keeps the event loop alive until the last resort runs against a live ORT
 * session (ADR 0049).
 */
const listeners = createShutdownRegistry({
    onLateRegistration: () =>
        structuredLogger.info('shutdown: closed a listener that registered after shutdown began'),
    onCloseError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        structuredLogger.debug(`shutdown: listener close failed (${message})`);
    }
});

/** The ONLY way a listener may join the shutdown set, so a future listener cannot
 * reintroduce the boot window.
 */
function registerListener(close: () => void): void {
    listeners.register(close);
}

/**
 * Drain every handle this process owns and report `exitCode`, instead of calling
 * `process.exit()` while the embedding model is loaded (ADR 0049).
 *
 * One implementation, two callers, because both are the same event: the process must
 * stop, and the only safe way to stop is to close what it owns and let the event loop
 * empty. The signal handler calls it with `0` (a requested stop). A fatal listen
 * failure calls it with `1` (a failed start) - that failure arrives on the listener's
 * `error` event, after `bootLocalRuntime()` has already loaded the model, so it is a
 * process with a live ONNX session and cannot be answered with `process.exit()`.
 */
function drainOwnedHandles(exitCode: number): void {
    // The registry is marked draining BEFORE any closer runs, so every listener that
    // finishes booting from here on closes itself through `registerListener()` instead
    // of waiting for a drain that has already happened. Closing is best effort inside the
    // registry: a listener that fails to close neither skips the remaining ones nor
    // changes the exit code.
    listeners.drain();
    // Best-effort graph DB shutdown, fired inside the grace period below. It never
    // rejects and its outcome cannot change the exit code: the graph is internal
    // bookkeeping, so exit semantics stay exactly as before.
    void closeGraphDb().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        structuredLogger.debug(`graph db: shutdown hook failed (${message})`);
    });
    // The drain above already stopped accepting new work, so the event loop can empty and
    // the process can exit naturally with the code set below.
    // Last resort, unreachable on a process that drains once every listener has
    // registered its closer before the signal arrived (late boot closers close
    // themselves above). It fires only when a handle we do not own keeps the loop
    // alive - and with the model loaded that exit aborts (ADR 0049). The line it
    // writes first is the only runtime trace of that case: probes observed "did not
    // fire", and an operator (or a gate) needs the negative as a log fact, not as an
    // inference from an exit code.
    setTimeout(() => {
        structuredLogger.warn(
            'shutdown: last-resort exit (a handle this process does not own still holds the event loop)'
        );
        process.exit(exitCode);
    }, 1000).unref();
    process.exitCode = exitCode;
}

/**
 * Install signal handlers for graceful shutdown.
 * Without listeners Node terminates immediately on SIGTERM, but open handles
 * (the HTTP/MCP listener, the metrics listener, Qdrant gRPC, stdio pipes) keep the
 * event loop alive, so the process would not exit on its own. An explicit handler
 * stops every listener this process owns and lets the loop drain: a drained process
 * exits 0 through the ordinary path. That natural exit is the only safe one once
 * fastembed has loaded, because `process.exit()` runs the ONNX Runtime teardown
 * against a live InferenceSession and aborts the process (SIGABRT, exit 134).
 */
function installSignalHandlers(): void {
    const shutdown = (signal: string) => {
        structuredLogger.info(`Received ${signal}, shutting down`);
        drainOwnedHandles(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Boot the HTTP/MCP application.
 * Invoked when `node dist/index.js` is the process entrypoint, or after `dist/bootstrap.js` loads this module
 * (bootstrap is not `index.js`, so `isDirectRun()` is false there and bootstrap must call this explicitly).
 */
export async function runSquadrulesServer(): Promise<void> {
    try {
        installQdrantFetchCompatibility();
        // Install once at startup to capture any background errors/warnings
        installGlobalErrorHandlers();
        installSignalHandlers();

        structuredLogger.debug(
          `artifact dirs: ${SQUADRULES_LOCAL_ARTIFACT_DIRS.join(', ')}`
        );

        // Local simple mode stays silent for the first minutes of a fresh install while
        // the embedding model downloads, and a host user cannot otherwise see which
        // store the process is about to write to. stderr only - stdout is the MCP channel.
        if (TRANSPORT_TYPE === 'stdio') {
            process.stderr.write(composeStdioModeBanner(resolveLanceDbDir()));
        }

        // Shared boot: store selection, embedding probe, init, optional snapshot, and
        // app-space seeding. The server runs every stage (defaults); the CLI local path
        // dials the expensive stages down for fastboot. Same sequence, no drift.
        const { memoryStore, qdrantService: runtimeService } = await bootLocalRuntime();

        // Metrics HTTP server: only when the app serves HTTP (stdio mode avoids any HTTP listeners).
        if (TRANSPORT_TYPE === 'http') {
            const metricsServer = startMetricsServer();
            registerListener(() => {
                metricsServer.closeAllConnections();
                metricsServer.close();
            });
        }

        const transportSource = process.env['SQUADRULES_CLI_TRANSPORT_SOURCE']?.trim();
        if (transportSource === 'cli' || transportSource === 'env') {
            structuredLogger.info(
                `Resolved MCP transport: ${TRANSPORT_TYPE} (source: ${transportSource === 'cli' ? '--transport' : 'TRANSPORT_TYPE'})`
            );
        }

        if (TRANSPORT_TYPE === 'http') {
            structuredLogger.info(`server: HTTP :${SERVER_PORT}`);
            structuredLogger.info(`metrics: HTTP :${METRICS_PORT}`);
        } else {
            structuredLogger.debug('server: stdio (no HTTP listener)');
            structuredLogger.debug('metrics: disabled in stdio mode');
        }

        // Both transports get the facade this runtime booted, not the module default:
        // a second runtime in the same process must not resolve another store's records.
        if (TRANSPORT_TYPE === 'http') {
            const httpServer = await startHttpTransport(memoryStore, runtimeService, {
                // A bind failure is fatal, and it happens after the model is loaded: the
                // listener is the last thing this boot starts. It is the same process
                // event a signal is, so it takes the same drain, with a failing status -
                // the metrics listener started above, the graph may be open, and a
                // listener that registers after this point closes itself. Calling
                // `process.exit(1)` here instead aborts the live ONNX session (ADR 0049).
                onFatalError: () => drainOwnedHandles(1)
            });
            registerListener(() => {
                httpServer.closeAllConnections();
                httpServer.close();
            });
        } else {
            await startStdioTransport(memoryStore, runtimeService);
            // stdin is the only handle stdio mode owns: the MCP transport reads it, and
            // while the host keeps that pipe open it holds the event loop, so nothing
            // else here can drain. Pausing it releases the read handle - the same call
            // StdioServerTransport.close() makes - and destroying it closes the fd, so
            // the loop can drain and the process exits naturally instead of reaching the
            // `process.exit()` last resort above, which aborts with a live ORT session.
            registerListener(() => {
                process.stdin.pause();
                process.stdin.destroy();
            });
        }
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        // Always print error details to stderr so stdio child processes and CI
        // logs surface the root cause (structured logger may suppress details).
        process.stderr.write(`Fatal: ${error.message}\n`);
        if (error.stack) process.stderr.write(`${error.stack}\n`);

        try {
            structuredLogger.error('Fatal error during SQUADRULES MCP startup', error);
        } catch {
            // Ignore logging failures
        }

        // Ensure non-zero exit so supervisors can detect failure
        process.exitCode = 1;
    }
}

if (isDirectRun()) {
    await runSquadrulesServer();
}
