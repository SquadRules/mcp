import express from 'express';
import type { QdrantService } from '../services/qdrant/service.js';
import { triggerQdrantSnapshot } from '../services/qdrant/snapshots.js';
import { QDRANT_SNAPSHOT_DIR, isQdrantConfigured } from '../config.js';

/**
 * Set up API route for Qdrant snapshot
 * @param app Express application instance
 * @param qdrantService Qdrant service instance
 */
/** 503 when backup directory is not configured. */
const SNAPSHOT_NOT_CONFIGURED_MESSAGE = 'Backup directory is not defined in server settings.';

export function setupSnapshotRoute(app: express.Express, qdrantService: QdrantService) {
    app.post('/api/snapshot', async (_req, res) => {
        // Server-side snapshots are a Qdrant feature. On the embedded LanceDB
        // backend there is no Qdrant to snapshot, so report that honestly instead
        // of attempting a Qdrant call and returning a misleading failure.
        if (!isQdrantConfigured) {
            res.status(400).json({
                error: 'SNAPSHOT_UNSUPPORTED',
                status: 'unsupported',
                target: 'embedded-lancedb',
                message: 'Server-side snapshots require Qdrant and are not supported on the embedded LanceDB backend. Stop the server and back up its data directory instead.'
            });
            return;
        }

        if (!QDRANT_SNAPSHOT_DIR) {
            res.status(503).json({
                error: 'Backup not configured',
                message: SNAPSHOT_NOT_CONFIGURED_MESSAGE
            });
            return;
        }

        const result = await triggerQdrantSnapshot(qdrantService, {
            enabled: true,
            directory: QDRANT_SNAPSHOT_DIR,
            reason: 'api'
        });

        const statusCode = result.success ? 200 : result.skipped ? 202 : 503;
        res.status(statusCode).json({
            status: result.success ? 'completed' : result.skipped ? 'skipped' : 'failed',
            target: 'qdrant',
            snapshotName: result.snapshotName,
            bytesWritten: result.bytesWritten,
            durationMs: result.durationMs,
            message: result.message
        });
    });
}


