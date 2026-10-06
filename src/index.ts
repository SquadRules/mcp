/**
 * SQUADRULES MCP Server
 *
 * Supports HTTP and stdio transports.
 */

import { structuredLogger } from './utils/structured-logger.js';
import { installGlobalErrorHandlers } from './utils/global-error-handlers.js';
import { MemoryQdrantStore } from './services/memory/store.js';
import { startHttpTransport } from './http/http-server.js';
import { startStdioTransport } from './stdio/stdio-server.js';
import { injectMemResourcesAtBoot } from './resources/mem-resources-boot.js';
import { startMetricsServer } from './metrics-server.js';
import {
  SERVER_PORT,
  METRICS_PORT,
  QDRANT_SNAPSHOT_ON_START,
  QDRANT_SNAPSHOT_DIR,
  SQUADRULES_LOCAL_ARTIFACT_DIRS,
  TRANSPORT_TYPE,
  isQdrantConfigured
} from './config.js';
import { qdrantService } from './services/qdrant/index.js';
import { getEmbeddedRecordStore } from './services/vector-store/embedded-store-singleton.js';
import { resolveLanceDbDir } from './services/vector-store/lancedb-connection.js';
import { composeStdioModeBanner } from './stdio/stdio-banner.js';
import { triggerQdrantSnapshot } from './services/qdrant/snapshots.js';
import { probeEmbeddingDimension } from './services/embedding/service.js';
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
 * Wait for Qdrant to be available with retries
 * Uses shorter intervals for faster detection when Qdrant becomes available quickly
 */
async function waitForQdrant(memoryStore: MemoryQdrantStore, maxRetries: number = 30, intervalMs: number = 1000): Promise<void> {
    structuredLogger.info('Waiting for Qdrant to be available...');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const isHealthy = await memoryStore.checkHealth(5000); // 5 second timeout per check
            if (isHealthy) {
                structuredLogger.info(`Qdrant is available after ${attempt} attempt(s)`);
                return;
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            structuredLogger.debug(`Qdrant health check error on attempt ${attempt}: ${errorMessage}`);
            // Health check failed, will retry
        }
        
        if (attempt < maxRetries) {
            structuredLogger.info(`Qdrant not ready yet (attempt ${attempt}/${maxRetries}), retrying in ${intervalMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }
    
    throw new Error(`Qdrant did not become available after ${maxRetries} attempts (${maxRetries * intervalMs / 1000}s)`);
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

        structuredLogger.info(
          `SQUADRULES_LOCAL_ARTIFACT_DIRS (client-resolvable hints): ${SQUADRULES_LOCAL_ARTIFACT_DIRS.join(', ')}`
        );

        // Local simple mode stays silent for the first minutes of a fresh install while
        // the embedding model downloads, and a host user cannot otherwise see which
        // store the process is about to write to. stderr only - stdout is the MCP channel.
        if (TRANSPORT_TYPE === 'stdio') {
            process.stderr.write(composeStdioModeBanner(resolveLanceDbDir()));
        }

        // Backend-selected store. On the embedded path this is the shared
        // LanceDB store double-cast to the `MemoryQdrantStore` shape (same
        // instance `qdrantService` resolves to), so tools and boot injection
        // keep calling the domain methods they already use.
        const memoryStore = isQdrantConfigured
          ? new MemoryQdrantStore()
          : (getEmbeddedRecordStore() as unknown as MemoryQdrantStore);

        // Wait for Qdrant to be available before initializing (embedded store is
        // local — no server to wait for).
        if (isQdrantConfigured) {
          await waitForQdrant(memoryStore);
        }

        const embeddingDim = await probeEmbeddingDimension();
        structuredLogger.info(`Embedding dimension resolved: ${embeddingDim}`);

        structuredLogger.info('Initializing Qdrant memory store...');
        await memoryStore.init();
        structuredLogger.info('Memory store ready');

        if (isQdrantConfigured && QDRANT_SNAPSHOT_ON_START) {
            const snapshotResult = await triggerQdrantSnapshot(qdrantService, {
                enabled: true,
                directory: QDRANT_SNAPSHOT_DIR,
                reason: 'startup'
            });

            if (!snapshotResult.success) {
                structuredLogger.warn(`Startup snapshot failed: ${snapshotResult.message || 'unknown error'}`);
            }
        } else {
            structuredLogger.info('Startup snapshot disabled (QDRANT_SNAPSHOT_ON_START=false)');
        }

        // Inject mem resources from embedded-mcp-resources into the store at boot. Reuses
        // stored adapters whose version is current; MEM_BOOT_FORCE_INJECT=true retrains every
        // one of them (docs/adr/0002). Blocking: the transport binds only after this returns.
        await injectMemResourcesAtBoot(memoryStore);

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
            structuredLogger.info(`Application server: ${SERVER_PORT}`);
        } else {
            structuredLogger.info('Application server: stdio (no HTTP listener)');
        }
        if (TRANSPORT_TYPE === 'http') {
            structuredLogger.info(`Metrics server: ${METRICS_PORT} (isolated)`);
        } else {
            structuredLogger.info('Metrics server: disabled in stdio mode (no HTTP listeners)');
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
