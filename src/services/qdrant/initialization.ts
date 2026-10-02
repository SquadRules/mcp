// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { QdrantConnection } from './connection.js';
import { createQdrantCollection, getVectorDescriptors, getCollectionVectorConfig } from '../../utils/qdrant-utils.js';
import { logger } from '../../utils/structured-logger.js';
import { parseBooleanEnv } from './utils.js';
import { KAIROS_APP_SPACE_ID } from '../../config.js';

/**
 * Initialization related helpers that operate using QdrantConnection.
 * BM25 sparse vector config migration runs in store-init.ts (upgrade at boot).
 */

export async function initializeCollection(conn: QdrantConnection): Promise<void> {
  return conn.executeWithReconnect(async () => {
    logger.info(`Initializing Qdrant collection: ${conn.collectionName}`);
    const isHealthy = await conn.checkHealth();
    if (!isHealthy) {
      throw new Error('Qdrant service is not healthy during initialization');
    }

    const collections = await conn.client.getCollections();
    const collectionExists = collections.collections.some((col: any) => col.name === conn.collectionName);

    const vectorDescriptors = getVectorDescriptors();
    const vectorSize = Object.values(vectorDescriptors)[0]?.size ?? ((await getCollectionVectorConfig(conn.client, conn.collectionName) as any) || 1024);

    if (!collectionExists) {
      logger.info(`Creating collection ${conn.collectionName} with vector size ${vectorSize}`);
      await createQdrantCollection(conn.client, conn.collectionName, vectorDescriptors);
      logger.info(`Collection ${conn.collectionName} created successfully`);
    } else {
      // verify vector config and recreate if mismatch
      const collectionConfig = await getCollectionVectorConfig(conn.client, conn.collectionName);
      let currentVectorSize: number | null = null;
      if (typeof collectionConfig === 'number') currentVectorSize = collectionConfig;
      else if (collectionConfig && typeof collectionConfig === 'object') {
        const names = Object.keys(collectionConfig);
        if (names.length > 0) currentVectorSize = (collectionConfig as any)[names[0]!]?.size;
      }
      if (currentVectorSize !== vectorSize) {
        logger.warn(`Collection ${conn.collectionName} has vector size ${currentVectorSize}, expected ${vectorSize}. Recreating collection.`);
        await conn.client.deleteCollection(conn.collectionName);
        await createQdrantCollection(conn.client, conn.collectionName, vectorDescriptors);
        logger.info(`Collection ${conn.collectionName} recreated with correct vector size ${vectorSize}`);
      } else {
        logger.info(`Collection ${conn.collectionName} already exists with correct vector size`);
      }
    }

    // Create payload indexes (space_id with is_tenant for multitenancy)
    const indexConfigs = [
      { field_name: 'space_id', field_schema: { type: 'keyword' as const, is_tenant: true } },
      { field_name: 'domain', field_schema: 'keyword' as const },
      { field_name: 'type', field_schema: 'keyword' as const },
      { field_name: 'task', field_schema: 'keyword' as const },
      { field_name: 'protocol.step', field_schema: 'integer' as const },
      { field_name: 'quality_metadata.step_quality_score', field_schema: 'integer' as const },
      { field_name: 'quality_metadata.step_quality', field_schema: 'keyword' as const },
      { field_name: 'ai.memory_uuid', field_schema: 'keyword' as const },
      { field_name: 'adapter.id', field_schema: 'keyword' as const },
      { field_name: 'adapter.layer_index', field_schema: 'integer' as const },
      { field_name: 'adapter.layer_count', field_schema: 'integer' as const },
      { field_name: 'adapter.activation_patterns', field_schema: 'keyword' as const },
      { field_name: 'slug', field_schema: 'keyword' as const },
      { field_name: 'content_type', field_schema: 'keyword' as const },
      { field_name: 'adapter_name_text', field_schema: { type: 'text' as const, tokenizer: 'word' as const, min_token_len: 2, max_token_len: 40, lowercase: true } },
      { field_name: 'label_text', field_schema: { type: 'text' as const, tokenizer: 'word' as const, min_token_len: 2, max_token_len: 40, lowercase: true } },
      { field_name: 'activation_patterns_text', field_schema: { type: 'text' as const, tokenizer: 'word' as const, min_token_len: 2, max_token_len: 40, lowercase: true } },
      { field_name: 'tags_text', field_schema: { type: 'text' as const, tokenizer: 'word' as const, min_token_len: 2, max_token_len: 40, lowercase: true } }
    ];

    for (const index of indexConfigs) {
      try {
        await conn.client.createPayloadIndex(conn.collectionName, index as Parameters<typeof conn.client.createPayloadIndex>[1]);
        logger.info(`Created payload index for ${index.field_name}`);
      } catch (err) {
        logger.info(`Payload index for ${index.field_name} may already exist: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await backfillSpaceId(conn);

    // Optionally create 'current' alias
    if (conn.originalCollectionAlias === 'current' || parseBooleanEnv('QDRANT_CREATE_ALIAS', false)) {
      try {
        await createOrUpdateAlias(conn);
        logger.info(`Ensured Qdrant alias 'current' -> ${conn.collectionName}`);
      } catch (aliasErr) {
        logger.warn(`Failed to create/update Qdrant alias 'current': ${aliasErr instanceof Error ? aliasErr.message : String(aliasErr)}`);
      }
    }
  });
}

/**
 * Create or update alias for the active collection (best-effort).
 * Tries multiple REST endpoints to support various Qdrant versions.
 */
export async function createOrUpdateAlias(conn: QdrantConnection, aliasName: string = 'current'): Promise<void> {
  const baseUrl = conn.qdrantUrl.replace(/\/$/, '');
  const aliasPayloadVariants = [
    { method: 'PUT', url: `${baseUrl}/collections/${encodeURIComponent(conn.collectionName)}/aliases/${encodeURIComponent(aliasName)}`, body: null },
    { method: 'PUT', url: `${baseUrl}/collections/${encodeURIComponent(conn.collectionName)}/alias`, body: JSON.stringify({ alias_name: aliasName }) },
    { method: 'POST', url: `${baseUrl}/collections/aliases`, body: JSON.stringify({ collection_name: conn.collectionName, alias_name: aliasName }) }
  ];

  const headers: any = { 'Content-Type': 'application/json' };
  if (conn.apiKey) headers['api-key'] = conn.apiKey;

  for (const variant of aliasPayloadVariants) {
    try {
      const res = await fetch(variant.url, { method: variant.method, headers, body: variant.body } as any);
      if (res && (res.status === 200 || res.status === 201 || res.status === 204)) {
        logger.info(`Qdrant alias created/updated via ${variant.method} ${variant.url}`);
        return;
      } else {
        let text = '';
        try { text = await res.text(); } catch { /* ignore */ }
        logger.debug(`Alias attempt ${variant.method} ${variant.url} returned status=${res.status} body=${text}`);
      }
    } catch (err) {
      logger.debug(`Alias attempt ${variant.method} ${variant.url} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  logger.warn(`Unable to create or update Qdrant alias '${aliasName}'. Please create it manually if needed (target: ${conn.collectionName}).`);
}

const BACKFILL_BATCH_SIZE = 256;

/**
 * Backfill space_id for points that lack it (idempotent). Uses KAIROS_APP_SPACE_ID for older points.
 */
export async function backfillSpaceId(conn: QdrantConnection): Promise<{ updated: number }> {
  return conn.executeWithReconnect(async () => {
    let offset: any = undefined;
    let updated = 0;
    do {
      const page = await conn.client.scroll(conn.collectionName, {
        with_payload: true,
        with_vector: true,
        limit: BACKFILL_BATCH_SIZE,
        offset
      } as any);
      const points = page?.points ?? [];
      const toUpsert = points.filter((p: any) => p.payload && (p.payload.space_id === undefined || p.payload.space_id === null));
      if (toUpsert.length > 0) {
        const batch = toUpsert.map((p: any) => ({
          id: p.id,
          vector: p.vector,
          payload: { ...p.payload, space_id: KAIROS_APP_SPACE_ID }
        }));
        await conn.client.upsert(conn.collectionName, { points: batch });
        updated += batch.length;
        logger.info(`backfillSpaceId: upserted ${batch.length} points with space_id=${KAIROS_APP_SPACE_ID} (total so far: ${updated})`);
      }
      offset = page?.next_page_offset;
    } while (offset);
    if (updated > 0) {
      logger.info(`backfillSpaceId: completed, updated ${updated} points`);
    }
    return { updated };
  });
}

/**
 * Get list of collections
 */
export async function getCollections(conn: QdrantConnection): Promise<string[]> {
  return conn.executeWithReconnect(async () => {
    const collections = await conn.client.getCollections();
    return collections.collections.map((col: any) => col.name);
  });
}

/**
 * Drop collection
 */
export async function dropCollection(conn: QdrantConnection, collectionName: string): Promise<void> {
  return conn.executeWithReconnect(async () => {
    await conn.client.deleteCollection(collectionName);
  }).catch(() => {
    logger.info(`Collection ${collectionName} cleanup completed or not needed`);
  });
}