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
 * Install signal handlers for graceful shutdown.
 * Without listeners Node terminates immediately on SIGTERM, but open handles
 * (Qdrant gRPC, stdio pipes) can delay exit. An explicit handler ensures
 * the process exits promptly.
 */
function installSignalHandlers(): void {
    const shutdown = (signal: string) => {
        structuredLogger.info(`Received ${signal}, shutting down`);
        // Force exit after a short grace period if open handles keep the event loop alive
        setTimeout(() => process.exit(0), 1000).unref();
        process.exitCode = 0;
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
        const { memoryStore } = await bootLocalRuntime();

        // Metrics HTTP server: only when the app serves HTTP (stdio mode avoids any HTTP listeners).
        if (TRANSPORT_TYPE === 'http') {
            startMetricsServer();
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

        if (TRANSPORT_TYPE === 'http') {
            await startHttpTransport(memoryStore);
        } else {
            await startStdioTransport(memoryStore);
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
