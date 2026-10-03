import { QdrantConnection } from './connection.js';
import { UpsertResourceItem, UpsertResourceResult } from './types.js';
import { embeddingService } from '../embedding/service.js';
import { IDGenerator } from '../id-generator.js';
import { buildDomainTypeTaskURI, buildProtocolStepURI } from '../../utils/uri-builder.js';
import { sanitizeAndUpsert, validatePayload, validateAndConvertId } from './utils.js';
import { redisCacheService } from '../redis-cache.js';
import { logger } from '../../utils/structured-logger.js';
import { getEmbeddingDimension } from '../embedding/config.js';
import { getSpaceContext } from '../../utils/tenant-context.js';
import { buildSpaceFilter } from '../../utils/space-filter.js';
import { retrievePointAccessById } from './memory-retrieval.js';
import { SquadrulesError } from '../../types/index.js';

/**
 * upsertResources - bulk upsert of knowledge resources
 */
export async function upsertResources(conn: QdrantConnection, items: UpsertResourceItem[]): Promise<UpsertResourceResult[]> {
  return conn.executeWithReconnect(async () => {
    logger.debug(`upsertResources called with ${items.length} items`);
    const results: UpsertResourceResult[] = [];

    for (const item of items) {
      const uuid = item.uuid ? validateAndConvertId(item.uuid) : IDGenerator.generateUUID();

      // Duplicate check simplified: reuse scroll (scoped to allowed spaces)
      const duplicateFilter = buildSpaceFilter(getSpaceContext().allowedSpaceIds, {
        must: [
          { key: 'domain', match: { value: item.domain } },
          { key: 'type', match: { value: item.type || 'context' } },
          { key: 'task', match: { value: item.task } },
          ...(item.protocol ? [{ key: 'protocol.step', match: { value: item.protocol.step } }] : [])
        ]
      });
      const existingDuplicate = await conn.client.scroll(conn.collectionName, {
        filter: duplicateFilter,
        limit: 1,
        with_payload: true,
        with_vector: false
      });
      if (existingDuplicate.points && existingDuplicate.points.length > 0) {
        const point = existingDuplicate.points[0]!;
        const compositeKey = item.protocol ? `${item.domain}/${item.type || 'context'}/${item.task}/step/${item.protocol.step}` : `${item.domain}/${item.type || 'context'}/${item.task}`;
        throw new Error(`DUPLICATE_KEY: Composite key ${compositeKey} already exists with ID ${point.id}`);
      }

      const kbUri = item.protocol && item.protocol.step
        ? buildProtocolStepURI(item.domain, item.type || 'context', item.task, item.protocol.step)
        : buildDomainTypeTaskURI(item.domain, item.type || 'context', item.task);

      const qdrantId = IDGenerator.buildQdrantId(kbUri);

      logger.debug(`Generating embedding for item ${item.label}`);
      const embeddingResult = await embeddingService.generateEmbedding(item.text);
      let embedding = embeddingResult.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        const vectorSize = getEmbeddingDimension();
        logger.warn(`upsertResources: embedding service returned empty vector for item ${item.label}. Falling back to zero vector of size ${vectorSize}`);
        embedding = Array(vectorSize).fill(0);
      }

      const existingPointAccess = await retrievePointAccessById(conn, qdrantId);
      if (existingPointAccess.status === 'forbidden') {
        throw new SquadrulesError(`Memory with ID ${qdrantId} not found`, 'MEMORY_NOT_FOUND', 404);
      }
      const existingPoint = existingPointAccess.status === 'allowed' ? existingPointAccess.point : null;
      const existingPayload = existingPoint?.payload as Record<string, unknown> | undefined;
      const isUpdate = existingPoint !== null;
      const version = isUpdate ? ((existingPayload?.['version'] as number) || 1) + 1 : 1;
      const payloadUuid =
        typeof existingPayload?.['uuid'] === 'string'
          ? (existingPayload['uuid'] as string)
          : uuid;

      let protocolWithContext = item.protocol;
      let aiWithContext = item.ai;
      if (item.protocol) {
        const stepUuid = qdrantId;
        protocolWithContext = { ...item.protocol };
        aiWithContext = { ...item.ai, memory_uuid: stepUuid };
      }

      const spaceId = getSpaceContext().defaultWriteSpaceId;
      const actorId = getSpaceContext().userId || 'system';
      const nowIso = new Date().toISOString();
      const payload = {
        space_id: spaceId,
        uuid: payloadUuid,
        label: item.label,
        text: item.text,
        domain: item.domain,
        task: item.task,
        type: item.type || 'context',
        tags: item.tags || [],
        protocol: protocolWithContext,
        ai: aiWithContext,
        uri: kbUri,
        version,
        created_at: isUpdate ? existingPayload?.['created_at'] : nowIso,
        created_by: isUpdate ? existingPayload?.['created_by'] ?? actorId : actorId,
        updated_at: nowIso,
        modified_at: nowIso,
        modified_by: actorId,
        quality_metadata: item.quality_metadata || {
          step_quality_score: 1,
          step_quality: 'standard'
        },
        quality_metrics: isUpdate ? existingPayload?.['quality_metrics'] : {
          retrievalCount: 0, successCount: 0, partialCount: 0, failureCount: 0, lastRated: null, lastRater: null, qualityBonus: 0,
          usageContext: null, implementation_stats: { total_attempts: 0, success_attempts: 0, model_success_rates: {}, confidence_level: 0, last_implementation_attempt: null },
          healer_contributions: { total_healers: 0, total_improvements: 0, healer_bonus_distributed: 0, last_healed: null, healer_models: {} },
          step_success_rates: {}
        }
      };

      validatePayload(payload);

      logger.debug(`Upserting point with qdrantId: ${qdrantId}, uri: ${kbUri}`);
      const currentVectorName = `vs${embedding.length}`;
      await sanitizeAndUpsert(conn.client, conn.collectionName, [{ id: qdrantId, vector: { [currentVectorName]: embedding }, payload }]);
      logger.debug(`Upsert successful for ${uuid}`);

      await redisCacheService.invalidateAfterUpdate();

      results.push({
        uri: kbUri,
        uuid,
        status: isUpdate ? 'updated' : 'created',
        version,
        protocol_id: protocolWithContext?.title,
        protocol_uuid: protocolWithContext ? IDGenerator.generateDeterministicProtocolId(item.domain, item.type || 'context', item.task) : undefined,
        memory_uuid: aiWithContext?.memory_uuid,
        quality_metadata: payload.quality_metadata
      });
    }

    return results;
  });
}