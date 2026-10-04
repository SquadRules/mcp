import type { QdrantService } from './qdrant/service.js';
import { redisCacheService } from './redis-cache.js';
import { IDGenerator } from './id-generator.js';
import { modelStats } from './stats/model-stats.js';
import { logger } from '../utils/structured-logger.js';
import { SquadrulesError } from '../types/index.js';

export interface RewardMetricsResult {
  results: Array<{
    uri: string;
    outcome: 'success' | 'failure';
    quality_bonus: number;
    feedback?: string;
    rated_at: string;
  }>;
  total_rated: number;
  total_failed: number;
}

export async function applyRewardMetrics(
  qdrantService: QdrantService,
  input: {
    uri: string;
    outcome: 'success' | 'failure';
    feedback?: string;
    qualityBonus?: number;
    evaluatorId?: string;
  }
): Promise<RewardMetricsResult> {
  const { uri, outcome, feedback, qualityBonus = 0, evaluatorId } = input;
  const modelIdentity = {
    modelId: evaluatorId || 'reward',
    provider: 'unknown',
    family: 'unknown'
  };
  const uris = [uri];
  const results: RewardMetricsResult['results'] = [];
  let totalRated = 0;

  logger.tool(
    'reward',
    'rate',
    `single rating of ${uri} with outcome="${outcome}" model="${modelIdentity.modelId}"`
  );

  for (const currentUri of uris) {
    try {
      const qdrantUuid = IDGenerator.qdrantIdFromUri(currentUri);
      const basicQualityBonus = outcome === 'success' ? 1 : -0.2;
      const currentPoint = await qdrantService.retrieveById(qdrantUuid);
      const currentMetrics = currentPoint?.payload?.quality_metrics || {};
      const implementationBonus = await modelStats.calculateImplementationBonus(
        currentMetrics,
        modelIdentity.modelId,
        outcome
      );
      const totalQualityBonus = basicQualityBonus + implementationBonus + qualityBonus;
      const metricsUpdate: Record<string, unknown> = {
        retrievalCount: 1,
        successCount: outcome === 'success' ? 1 : 0,
        failureCount: outcome === 'failure' ? 1 : 0,
        lastRated: new Date().toISOString(),
        lastRater: modelIdentity.modelId,
        qualityBonus: totalQualityBonus
      };
      if (feedback) {
        metricsUpdate['usageContext'] = feedback;
      }
      await qdrantService.updateQualityMetrics(qdrantUuid, metricsUpdate);
      await qdrantService.propagateRewardToAdapterHead(qdrantUuid, metricsUpdate);
      await redisCacheService.invalidateBeginCache();

      if (currentPoint?.payload) {
        const { label, domain, task, type, tags } = currentPoint.payload;
        const updatedQualityMetadata = modelStats.calculateStepQualityMetadata(
          label || 'Knowledge step',
          domain || 'general',
          task || 'general',
          type || 'context',
          tags || [],
          outcome
        );
        await qdrantService.updateQualityMetadata(qdrantUuid, {
          step_quality_score: updatedQualityMetadata.step_quality_score,
          step_quality: updatedQualityMetadata.step_quality
        });
        logger.info(
          `reward: Updated quality metadata for ${currentUri} with execution ${outcome} - score: ${updatedQualityMetadata.step_quality_score} (${updatedQualityMetadata.step_quality})`
        );
      }

      await modelStats.processQualityFeedback(modelIdentity.modelId, currentUri, outcome, totalQualityBonus);
      if (implementationBonus > 0) {
        await modelStats.updateImplementationBonus(modelIdentity.modelId, implementationBonus);
      }

      results.push({
        uri: currentUri,
        outcome,
        quality_bonus: totalQualityBonus,
        ...(feedback ? { feedback } : {}),
        rated_at: new Date().toISOString()
      });
      totalRated++;
      logger.success('reward', `rated ${currentUri} with ${outcome} (${totalQualityBonus} bonus)`);
    } catch (error) {
      logger.error(`reward failed for ${currentUri}`, error);
      if (error instanceof SquadrulesError) {
        throw error;
      }
      throw new Error(
        `Failed to persist reward metrics for ${currentUri}. No reward was stored.`,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  return { results, total_rated: totalRated, total_failed: 0 };
}
