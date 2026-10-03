// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import getRawBody from 'raw-body';
import express from 'express';
import { kairosTrainSimilarAdapterFound } from '../services/metrics/mcp-metrics.js';
import { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { TrainError } from '../tools/train-store.js';
import { executeTrain } from '../tools/train.js';
import { trainInputSchema } from '../tools/train_schema.js';
import { HTTP_TRAIN_RAW_BODY_LIMIT } from '../config.js';
import { buildAdapterUri } from '../tools/kairos-uri.js';
import { KAIROS_CREATION_PROTOCOL_SLUG } from '../constants/builtin-search-meta.js';
import { SquadrulesError } from '../types/index.js';
import { getSpaceContext, runWithSpaceContextAsync } from '../utils/tenant-context.js';
import { listWritableSpaceDisplayNames, resolveSpaceParamForContext } from '../utils/resolve-space-param.js';

const SAFE_TRAIN_RAW_DETAIL_KEYS = new Set([
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

function sanitizeTrainRawDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_TRAIN_RAW_DETAIL_KEYS.has(key)) continue;
    output[key] = value;
  }
  return output;
}

function creationAdapterUri(): string {
  return buildAdapterUri(KAIROS_CREATION_PROTOCOL_SLUG);
}

/**
 * POST /api/train/raw — raw markdown body; builds {@link TrainInput} from body + query/headers.
 */
export function setupTrainRawRoute(
  app: express.Express,
  memoryStore: MemoryQdrantStore,
  qdrantService?: QdrantService
) {
  app.post('/api/train/raw', async (req, res) => {
    try {
      const contentLength = req.headers['content-length'] ? parseInt(req.headers['content-length'], 10) : null;
      const rawBody = await getRawBody(req, {
        limit: HTTP_TRAIN_RAW_BODY_LIMIT,
        encoding: 'utf8',
        ...(contentLength !== null && { length: contentLength })
      });
      const markdown = String(rawBody).trim();
      if (!markdown) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'Empty markdown content' });
        return;
      }

      const llm_model_id =
        (req.query['llm_model_id'] as string) ||
        (req.headers['x-llm-model-id'] as string) ||
        req.headers['user-agent'] ||
        'http-api';
      const force_update =
        req.query['force'] === 'true' || req.headers['x-force-update'] === 'true';
      const protocol_version = (req.query['protocol_version'] as string) || (req.headers['x-protocol-version'] as string) || undefined;
      const space =
        (req.query['space'] as string) ||
        (req.headers['x-space'] as string) ||
        undefined;

      // review_evidence can be passed as JSON query param or header (raw markdown body has no field for it)
      const reviewEvidenceRaw =
        (req.query['review_evidence'] as string) ||
        (req.headers['x-review-evidence'] as string) ||
        undefined;
      let reviewEvidence: { verdict_file: string; exit_code: number; stdout: string } | undefined;
      if (reviewEvidenceRaw) {
        try {
          const parsed_ = JSON.parse(reviewEvidenceRaw);
          if (parsed_ && typeof parsed_.verdict_file === 'string' && typeof parsed_.exit_code === 'number' && typeof parsed_.stdout === 'string') {
            reviewEvidence = parsed_;
          }
        } catch { /* ignore malformed review_evidence */ }
      }

      const bodyInput = {
        content: markdown,
        llm_model_id,
        force_update,
        ...(protocol_version && { protocol_version }),
        ...(space ? { space } : {}),
        ...(reviewEvidence ? { review_evidence: reviewEvidence } : {})
      };
      const parsed = trainInputSchema.safeParse(bodyInput);
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

      structuredLogger.info(`→ POST /api/train/raw (${markdown.length} bytes, model: ${parsed.data.llm_model_id}, force: ${parsed.data.force_update})`);
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
      const narrowedContext = {
        ...ctx,
        defaultWriteSpaceId: resolvedSpaceId
      };
      const result = await runWithSpaceContextAsync(narrowedContext, () =>
        executeTrain(memoryStore, parsed.data, (fn) => fn(), qdrantService)
      );
      res.status(200).json(result);
    } catch (error) {
      const err = error as { code?: string; details?: Record<string, unknown>; message?: string; status?: number; statusCode?: number; type?: string };
      if (err?.status === 413 || err?.statusCode === 413 || err?.type === 'entity.too.large') {
        res.status(413).json({
          error: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds the configured size limit'
        });
        return;
      }
      if (error instanceof TrainError) {
        res.status(400).json({
          error: error.code,
          message: error.message.replaceAll('Protocol', 'Adapter').replaceAll('protocol', 'adapter'),
          ...sanitizeTrainRawDetails(error.details),
          next_action: `call forward with ${creationAdapterUri()} to open the guided adapter creation flow`
        });
        return;
      }
      if (error instanceof SquadrulesError) {
        const status =
          error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
        structuredLogger.warn(`✗ Train raw SquadrulesError ${error.code}: ${error.message}`);
        res.status(status).json({
          error: error.code,
          message: error.message,
          ...sanitizeTrainRawDetails(error.details as Record<string, unknown> | undefined)
        });
        return;
      }
      if (err?.code === 'DUPLICATE_ADAPTER' || err?.code === 'DUPLICATE_KEY') {
        structuredLogger.warn(`✗ Duplicate adapter: ${err.message}`);
        res.status(409).json({
          error: 'DUPLICATE_ADAPTER',
          message: 'Adapter with this label already exists. Use --force flag to overwrite.',
          ...sanitizeTrainRawDetails(err.details)
        });
        return;
      }
      if (err?.code === 'SIMILAR_MEMORY_FOUND') {
        kairosTrainSimilarAdapterFound.inc({ transport: 'http', tenant_id: 'http' });
        structuredLogger.warn(`✗ Similar memory found: ${err.message}`);
        const d = err.details || {};
        res.status(409).json({
          error: 'SIMILAR_MEMORY_FOUND',
          existing_memory: (d as any).existing_memory,
          similarity_score: (d as any).similarity_score,
          message: (d as any).message ?? 'A very similar memory already exists by title. Verify it before overwriting.',
          must_obey: (d as any).must_obey ?? true,
          next_action: (d as any).next_action,
          ...((d as any).content_preview !== undefined && { content_preview: (d as any).content_preview })
        });
        return;
      }
      structuredLogger.error('✗ Store failed', error);
      res.status(500).json({
        error: 'STORE_FAILED',
        message: 'Failed to store adapter content'
      });
    }
  });
}
