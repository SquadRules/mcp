import express from 'express';
import { MemoryQdrantStore } from '../services/memory/store.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { SERVER_PORT } from '../config.js';

// Import modular components
import { configureMiddleware } from './http-server-config.js';
import { authMiddleware } from './http-auth-middleware.js';
import { setupAuthCallback } from './http-auth-callback.js';
import { setupHealthRoutes } from './http-health-routes.js';
import { setupWellKnown } from './http-well-known.js';
import { setupApiRoutes } from './http-api-routes.js';
import { setupMcpCorsRoutes } from './http-mcp-cors.js';
import { setupMcpRoutes } from './http-mcp-handler.js';
import { setupUiStatic } from './http-ui-static.js';
import { setupExportDownloadRoutes } from './http-export-download-routes.js';
import { setupExportArtifactDownloadRoutes } from './http-export-artifact-download-routes.js';
import { setupErrorHandlers } from './http-error-handlers.js';
import { startHttpServerWithErrorHandling } from './http-server-startup.js';
import { qdrantService } from '../services/qdrant/index.js';

export function startHttpServer(port: number, memoryStore: MemoryQdrantStore) {
    const app = express();

    // Configure middleware
    configureMiddleware(app);
    setupAuthCallback(app);

    // Well-known must be registered before auth middleware so RFC 9728 discovery
    // is reachable without credentials (MCP clients call it before authenticating).
    setupWellKnown(app);

    setupMcpCorsRoutes(app);

    app.use(authMiddleware);

    // Route handlers after auth middleware; capability download is outside `/api` auth.
    setupHealthRoutes(app, memoryStore);
    setupExportDownloadRoutes(app, memoryStore, qdrantService);
    setupExportArtifactDownloadRoutes(app, memoryStore);
    setupApiRoutes(app, memoryStore, { qdrantService });
    setupMcpRoutes(app, memoryStore);
    setupUiStatic(app);
    setupErrorHandlers(app);

    // Start server with error handling
    return startHttpServerWithErrorHandling(app, port);
}

export async function startHttpTransport(memoryStore: MemoryQdrantStore) {
    const httpPort = SERVER_PORT;

    structuredLogger.success('SquadRules MCP Server starting', 'HTTP transport');
    structuredLogger.info('HTTP transport: enabled');
    structuredLogger.info('Port: ' + httpPort);

    startHttpServer(httpPort, memoryStore);
}
