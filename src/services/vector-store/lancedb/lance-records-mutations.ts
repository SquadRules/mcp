/**
 * Lance mutation layer for memory records.
 *
 * Read-modify-write operations mirror their Qdrant counterparts (`memory-updates.ts`,
 * `quality.ts`, `reward-propagation.ts` and the `store.ts` bulk payload/delete
 * helpers) field for field: the same accessible-space gate, the same payload merge
 * and retired-alias drop, the same `quality_metrics` accumulation and `attest_boost`
 * formula, the same text-change → re-embed rule, and the same cache invalidation
 * calls. Named vectors are preserved across the round-trip so an update never
 * silently drops an embedding column.
 */
import { SQUADRULES_APP_SPACE_ID, MIN_ATTEST_RUNS, RUNS_FULL_CONFIDENCE, ATTEST_BOOST_MAX } from '../../../config.js';
import { getSpaceContext, getTenantId } from '../../../utils/tenant-context.js';
import { buildSpaceFilter } from '../../../utils/space-filter.js';
import { SquadrulesError } from '../../../types/index.js';
import { logger } from '../../../utils/structured-logger.js';
import { embeddingService } from '../../embedding/service.js';
import { redisCacheService } from '../../redis-cache.js';
import { validateAndConvertId } from '../../qdrant/utils.js';
import type { LanceRecordEngine } from './lance-records-engine.js';
import { toNumberArray, type LanceRecordRow, type QdrantPointLike } from './lance-records-schema.js';

function payloadOf(row: LanceRecordRow): any {
  return JSON.parse(row.payload) as Record<string, unknown>;
}

function isAccessible(row: LanceRecordRow): boolean {
  const spaceId = String(payloadOf(row)['space_id'] ?? SQUADRULES_APP_SPACE_ID);
  const allowed = getSpaceContext().allowedSpaceIds;
  return allowed.includes(spaceId) || spaceId === SQUADRULES_APP_SPACE_ID;
}

/** Pull the named dense vectors (+ bm25) out of a row so an update preserves them. */
function vectorsFromRow(row: LanceRecordRow): Record<string, unknown> {
  const vector: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const numbers = toNumberArray(value);
    if (numbers) vector[key] = numbers;
  }
  if (row.bm25_json) {
    try {
      vector['bm25'] = JSON.parse(row.bm25_json);
    } catch {
      /* ignore malformed sparse blob */
    }
  }
  return vector;
}

function computeAttestBoost(successCount: number, failureCount: number): number {
  const runs = successCount + failureCount;
  if (runs < MIN_ATTEST_RUNS) return 0;
  const successRatio = runs > 0 ? successCount / runs : 0;
  const confidence = Math.min(runs / RUNS_FULL_CONFIDENCE, 1);
  return Math.min(ATTEST_BOOST_MAX * successRatio * confidence, ATTEST_BOOST_MAX);
}

export class LanceRecordMutator {
  constructor(private readonly engine: LanceRecordEngine) {}

  private async loadAccessibleRow(id: string, notFoundMessage: string): Promise<LanceRecordRow> {
    const validated = validateAndConvertId(id);
    const row = await this.engine.retrieveRaw(validated);
    if (!row || !isAccessible(row)) {
      throw new SquadrulesError(notFoundMessage, 'MEMORY_NOT_FOUND', 404);
    }
    return row;
  }

  async updateMemory(id: string, updates: any): Promise<void> {
    const tenantId = getTenantId();
    const row = await this.loadAccessibleRow(id, `Memory with ID ${id} not found`);
    const existingPayload = payloadOf(row);

    let newQualityMetadata = existingPayload.quality_metadata;
    const shouldRecalculate = updates.label || updates.text || updates.domain || updates.task || updates.type || updates.tags;
    if (shouldRecalculate) {
      const { modelStats } = await import('../../stats/model-stats.js');
      const qualityMetadata = modelStats.calculateStepQualityMetadata(
        updates.label || existingPayload.label || '',
        updates.domain || existingPayload.domain || 'general',
        updates.task || existingPayload.task || 'general-task',
        updates.type || existingPayload.type || 'context',
        updates.tags || existingPayload.tags || []
      );
      newQualityMetadata = { step_quality_score: qualityMetadata.step_quality_score, step_quality: qualityMetadata.step_quality };
    }

    const { description_short: _d, description_full: _f, ...safeUpdates } = updates ?? {};
    const defaultSpaceId = getSpaceContext().defaultWriteSpaceId;
    const updatedPayload = {
      ...existingPayload,
      space_id: existingPayload.space_id ?? defaultSpaceId,
      ...safeUpdates,
      updated_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      modified_by: getSpaceContext().userId || 'system',
      created_by: existingPayload.created_by ?? (getSpaceContext().userId || 'system'),
      quality_metadata: newQualityMetadata
    };

    const vector = vectorsFromRow(row);
    const textChanged = typeof updates?.text === 'string' && updates.text !== existingPayload.text;
    if (textChanged) {
      const embeddingResult = await embeddingService.generateEmbedding(updates.text as string);
      const primaryName = `vs${embeddingResult.embedding.length}`;
      for (const key of Object.keys(vector)) {
        if (key.startsWith('vs')) delete vector[key];
      }
      vector[primaryName] = embeddingResult.embedding;
    }

    await this.engine.upsertPoint({ id: row.id, payload: updatedPayload, vector });
    await redisCacheService.invalidateMemoryCacheStrict(row.id);
    await redisCacheService.invalidateAfterUpdate();
    logger.debug(`[LanceRecordMutator] updateMemory ${row.id} tenant=${tenantId}`);
  }

