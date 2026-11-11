import { structuredLogger } from '../utils/structured-logger.js';
import express from 'express';
import type { Server } from 'node:http';

/**
 * HTTP listener startup, and the contract for a bind that fails.
 *
 * A bind failure is not an error return: `app.listen()` reports it on the server's
 * `error` event, so `startHttpServer()` has already handed the listener back by the
 * time the failure is known. This module therefore reports the failure and delegates
 * the process decision to whoever owns the rest of the process.
 *
 * What this module must never do is call `process.exit()`. It is exactly the shape
 * ADR 0049 covers: `runSquadrulesServer()` loads the embedding model before it
 * listens, so an immediate exit on `EADDRINUSE` runs the ONNX Runtime teardown
 * against a live `InferenceSession` and the process aborts (`SIGABRT`, shell status
 * 134) instead of reporting the port conflict it was told to report.
 *
 * Sanctioned immediate exits are the CLI ones, and they are safe for one reason: no
 * native embedding model is loaded in that process yet. `src/cli/commands/serve.ts`
 * validates flags and exits before it spawns anything, and its supervising parent
 * exits with the child's code while owning no model of its own - its imports are
 * `node:child_process`, `node:fs`, `node:path`, commander, dotenv and two CLI helpers,
 * so nothing in that module graph can reach `bootLocalRuntime()`; the model lives in
 * the spawned `dist/bootstrap.js` child. The server path is the other case: it has a
 * model, so it drains handles and reports through `process.exitCode` (see
 * `drainOwnedHandles()` in `src/index.ts`).
 */

/** What the caller does when the listener cannot bind. */
export interface HttpServerStartupOptions {
    /**
     * Called after the failure has been logged and this module has released the
     * socket it created.
     *
     * The caller owns the rest of the process, so it performs the teardown: the
     * server entry (`src/index.ts`) passes the same drain its signal handler uses, so
     * a listen failure also closes the metrics listener and releases the graph, then
     * exits naturally with `process.exitCode = 1`.
     *
     * Left unset by callers that own nothing beyond this listener (tests, embedded
     * harnesses): the module then reports the failure through `process.exitCode` and
     * leaves the exit timing to the event loop, because it cannot know what else the
     * process holds.
     */
    onFatalError?: (error: NodeJS.ErrnoException) => void;
}

/**
 * Start HTTP server with error handling
 * @param app Express application instance
 * @param port Port to listen on
 * @param host Interface to bind to; defaults to all interfaces
 * @param options Who handles a bind failure; defaults to report-and-drain
 * @returns HTTP server instance
 */
export function startHttpServerWithErrorHandling(
    app: express.Express,
    port: number,
    host: string = '0.0.0.0',
    options: HttpServerStartupOptions = {}
) {
    const httpServer = app.listen(port, host, () => {
        structuredLogger.success('HTTP server', 'listening on port ' + port);
        structuredLogger.info('Health check: http://localhost:' + port + '/health');
        structuredLogger.info('MCP endpoint: http://localhost:' + port + '/mcp');
    });

    httpServer.on('error', (error: NodeJS.ErrnoException) => {
        // The operator-facing diagnosis is unchanged: a container log or a supervisor
        // still shows which port is taken, or what the socket layer refused.
        if (error.code === 'EADDRINUSE') {
            structuredLogger.error(`Port ${port} is already in use. Please choose a different port.`);
        } else {
            structuredLogger.error('HTTP server error:', error.message);
        }

        // This module created the socket, so it releases it on every path.
        releaseFailedListener(httpServer);

        if (options.onFatalError) {
            options.onFatalError(error);
            return;
        }

        // No owner supplied: report the failure and let the event loop decide when the
        // process is done. A process that owns nothing else still ends nonzero; one
        // that owns a handle reaches its own teardown instead of aborting here.
        process.exitCode = 1;
    });

    return httpServer;
}

/**
 * Release a listener whose bind failed.
 *
 * There is no accepted connection to drain - the socket was never bound - but the
 * server object can still hold a pending bind, and a bound socket would keep the
 * event loop alive after the failure has been reported. The callback is not optional
 * detail: `close()` on a server that never listened reports `ERR_SERVER_NOT_RUNNING`
 * as an `'error'` event when no callback is passed, which would re-enter the handler
 * above and log the same failure again.
 */
function releaseFailedListener(httpServer: Server): void {
    httpServer.close((closeError?: Error) => {
        if (closeError) {
            structuredLogger.debug(`http startup: failed listener release: ${closeError.message}`);
        }
    });
}