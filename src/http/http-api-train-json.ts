// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import express from 'express';
import { kairosTrainSimilarAdapterFound } from '../services/metrics/mcp-metrics.js';
import { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { TrainError } from '../tools/train-store.js';
import { executeTrain } from '../tools/train.js';
import { trainInputSchema } from '../tools/train_schema.js';
import { buildAdapterUri } from '../tools/kairos-uri.js';
import { KAIROS_CREATION_PROTOCOL_SLUG } from '../constants/builtin-search-meta.js';
import { SquadrulesError } from '../types/index.js';
import { getSpaceContext, runWithSpaceContextAsync } from '../utils/tenant-context.js';
import { listWritableSpaceDisplayNames, resolveSpaceParamForContext } from '../utils/resolve-space-param.js';

const SAFE_TRAIN_DETAIL_KEYS = new Set([
  'missing',
  'must_obey',
  'next_action',
  'existing_memory',
  'similarity_score',
  'content_preview',
  'slug',
  'adapter_id',
  'sample_uri',
  'base_slug',
  'message'
]);

function sanitizeTrainDetails(details?: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (!details) return output;
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_TRAIN_DETAIL_KEYS.has(key)) continue;
    output[key] = value;
  }
  return output;
}

function creationAdapterUri(): string {
  return buildAdapterUri(KAIROS_CREATION_PROTOCOL_SLUG);
}

/**
 * JSON body train (space, source_adapter_uri, etc.). Raw markdown remains POST /api/train/raw.
 */
export function setupTrainJsonRoute(
  app: express.Express,
  memoryStore: MemoryQdrantStore,
  qdrantService?: QdrantService
): void {
  app.post('/api/train', async (req, res) => {
    try {
      const parsed = trainInputSchema.safeParse(req.body);
      if (!parsed.success) {
        const first = parsed.error.flatten().fieldErrors;
        const msg = Object.keys(first).length
          ? Object.entries(first)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
              .join('; ')
          : parsed.error.message;
        res.status(400).json({ error: 'INVALID_INPUT', message: msg });
        return;
      }

      structuredLogger.info(
        `→ POST /api/train (json, model: ${parsed.data.llm_model_id}, force: ${parsed.data.force_update ?? false})`
      );
      const ctx = getSpaceContext(req as express.Request & { spaceContext?: unknown });
      const rawSpace = typeof parsed.data.space === 'string' ? parsed.data.space.trim() : '';
      const spaceParam = rawSpace.toLowerCase();
      let resolvedSpaceId: string;
      if (parsed.data.space === undefined || rawSpace === '') {
        resolvedSpaceId = ctx.defaultWriteSpaceId || ctx.allowedSpaceIds[0] || '';
      } else if (spaceParam === 'personal') {
        const r = resolveSpaceParamForContext(ctx, rawSpace);
        if (!r.ok) {
          res.status(400).json({
            error: 'SPACE_NOT_FOUND',
            message: r.message,
            available_spaces: listWritableSpaceDisplayNames(ctx)
          });
          return;
        }
        resolvedSpaceId = r.spaceId;
      } else {
        const r = resolveSpaceParamForContext(ctx, rawSpace);
        if (!r.ok) {
          const errKey = r.code === 'SPACE_READ_ONLY' ? 'SPACE_READ_ONLY' : 'SPACE_NOT_FOUND';
          res.status(400).json({
            error: errKey,
            message: r.message,
            available_spaces: listWritableSpaceDisplayNames(ctx)
          });
          return;
        }
        resolvedSpaceId = r.spaceId;
      }
      // Keep full allowedSpaceIds so source_adapter_uri / slug lookups see group adapters while
      // defaultWriteSpaceId scopes new points to the requested target space.
      const narrowedContext = {
        ...ctx,
        defaultWriteSpaceId: resolvedSpaceId
      };
      const result = await runWithSpaceContextAsync(narrowedContext, () =>
        executeTrain(memoryStore, parsed.data, (fn) => fn(), qdrantService)
      );
      res.status(200).json(result);
    } catch (error) {
      const err = error as {
        code?: string;
        details?: Record<string, unknown>;
        message?: string;
        status?: number;
        statusCode?: number;
        type?: string;
      };
      if (error instanceof TrainError) {
        res.status(400).json({
          error: error.code,
          message: error.message.replaceAll('Protocol', 'Adapter').replaceAll('protocol', 'adapter'),
          ...sanitizeTrainDetails(error.details),
          next_action: `call forward with ${creationAdapterUri()} to open the guided adapter creation flow`
        });
        return;
      }
      if (error instanceof SquadrulesError) {
        const status =
          error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
        structuredLogger.warn(`✗ Train JSON SquadrulesError ${error.code}: ${error.message}`);
        res.status(status).json({
          error: error.code,
          message: error.message,
          ...sanitizeTrainDetails(error.details as Record<string, unknown> | undefined)
        });
        return;
      }
      if (err?.code === 'DUPLICATE_ADAPTER' || err?.code === 'DUPLICATE_KEY') {
        structuredLogger.warn(`✗ Duplicate adapter: ${err.message}`);
        res.status(409).json({
          error: 'DUPLICATE_ADAPTER',
          message: 'Adapter with this label already exists. Use force_update: true to overwrite.',
          ...sanitizeTrainDetails(err.details)
        });
        return;
      }
      if (err?.code === 'SIMILAR_MEMORY_FOUND') {
        kairosTrainSimilarAdapterFound.inc({ transport: 'http', tenant_id: 'http' });
        structuredLogger.warn(`✗ Similar memory found: ${err.message}`);
        const d = err.details || {};
        res.status(409).json({
          error: 'SIMILAR_MEMORY_FOUND',
          existing_memory: (d as Record<string, unknown>)['existing_memory'],
          similarity_score: (d as Record<string, unknown>)['similarity_score'],
          message:
            (d as Record<string, unknown>)['message'] ??
            'A very similar memory already exists by title. Verify it before overwriting.',
          must_obey: (d as Record<string, unknown>)['must_obey'] ?? true,
          next_action: (d as Record<string, unknown>)['next_action'],
          ...((d as Record<string, unknown>)['content_preview'] !== undefined && {
            content_preview: (d as Record<string, unknown>)['content_preview']
          })
        });
        return;
      }
      structuredLogger.error('✗ Train JSON failed', error);
      res.status(500).json({
        error: 'STORE_FAILED',
        message: 'Failed to store adapter markdown'
      });
    }
  });
}
