import { QdrantConnection } from './connection.js';
import { retrieveById, retrieveAccessiblePointById } from './memory-retrieval.js';
import { embeddingService } from '../embedding/service.js';
import { sanitizeAndUpsert, validateAndConvertId } from './utils.js';
import { redisCacheService } from '../redis-cache.js';
import { logger } from '../../utils/structured-logger.js';
import { SquadrulesError } from '../../types/index.js';
import { qdrantOperations, qdrantOperationDuration, qdrantUpsertDuration } from '../metrics/qdrant-metrics.js';
import { getTenantId, getSpaceContext } from '../../utils/tenant-context.js';

/**
 * Update memory by UUID (for protocol reconstruction) and general update/delete
 */

export async function updateMemoryByUUID(conn: QdrantConnection, uuid: string, updates: any): Promise<void> {
  return conn.executeWithReconnect(async () => {
    const tenantId = getTenantId();
    const timer = qdrantUpsertDuration.startTimer({ tenant_id: tenantId });
    
    try {
      const existingPoint = await retrieveAccessiblePointById(conn, uuid, { withVector: true });
      if (!existingPoint) {
        throw new SquadrulesError(`Memory with UUID ${uuid} not found`, 'MEMORY_NOT_FOUND', 404);
      }

      const existingPayload = existingPoint.payload as any;
      const actorId = getSpaceContext().userId || 'system';
      const updatedAi = {
        ...(existingPayload.ai || {}),
        ...((updates.ai || {}) as any),
        ...(updates.memory_uuid !== undefined ? { memory_uuid: updates.memory_uuid } : {})
      };

      const defaultSpaceId = getSpaceContext().defaultWriteSpaceId;
      const memoryPayload = {
        ...existingPayload,
        space_id: existingPayload.space_id ?? defaultSpaceId,
        ...(updates.label && { label: updates.label }),
        ...(updates.text && { text: updates.text }),
        ...(updates.domain && { domain: updates.domain }),
        ...(updates.task && { task: updates.task }),
        ...(updates.type && { type: updates.type }),
        ...(updates.tags && { tags: updates.tags }),
        ai: updatedAi,
        updated_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
        modified_by: actorId,
        created_by: existingPayload.created_by ?? actorId
      };

      let vector: number[] = [];
      let existingVectorObj: any = existingPoint.vector;
      if (Array.isArray(existingVectorObj)) vector = existingVectorObj as number[];
      else if (existingVectorObj && typeof existingVectorObj === 'object') {
        const firstKey = Object.keys(existingVectorObj || {})[0];
        if (firstKey && Array.isArray(existingVectorObj[firstKey])) vector = existingVectorObj[firstKey] as number[];
      }

      if (updates.text && updates.text !== existingPayload.text) {
        const embeddingResult = await embeddingService.generateEmbedding(updates.text);
        vector = embeddingResult.embedding;
      }

      const upsertPoint: any = { id: existingPoint.id, payload: memoryPayload };
      if (Array.isArray(vector) && vector.length > 0) {
        const currentVectorName = `vs${vector.length}`;
        upsertPoint.vector = { [currentVectorName]: vector };
      } else if (existingVectorObj) {
        upsertPoint.vector = existingVectorObj;
      }

      logger.debug(`updateMemoryByUUID: upsertPoint vector keys=${Object.keys(upsertPoint.vector || {}).join(',')}`);
      await sanitizeAndUpsert(conn.client, conn.collectionName, [upsertPoint]);

      // Strict cache invalidation: propagate errors so callers detect stale-cache risk (tune false-success guard)
      await redisCacheService.invalidateMemoryCacheStrict(existingPoint.id);
      await redisCacheService.invalidateAfterUpdate();

      qdrantOperations.inc({
        operation: 'update',
        status: 'success',
        tenant_id: tenantId
      });

      timer({ tenant_id: tenantId });
    } catch (error) {
      qdrantOperations.inc({ 
        operation: 'update', 
        status: 'error',
        tenant_id: tenantId 
      });
      timer({ tenant_id: tenantId });
      throw error;
    }
  });
}

