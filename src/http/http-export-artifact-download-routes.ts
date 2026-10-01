import express from 'express';
import { MemoryQdrantStore } from '../services/memory/store.js';
import { verifyExportArtifactDownloadCapability } from '../services/export-artifact-download-capability.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { runWithSpaceContextAsync } from '../utils/tenant-context.js';

export function setupExportArtifactDownloadRoutes(
  app: express.Express,
  memoryStore: MemoryQdrantStore
): void {
  app.get('/export/artifact/:opaque', async (req, res) => {
    const opaque = req.params['opaque'] ?? '';
    const record = await verifyExportArtifactDownloadCapability(opaque);
    if (!record) {
      res.status(403).json({
        error: 'EXPORT_ARTIFACT_DOWNLOAD_FORBIDDEN',
        message: 'Artifact download link is invalid or expired.'
      });
      return;
    }

    try {
      structuredLogger.info(
        {
          event: 'export_artifact_download_request',
          id: record.id,
          artifact_uuid: record.artifact_uuid
        },
        'GET /export/artifact'
      );

      const memory = await runWithSpaceContextAsync(record.space_context, () =>
        memoryStore.getMemory(record.artifact_uuid, { fresh: true })
      );
      if (!memory) {
        res.status(404).json({
          error: 'EXPORT_ARTIFACT_NOT_FOUND',
          message: 'Artifact was not found.'
        });
        return;
      }

      const body = typeof memory.text === 'string' ? memory.text : '';
      const filename = record.filename.replace(/"/g, '');
      res.setHeader('Content-Type', record.content_type || memory.content_type || 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-KAIROS-Artifact-Sha256', record.sha256);
      // Dual header for SquadRules migration: both emitted so clients reading either name work.
      res.setHeader('X-SquadRules-Artifact-Sha256', record.sha256);
      res.status(200).send(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      structuredLogger.error('artifact download failed', error);
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(500).json({ error: 'EXPORT_ARTIFACT_DOWNLOAD_FAILED', message });
    }
  });
}

