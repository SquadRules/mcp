import express from 'express';
import { MemoryQdrantStore } from '../services/memory/store.js';
import { embeddingService } from '../services/embedding/service.js';
import { keyValueStore } from '../services/key-value-store-factory.js';
import { getBuildVersion } from '../utils/build-version.js';
import { AUTH_ENABLED, REDIS_URL, isQdrantConfigured } from '../config.js';

/**
 * Set up health check and basic info routes
 * @param app Express application instance
 * @param memoryStore Memory store instance for health checks
 */
export function setupHealthRoutes(app: express.Express, memoryStore: MemoryQdrantStore) {
    // Health check endpoint (non-MCP)
    app.get('/health', async (req, res) => {
        // Configured dependencies are critical for readiness. If the process declares a backend,
        // /health must fail when that backend is unreachable or unauthenticated.
        const qdrantHealthy = await memoryStore.checkHealth().catch(() => false);
        const redisConfigured = REDIS_URL.length > 0;
        const redisHealthy = keyValueStore.isConnected();
        let teiHealth = { healthy: false, message: 'Embedding provider not configured' as string };

        // Run embedding health check but bound it with a short timeout so /health is responsive
        try {
            const teiCheck = (async () => {
                if (typeof (embeddingService as any).teiHealthCheck === 'function') {
                    return await (embeddingService as any).teiHealthCheck().catch(() => ({ healthy: false, message: 'TEI check failed' }));
                } else {
                    return await embeddingService.healthCheck().catch(() => ({ healthy: false, message: 'Embedding health check failed' }));
                }
            })();

            // Timeout after 2000ms to avoid blocking during test setup
            let timeoutId: NodeJS.Timeout | undefined;
            const timeout = new Promise(resolve => {
                timeoutId = setTimeout(() => resolve({ healthy: false, message: 'Embedding health check timed out' }), 2000);
            });
            teiHealth = (await Promise.race([teiCheck, timeout])) as { healthy: boolean; message: string };
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        } catch {
            teiHealth = { healthy: false, message: 'Embedding health check failed' };
        }

        const teiHealthy = !!teiHealth.healthy;
        const embeddingCfg = embeddingService.getConfig ? embeddingService.getConfig() : ({ provider: 'unknown' } as any);
        const embeddingConfigured = embeddingCfg.provider && embeddingCfg.provider !== 'none';
        const criticalHealthy =
            qdrantHealthy &&
            (!redisConfigured || redisHealthy) &&
            (!embeddingConfigured || teiHealthy);
        const healthStatus = criticalHealthy ? 'healthy' : 'unhealthy';
        const statusCode = criticalHealthy ? 200 : 503;

        const buildVersion = getBuildVersion();
        const uptime = Math.floor(process.uptime());

        const dependencies: Record<string, string> = {
            // Report the active vector store under an honest key: `qdrant` only when
            // Qdrant backs the process; otherwise `vectorStore` (embedded LanceDB).
            [isQdrantConfigured ? 'qdrant' : 'vectorStore']: qdrantHealthy ? 'healthy' : 'unhealthy',
            embedding: embeddingConfigured
                ? (teiHealthy ? 'healthy' : 'unhealthy')
                : 'disabled'
        };
        if (redisConfigured) {
            dependencies['redis'] = redisHealthy ? 'healthy' : 'unhealthy';
        } else {
            dependencies['cache'] = 'healthy (memory)';
        }

        const details: Record<string, string> = {
            cacheBackend: redisConfigured ? 'redis' : 'memory',
            vectorStoreBackend: isQdrantConfigured ? 'qdrant' : 'embedded-lancedb'
        };
        if (req.auth?.sub) {
            details['embedding'] = teiHealth.message;
            details['provider'] = embeddingCfg.provider || 'auto';
            details['providerPref'] = (embeddingCfg as any).providerPref || 'auto';
        }

        res.status(statusCode).json({
            status: healthStatus,
            service: 'squadrules-mcp',
            version: buildVersion,
            transport: 'http',
            uptime: uptime,
            dependencies,
            details
        });
    });

    // GET / is handled by setupUiStatic: redirect to /ui

    // API root (when AUTH_ENABLED, only reached when authenticated)
    app.get('/api', (req, res) => {
        const body: Record<string, unknown> = {
            service: 'SquadRules API',
            version: getBuildVersion(),
            endpoints: {
                activate: 'POST /api/activate',
                forward: 'POST /api/forward',
                reward: 'POST /api/reward',
                train: 'POST /api/train (JSON) or POST /api/train/raw (markdown body)',
                tune: 'POST /api/tune',
                delete: 'POST /api/delete',
                export: 'POST /api/export',
                spaces: 'POST /api/spaces'
            }
        };
        if (AUTH_ENABLED) {
            body['auth_required'] = true;
            body['note'] = 'These endpoints require a valid session or Bearer token. Unauthenticated requests receive 401 with login_url.';
        }
        res.json(body);
    });
}