export async function updateMemory(conn: QdrantConnection, id: string, updates: any): Promise<void> {
  return conn.executeWithReconnect(async () => {
    const tenantId = getTenantId();
    const timer = qdrantUpsertDuration.startTimer({ tenant_id: tenantId });
    
    try {
      const validatedId = validateAndConvertId(id);
      const existingPoint = await retrieveAccessiblePointById(conn, validatedId, { withVector: true });
      if (!existingPoint) {
        throw new SquadrulesError(`Memory with ID ${id} not found`, 'MEMORY_NOT_FOUND', 404);
      }
      const existingPayload = existingPoint.payload as any;
      const actorId = getSpaceContext().userId || 'system';

      let newQualityMetadata = existingPayload.quality_metadata;
      const shouldRecalculateQuality = updates.label || updates.text || updates.domain || updates.task || updates.type || updates.tags;
      if (shouldRecalculateQuality) {
        const { modelStats } = await import('../stats/model-stats.js');
        const qualityMetadata = modelStats.calculateStepQualityMetadata(
          updates.label || existingPayload.label || '',
          updates.domain || existingPayload.domain || 'general',
          updates.task || existingPayload.task || 'general-task',
          updates.type || existingPayload.type || 'context',
          updates.tags || existingPayload.tags || []
        );
        newQualityMetadata = {
          step_quality_score: qualityMetadata.step_quality_score,
          step_quality: qualityMetadata.step_quality
        };
      }

      // Drop retired content aliases if an older caller still sends them.
      const {
        description_short: _ignoredDescriptionShort,
        description_full: _ignoredDescriptionFull,
        ...safeUpdates
      } = updates ?? {};
      const defaultSpaceId = getSpaceContext().defaultWriteSpaceId;
      const updatedPayload = {
        ...existingPayload,
        space_id: existingPayload.space_id ?? defaultSpaceId,
        ...safeUpdates,
        updated_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
        modified_by: actorId,
        created_by: existingPayload.created_by ?? actorId,
        quality_metadata: newQualityMetadata
      };

      let vector: number[] = [];
      let existingVectorObj: any = undefined;
      if (existingPoint.vector) {
        existingVectorObj = existingPoint.vector;
        if (Array.isArray(existingPoint.vector)) vector = existingPoint.vector as number[];
        else if (typeof existingPoint.vector === 'object') {
          const fname = Object.keys(existingPoint.vector || {})[0];
          if (fname && Array.isArray((existingPoint.vector as any)[fname])) vector = (existingPoint.vector as any)[fname] as number[];
        }
      }

      const textChanged = typeof (updates as any).text === 'string' && (updates as any).text !== existingPayload.text;
      if (textChanged) {
        const source = (updates as any).text as string;
        const embeddingResult = await embeddingService.generateEmbedding(source);
        vector = embeddingResult.embedding;
      }

      const upsertPoint2: any = { id: existingPoint.id, payload: updatedPayload };
      if (Array.isArray(vector) && vector.length > 0) {
        const currentVectorName = `vs${vector.length}`;
        upsertPoint2.vector = { [currentVectorName]: vector };
      } else if (existingVectorObj) {
        upsertPoint2.vector = existingVectorObj;
      }

      logger.debug(`updateMemory: upsertPoint2 vector keys=${Object.keys(upsertPoint2.vector || {}).join(',')}`);
      await sanitizeAndUpsert(conn.client, conn.collectionName, [upsertPoint2]);

      // Strict cache invalidation: propagate errors so callers detect stale-cache risk (tune false-success guard)
      await redisCacheService.invalidateMemoryCacheStrict(existingPoint.id);
      await redisCacheService.invalidateAfterUpdate();

      qdrantOperations.inc({
        operation: 'update',
        status: 'success',
        tenant_id: tenantId
      });

      timer({ tenant_id: tenantId });
    } catch (error) {
      qdrantOperations.inc({ 
        operation: 'update', 
        status: 'error',
        tenant_id: tenantId 
      });
      timer({ tenant_id: tenantId });
      throw error;
    }
  });
}

export async function deleteMemory(conn: QdrantConnection, id: string): Promise<void> {
  return conn.executeWithReconnect(async () => {
    const tenantId = getTenantId();
    const timer = qdrantOperationDuration.startTimer({ operation: 'delete', tenant_id: tenantId });

    try {
      const validatedId = validateAndConvertId(id);
      const existing = await retrieveById(conn, validatedId);
      if (!existing) {
        throw new SquadrulesError(`Memory with ID ${id} not found`, 'MEMORY_NOT_FOUND', 404);
      }
      await conn.client.delete(conn.collectionName, { points: [validatedId] });
      
      // Strict cache invalidation: propagate errors so callers detect stale-cache risk
      await redisCacheService.invalidateMemoryCacheStrict(validatedId);
      await redisCacheService.invalidateAfterUpdate();
      
      qdrantOperations.inc({ 
        operation: 'delete', 
        status: 'success',
        tenant_id: tenantId 
      });
      
      timer({ operation: 'delete', tenant_id: tenantId });
    } catch (error) {
      qdrantOperations.inc({ 
        operation: 'delete', 
        status: 'error',
        tenant_id: tenantId 
      });
      timer({ operation: 'delete', tenant_id: tenantId });
      throw error;
    }
  });
}

// Ensure named exports are explicitly available