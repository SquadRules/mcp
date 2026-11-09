import express from 'express';
import { MemoryQdrantStore } from '../services/memory/store.js';
import { structuredLogger } from '../utils/structured-logger.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { executeTune } from '../tools/tune.js';
import { tuneInputSchema } from '../tools/tune_schema.js';
import { runHttpApiWithSpaceContext } from '../utils/tenant-context.js';

/**
 * Set up API route for tune.
 *
 * The record store is handed to the shared core because the markdown rewrite path needs
 * the same fail-closed gates the MCP tool applies: inheritance parent lookup (a real
 * `parent_missing` verdict instead of a blind warning), descendant validation, and
 * lineage projection of the stored ancestry. Without it HTTP tune degraded silently — a
 * per-transport behavior difference, not a transport detail.
 *
 * Status stays 200 for a batch that ran: a conflict is reported per URI in
 * `results[].error` (`code`, `expected`, `current`), next to the human `message`. A
 * partially applied batch is neither a success nor a transport failure, so the status
 * cannot express it — the machine-readable row can, and the client decides what to do.
 */
export function setupUpdateRoute(
  app: express.Express,
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService
) {
  app.post('/api/tune', async (req, res) => {
    try {
      const input = tuneInputSchema.safeParse(req.body);
      if (!input.success) {
        res.status(400).json({
          error: 'INVALID_INPUT',
          message: input.error.message ?? 'uris is required and must be a non-empty array'
        });
        return;
      }
      structuredLogger.info(`→ POST /api/tune (${input.data.uris.length} URI(s))`);
      const result = await runHttpApiWithSpaceContext(req, () =>
        executeTune(qdrantService, input.data, memoryStore)
      );
      structuredLogger.info(`✓ tune completed (${result.total_updated} updated, ${result.total_failed} failed)`);
      res.status(200).json(result);
    } catch (error) {
      structuredLogger.error('✗ tune failed', error);
      res.status(500).json({
        error: 'TUNE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to update adapter layers'
      });
    }
  });
}
