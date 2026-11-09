import { structuredLogger } from '../utils/structured-logger.js';
import express from 'express';

/**
 * Start HTTP server with error handling
 * @param app Express application instance
 * @param port Port to listen on
 * @param host Interface to bind to; defaults to all interfaces
 * @returns HTTP server instance
 */
export function startHttpServerWithErrorHandling(
    app: express.Express,
    port: number,
    host: string = '0.0.0.0'
) {
    const httpServer = app.listen(port, host, () => {
        structuredLogger.success('HTTP server', 'listening on port ' + port);
        structuredLogger.info('Health check: http://localhost:' + port + '/health');
        structuredLogger.info('MCP endpoint: http://localhost:' + port + '/mcp');
    });

    httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            structuredLogger.error(`Port ${port} is already in use. Please choose a different port.`);
            process.exit(1);
        } else {
            structuredLogger.error('HTTP server error:', error.message);
            process.exit(1);
        }
    });

    return httpServer;
}