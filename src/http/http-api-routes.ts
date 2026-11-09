import express from 'express';
import { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { setupTrainRawRoute } from './http-api-train-raw.js';
import { setupTrainJsonRoute } from './http-api-train-json.js';
import { setupSnapshotRoute } from './http-api-snapshot.js';
import { setupActivateRoute } from './http-api-begin.js';
import { setupForwardRoute } from './http-api-begin-step.js';
import { setupRewardRoute } from './http-api-attest.js';
import { setupUpdateRoute } from './http-api-update.js';
import { setupDeleteRoute } from './http-api-delete.js';
import { setupDumpRoute } from './http-api-dump.js';
import { setupMeRoute } from './http-api-me.js';
import { setupSpacesRoute } from './http-api-spaces.js';

/**
 * Set up all API routes
 * @param app Express application instance
 * @param memoryStore Memory store instance
 * @param deps Dependencies including qdrantService
 */
export function setupApiRoutes(app: express.Express, memoryStore: MemoryQdrantStore, deps: { qdrantService: QdrantService }) {
    const { qdrantService } = deps;

    setupMeRoute(app);
    setupSpacesRoute(app, memoryStore);
    setupTrainRawRoute(app, memoryStore, qdrantService);
    setupTrainJsonRoute(app, memoryStore, qdrantService);
    setupSnapshotRoute(app, qdrantService);
    setupActivateRoute(app, memoryStore, qdrantService); // /api/activate
    setupForwardRoute(app, memoryStore, qdrantService); // /api/forward
    setupRewardRoute(app, qdrantService); // /api/reward
    setupUpdateRoute(app, memoryStore, qdrantService); // /api/tune
    setupDeleteRoute(app, qdrantService);
    setupDumpRoute(app, memoryStore, qdrantService);
}