  async deleteMemory(id: string): Promise<void> {
    const validated = validateAndConvertId(id);
    const row = await this.engine.retrieveRaw(validated);
    if (!row || !isAccessible(row)) {
      throw new SquadrulesError(`Memory with ID ${id} not found`, 'MEMORY_NOT_FOUND', 404);
    }
    await this.engine.deleteById(validated);
    await redisCacheService.invalidateMemoryCacheStrict(validated);
    await redisCacheService.invalidateAfterUpdate();
  }

  async updateQualityMetrics(id: string, metrics: any): Promise<void> {
    const row = await this.loadAccessibleRow(id, `Memory with ID ${id} not found for quality update`);
    const existingPayload = payloadOf(row);
    const currentMetrics = existingPayload.quality_metrics || {
      retrievalCount: 0, successCount: 0, partialCount: 0, failureCount: 0,
      lastRated: null, lastRater: null, qualityBonus: 0, usageContext: null,
      implementation_stats: { total_attempts: 0, success_attempts: 0, model_success_rates: {}, confidence_level: 0, last_implementation_attempt: null },
      healer_contributions: { total_healers: 0, total_improvements: 0, healer_bonus_distributed: 0, last_healed: null, healer_models: {} },
      step_success_rates: {}
    };
    const updatedMetrics = {
      ...currentMetrics,
      ...metrics,
      retrievalCount: currentMetrics.retrievalCount + (metrics.retrievalCount || 0),
      successCount: currentMetrics.successCount + (metrics.successCount || 0),
      partialCount: currentMetrics.partialCount + (metrics.partialCount || 0),
      failureCount: currentMetrics.failureCount + (metrics.failureCount || 0),
      qualityBonus: currentMetrics.qualityBonus + (metrics.qualityBonus || 0)
    };
    const attest_boost = computeAttestBoost(updatedMetrics.successCount ?? 0, updatedMetrics.failureCount ?? 0);
    const spaceId = existingPayload.space_id ?? getSpaceContext().defaultWriteSpaceId;
    const updatedPayload = { ...existingPayload, space_id: spaceId, quality_metrics: updatedMetrics, attest_boost, updated_at: new Date().toISOString() };
    await this.engine.upsertPoint({ id: row.id, payload: updatedPayload, vector: vectorsFromRow(row) });
  }

  async updateQualityMetadata(id: string, qualityMetadata: { step_quality_score: number; step_quality: 'excellent' | 'high' | 'standard' | 'basic' }): Promise<void> {
    const row = await this.loadAccessibleRow(id, `Memory with ID ${id} not found for quality metadata update`);
    const existingPayload = payloadOf(row);
    const updatedQualityMetadata = { ...(existingPayload.quality_metadata || {}), ...qualityMetadata };
    const spaceId = existingPayload.space_id ?? getSpaceContext().defaultWriteSpaceId;
    const updatedPayload = { ...existingPayload, space_id: spaceId, quality_metadata: updatedQualityMetadata, updated_at: new Date().toISOString() };
    await this.engine.upsertPoint({ id: row.id, payload: updatedPayload, vector: vectorsFromRow(row) });
  }

  /** Resolve a completion layer's adapter head and propagate reward to it. */
  async propagateRewardToAdapterHead(stepPointId: string, metricsUpdate: Record<string, unknown>): Promise<string | null> {
    const stepRow = await this.engine.retrieveRaw(validateAndConvertId(stepPointId));
    if (!stepRow || !isAccessible(stepRow)) return null;
    const payload = payloadOf(stepRow);
    const adapterId = (payload['adapter'] as { id?: string } | undefined)?.id;
    if (!adapterId || typeof adapterId !== 'string') return null;
    const layerIndex = (payload['adapter'] as { layer_index?: number } | undefined)?.layer_index;
    if (layerIndex === 1) return null;
    const heads = await this.engine.scroll(buildSpaceFilter(getSpaceContext().allowedSpaceIds, {
      must: [
        { key: 'adapter.id', match: { value: adapterId } },
        { key: 'adapter.layer_index', match: { value: 1 } }
      ]
    }), 1);
    if (heads.length === 0) {
      logger.warn(`[reward-propagation] Adapter head not found for adapter ${adapterId}, skip propagation`);
      return null;
    }
    const adapterHeadId = heads[0]!.id;
    await this.updateQualityMetrics(adapterHeadId, metricsUpdate);
    try {
      await redisCacheService.invalidateBeginCache();
    } catch (cacheErr) {
      logger.warn(`[reward-propagation] Cache invalidation failed after adapter head update (adapterHeadId=${adapterHeadId}): ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`);
    }
    return adapterHeadId;
  }

  /** Attach a payload patch (e.g. content hash) to a set of layer points. */
  async setPayloadOnLayers(layerIds: string[], patch: Record<string, unknown>): Promise<void> {
    const points: QdrantPointLike[] = [];
    for (const rawId of layerIds) {
      const row = await this.engine.retrieveRaw(validateAndConvertId(rawId));
      if (!row) continue;
      points.push({ id: row.id, payload: { ...payloadOf(row), ...patch }, vector: vectorsFromRow(row) });
    }
    await this.engine.putPoints(points);
  }

  /** Delete app-space points matching a slug. */
  async deleteAppSpaceBySlug(slug: string): Promise<void> {
    await this.engine.deleteByFilter({
      must: [
        { key: 'slug', match: { value: slug } },
        { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } }
      ]
    });
  }

  /** Delete app-space points matching an adapter id. */
  async deleteAppSpaceByAdapterId(adapterId: string): Promise<void> {
    await this.engine.deleteByFilter({
      must: [
        { key: 'adapter.id', match: { value: adapterId } },
        { key: 'space_id', match: { value: SQUADRULES_APP_SPACE_ID } }
      ]
    });
  }
}

