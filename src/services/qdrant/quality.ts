import { QdrantConnection } from './connection.js';
import { SquadrulesError } from '../../types/index.js';
import { sanitizeAndUpsert } from './utils.js';
import { logger } from '../../utils/structured-logger.js';
import { getSpaceContext } from '../../utils/tenant-context.js';
import { MIN_ATTEST_RUNS, RUNS_FULL_CONFIDENCE, ATTEST_BOOST_MAX } from '../../config.js';
import { retrieveAccessiblePointById } from './memory-retrieval.js';

/** Compute attest_boost for search formula (same logic as former app-side boost). */
function computeAttestBoost(successCount: number, failureCount: number): number {
  const runs = successCount + failureCount;
  if (runs < MIN_ATTEST_RUNS) return 0;
  const successRatio = runs > 0 ? successCount / runs : 0;
  const confidence = Math.min(runs / RUNS_FULL_CONFIDENCE, 1);
  return Math.min(ATTEST_BOOST_MAX * successRatio * confidence, ATTEST_BOOST_MAX);
}

/**
 * Quality management functions:
 * - updateQualityMetrics
 * - updateQualityMetadata
 * - trackPendingValidation
 */

export async function updateQualityMetrics(conn: QdrantConnection, id: string, metrics: any): Promise<void> {
  return conn.executeWithReconnect(async () => {
    const existingPoint = await retrieveAccessiblePointById(conn, id, { withVector: true });
    if (!existingPoint) {
      throw new SquadrulesError(`Memory with ID ${id} not found for quality update`, 'MEMORY_NOT_FOUND', 404);
    }
    const existingPayload = existingPoint.payload as any;

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

    const successCount = updatedMetrics.successCount ?? 0;
    const failureCount = updatedMetrics.failureCount ?? 0;
    const attest_boost = computeAttestBoost(successCount, failureCount);

    const spaceId = existingPayload.space_id ?? getSpaceContext().defaultWriteSpaceId;
    const updatedPayload = { ...existingPayload, space_id: spaceId, quality_metrics: updatedMetrics, attest_boost, updated_at: new Date().toISOString() };
    await sanitizeAndUpsert(conn.client, conn.collectionName, [{ id: existingPoint.id, vector: existingPoint.vector as any, payload: updatedPayload }]);
  });
}

export async function updateQualityMetadata(conn: QdrantConnection, id: string, qualityMetadata: { step_quality_score: number; step_quality: 'excellent' | 'high' | 'standard' | 'basic'; }): Promise<void> {
  return conn.executeWithReconnect(async () => {
    const existingPoint = await retrieveAccessiblePointById(conn, id, { withVector: true });
    if (!existingPoint) {
      throw new SquadrulesError(`Memory with ID ${id} not found for quality metadata update`, 'MEMORY_NOT_FOUND', 404);
    }
    const existingPayload = existingPoint.payload as any;
    const updatedQualityMetadata = { ...(existingPayload.quality_metadata || {}), ...qualityMetadata };
    const spaceId = existingPayload.space_id ?? getSpaceContext().defaultWriteSpaceId;
    const updatedPayload = { ...existingPayload, space_id: spaceId, quality_metadata: updatedQualityMetadata, updated_at: new Date().toISOString() };
    await sanitizeAndUpsert(conn.client, conn.collectionName, [{ id: existingPoint.id, vector: existingPoint.vector as any, payload: updatedPayload }]);
  });
}

export async function trackPendingValidation(conn: QdrantConnection, id: string, modelId: string, protocolStep?: number): Promise<void> {
  return conn.executeWithReconnect(async () => {
    const existingPoint = await retrieveAccessiblePointById(conn, id, { withVector: true });
    if (!existingPoint) {
      throw new SquadrulesError(`Memory with ID ${id} not found for validation tracking`, 'MEMORY_NOT_FOUND', 404);
    }
    const existingPayload = existingPoint.payload as any;
    const currentMetrics = existingPayload.quality_metrics || {};
    const implementationStats = currentMetrics.implementation_stats || {
      total_attempts: 0, success_attempts: 0, model_success_rates: {}, confidence_level: 0, last_implementation_attempt: null
    };

    if (!implementationStats.model_success_rates[modelId]) {
      implementationStats.model_success_rates[modelId] = { attempts: 0, successes: 0, success_rate: 0, wilson_lower: 0, wilson_upper: 0, last_attempt: null };
    }
    implementationStats.model_success_rates[modelId].attempts += 1;
    implementationStats.total_attempts = (implementationStats.total_attempts || 0) + 1;
    implementationStats.last_implementation_attempt = new Date().toISOString();

    if (protocolStep !== undefined) {
      const stepKey = protocolStep.toString();
      if (!currentMetrics.step_success_rates) currentMetrics.step_success_rates = {};
      if (!currentMetrics.step_success_rates[stepKey]) {
        currentMetrics.step_success_rates[stepKey] = { step_number: protocolStep, total_attempts: 0, success_attempts: 0, success_rate: 0, common_failures: [], last_attempt: null };
      }
      currentMetrics.step_success_rates[stepKey].total_attempts += 1;
      currentMetrics.step_success_rates[stepKey].last_attempt = new Date().toISOString();
    }

    const spaceId = existingPayload.space_id ?? getSpaceContext().defaultWriteSpaceId;
    const updatedPayload = { ...existingPayload, space_id: spaceId, quality_metrics: { ...currentMetrics, implementation_stats: implementationStats }, updated_at: new Date().toISOString() };
    await conn.client.upsert(conn.collectionName, { points: [{ id: existingPoint.id, vector: existingPoint.vector as any, payload: updatedPayload }] });
    logger.debug(`trackPendingValidation: updated implementation stats for ${existingPoint.id} model=${modelId}`);
  });
}