/** Qdrant store init: detect layout, migrate dimension, ensure BM25 (recreate via temp if needed), full-text indexes, activation backfill. */

import { QdrantClient } from '@qdrant/js-client-rest';
import { logger } from '../../utils/structured-logger.js';
import type { VectorDescriptorMap } from '../../utils/qdrant-vector-types.js';
import {
  getVectorDescriptors,
  createQdrantCollection,
  getCollectionVectorConfig,
  addVectorsToCollection,
  migrateVectorSpace,
  removeVectorFromCollection,
  countPointsWithVector,
  getVectorSize,
  getPrimaryVectorName
} from '../../utils/qdrant-utils.js';
import { embeddingService } from '../embedding/service.js';
import { tokenizeToSparse } from '../embedding/bm25-tokenizer.js';
import { backfillActivationSearchVectors } from './activation-search-backfill.js';

const BM25_MIGRATION_BATCH_SIZE = 256;
const BM25_MIGRATION_TEMP_SUFFIX = '_bm25_mig';

/**
 * Returns true if collection has bm25 sparse vector config.
 */
function collectionHasBm25(info: { config?: { params?: { sparse_vectors?: unknown } } }): boolean {
  const sparse = (info.config?.params as { sparse_vectors?: Record<string, unknown> } | undefined)?.sparse_vectors;
  return Boolean(sparse && typeof sparse === 'object' && Object.prototype.hasOwnProperty.call(sparse, 'bm25'));
}

/**
 * Recreation-based migration: copy collection to a new collection with dense + BM25 schema, then replace original.
 * Used when updateCollection(sparse_vectors) is not supported by the server. Idempotent if collection already has bm25.
 * Rollback: if migration aborts before deleting source, no change. If it aborts after delete, temp collection holds data (use as QDRANT_COLLECTION).
 */
async function migrateCollectionToBm25Recreation(
  client: QdrantClient,
  collection: string,
  denseVectorName: string,
  vectorDescriptors: VectorDescriptorMap
): Promise<void> {
  const tempCollection = `${collection}${BM25_MIGRATION_TEMP_SUFFIX}`;
  logger.info(`[MemoryQdrantStore] BM25 migration: creating temp collection ${tempCollection} (recreation path)`);
  await createQdrantCollection(client, tempCollection, vectorDescriptors);

  let sourceCount = 0;
  let offset: string | number | null | undefined = undefined;
  const scrollOpts = { with_payload: true, with_vector: true, limit: BM25_MIGRATION_BATCH_SIZE } as const;

  // Phase 1: scroll source → compute bm25 → upsert to temp (no filter = all points)
  do {
    const scrollParams = offset != null ? { ...scrollOpts, offset } : scrollOpts;
    const page = await client.scroll(collection, scrollParams);
    const points = page.points ?? [];
    if (points.length === 0) break;

    const batch = points.map((p) => {
      const payload = p.payload ?? {};
      const label = (payload['label'] as string) ?? '';
      const text = (payload['text'] as string) ?? '';
      const sparse = tokenizeToSparse(`${label} ${text}`.trim());
      const vec = p.vector;
      const denseVec = typeof vec === 'object' && vec !== null && !Array.isArray(vec) ? (vec as Record<string, number[]>)[denseVectorName] : Array.isArray(vec) ? vec : null;
      if (!denseVec || !Array.isArray(denseVec)) {
        throw new Error(`[MemoryQdrantStore] BM25 migration: point ${String(p.id)} has no dense vector ${denseVectorName}`);
      }
      return {
        id: p.id,
        vector: { [denseVectorName]: denseVec, bm25: { indices: sparse.indices, values: sparse.values } },
        payload,
      };
    });

    await client.upsert(tempCollection, { points: batch, wait: true });
    sourceCount += batch.length;
    logger.info(`[MemoryQdrantStore] BM25 migration: copied batch of ${batch.length} points to ${tempCollection} (total ${sourceCount})`);
    const next = page.next_page_offset;
    offset = typeof next === 'string' || typeof next === 'number' ? next : undefined;
  } while (offset !== undefined);

  const tempInfo = await client.getCollection(tempCollection);
  const tempPoints = (tempInfo as { points_count?: number }).points_count ?? sourceCount;
  if (sourceCount !== tempPoints) {
    await client.deleteCollection(tempCollection).catch(() => {});
    throw new Error(`[MemoryQdrantStore] BM25 migration: count mismatch source=${sourceCount} temp=${tempPoints}; aborted, temp collection deleted`);
  }

  logger.info(`[MemoryQdrantStore] BM25 migration: deleting original collection ${collection}`);
  await client.deleteCollection(collection);
  await new Promise((r) => setTimeout(r, 500));

  logger.info(`[MemoryQdrantStore] BM25 migration: recreating ${collection} with dense+bm25 schema`);
  await createQdrantCollection(client, collection, vectorDescriptors);

  // Phase 2: scroll temp → upsert to original (points already have both vectors)
  let restored = 0;
  offset = undefined;
  do {
    const scrollParams = offset != null ? { ...scrollOpts, offset } : scrollOpts;
    const page = await client.scroll(tempCollection, scrollParams);
    const points = page.points ?? [];
    if (points.length === 0) break;

    const batch = points.map((p) => ({
      id: p.id,
      vector: p.vector!,
      payload: p.payload ?? {},
    }));
    await client.upsert(collection, { points: batch, wait: true } as any);
    restored += batch.length;
    logger.info(`[MemoryQdrantStore] BM25 migration: restored batch of ${batch.length} to ${collection} (total ${restored})`);
    const nextRestore = page.next_page_offset;
    offset = typeof nextRestore === 'string' || typeof nextRestore === 'number' ? nextRestore : undefined;
  } while (offset !== undefined);

  const finalInfo = await client.getCollection(collection);
  const finalPoints = (finalInfo as { points_count?: number }).points_count ?? restored;
  if (restored !== finalPoints) {
    logger.error(`[MemoryQdrantStore] BM25 migration: restored=${restored} final=${finalPoints}; temp ${tempCollection} kept for recovery`);
    throw new Error(`[MemoryQdrantStore] BM25 migration: restore count mismatch; check collection ${tempCollection}`);
  }

  await client.deleteCollection(tempCollection);
  logger.info(`[MemoryQdrantStore] BM25 migration: complete for ${collection}; points=${finalPoints}; temp collection removed`);
}

/**
 * Ensure existing collection has bm25 sparse vector config (idempotent).
 * Tries updateCollection first; on failure runs recreation-based migration so the collection always ends with BM25.
 */
async function ensureBm25SparseConfig(
  client: QdrantClient,
  collection: string,
  denseVectorName: string,
  vectorDescriptors: VectorDescriptorMap
): Promise<void> {
  const info = await client.getCollection(collection);
  if (collectionHasBm25(info)) {
    logger.debug(`[MemoryQdrantStore] Collection ${collection} already has bm25 sparse vector config`);
    return;
  }
  try {
    await client.updateCollection(collection, { sparse_vectors: { bm25: {} } } as Parameters<QdrantClient['updateCollection']>[1]);
    logger.info(`[MemoryQdrantStore] Added bm25 sparse vector config to collection ${collection}`);
  } catch (err) {
    logger.warn(`[MemoryQdrantStore] updateCollection(sparse_vectors) not supported: ${err instanceof Error ? err.message : String(err)}; running recreation migration`);
    await migrateCollectionToBm25Recreation(client, collection, denseVectorName, vectorDescriptors);
  }
}

const FULL_TEXT_INDEX_FIELDS = [
  'adapter_name_text',
  'label_text',
  'activation_patterns_text',
  'tags_text',
] as const;

async function ensureFullTextIndexes(client: QdrantClient, collection: string): Promise<void> {
  for (const field of FULL_TEXT_INDEX_FIELDS) {
    try {
      await client.createPayloadIndex(collection, {
        field_name: field,
        field_schema: { type: 'text', tokenizer: 'word', min_token_len: 2, max_token_len: 40, lowercase: true },
      } as Parameters<QdrantClient['createPayloadIndex']>[1]);
      logger.info(`[MemoryQdrantStore] Created full-text index for ${field}`);
    } catch {
      logger.debug(`[MemoryQdrantStore] Full-text index for ${field} already exists or could not be created`);
    }
  }
}

/** Initialize Qdrant store: detect layout, migrate dimension if needed, ensure BM25 + full-text indexes. */
export async function initializeQdrantStore(client: QdrantClient, collection: string, url: string): Promise<void> {
  try {
    logger.info(
      `[MemoryQdrantStore] Checking Qdrant collections at "${url}" for "${collection}"`
    );

    const collections = await client.getCollections();
    const names = (collections.collections || []).map((c: any) => c.name);
    logger.info(
      `[MemoryQdrantStore] Qdrant getCollections OK, existing collections=${JSON.stringify(
        names
      )}`
    );

    const exists = names.includes(collection);
    const vectorDescriptors = getVectorDescriptors();
    const currentDim = Object.values(vectorDescriptors)[0]?.size ?? getVectorSize();
    const currentVectorName = getPrimaryVectorName(currentDim);

    if (!exists) {
      logger.info(
        `[MemoryQdrantStore] Creating collection "${collection}" at "${url}" with vector ${currentVectorName} (size ${currentDim})`
      );
      await createQdrantCollection(client, collection, vectorDescriptors);
      logger.info(
        `[MemoryQdrantStore] Collection "${collection}" created successfully`
      );
    } else {
      // Check existing collection vector config
      const collectionConfig = await getCollectionVectorConfig(client, collection);
      if (collectionConfig === null) {
        const errorMsg = `[MemoryQdrantStore] Collection ${collection} vector config could not be determined.`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      let existingVectorName: string | null = null;
      let existingDim: number | null = null;

      if (typeof collectionConfig === 'number') {
        // Older single-vector layout
        existingDim = collectionConfig;
        existingVectorName = `vs${existingDim}`;
        logger.info(`[MemoryQdrantStore] Detected older single-vector collection with size ${existingDim}, will migrate to named vector ${existingVectorName}`);
      } else {
        // Named vectors
        const namedConfig = collectionConfig as Record<string, { size?: number }>;
        const vectorNames = Object.keys(namedConfig);
        const currentPrimaryConfig = namedConfig[currentVectorName];
        if (currentPrimaryConfig?.size) {
          existingVectorName = currentVectorName;
          existingDim = currentPrimaryConfig.size;
          if (vectorNames.length > 1) {
            logger.info(`[MemoryQdrantStore] Collection already has named vectors: ${vectorNames.join(', ')}`);
          }
        } else if (vectorNames.length > 0) {
          if (vectorNames.length > 1) {
            logger.warn(`[MemoryQdrantStore] Collection has named vectors without current primary ${currentVectorName}: ${vectorNames.join(', ')}`);
          }
          existingVectorName = vectorNames[0]!;
          existingDim = namedConfig[existingVectorName]?.size || null;
        }
      }

      const missingNamedVectors =
        typeof collectionConfig === 'number'
          ? vectorDescriptors
          : Object.fromEntries(
              Object.entries(vectorDescriptors).filter(
                ([vectorName]) => !(vectorName in collectionConfig)
              )
            );

      if (
        typeof collectionConfig !== 'number' &&
        existingDim === currentDim &&
        existingVectorName === currentVectorName
      ) {
        logger.info(
          `[MemoryQdrantStore] Collection "${collection}" already exists with correct vector ${currentVectorName} (size ${currentDim})`
        );
        if (Object.keys(missingNamedVectors).length > 0) {
          logger.info(
            `[MemoryQdrantStore] Adding missing named vectors: ${Object.keys(missingNamedVectors).join(', ')}`
          );
          await addVectorsToCollection(client, collection, missingNamedVectors);
        }
      } else {
        logger.info(`[MemoryQdrantStore] Vector migration required. existingDim=${existingDim} currentDim=${currentDim} existingVector=${existingVectorName} currentVector=${currentVectorName}`);
        const sourceVectorIsRequired =
          existingVectorName != null &&
          Object.prototype.hasOwnProperty.call(vectorDescriptors, existingVectorName);

        // Step 1: If the collection uses the older layout, add the named version
        if (typeof collectionConfig === 'number') {
          // For the older layout, add the named vector first.
          logger.info(`[MemoryQdrantStore] Step 1: Adding named vector ${existingVectorName} to collection with the older layout`);
          try {
            await addVectorsToCollection(client, collection, { [existingVectorName!]: { size: existingDim!, distance: 'Cosine', on_disk: true } });
            logger.info(`[MemoryQdrantStore] Step 1 complete: Added named vector ${existingVectorName} to collection with the older layout`);
          } catch (err) {
            logger.error(`[MemoryQdrantStore] Step 1 failed: could not add named vector ${existingVectorName} to ${collection}: ${String(err)}`);
            throw err;
          }
        }

        // Step 2: Add the new vector space
        logger.info(`[MemoryQdrantStore] Step 2: Adding new vector ${currentVectorName} (size ${currentDim})`);
        try {
          await addVectorsToCollection(client, collection, vectorDescriptors);
          logger.info(`[MemoryQdrantStore] Step 2 complete: Added new vector ${currentVectorName} (size ${currentDim})`);
        } catch (err) {
          logger.error(`[MemoryQdrantStore] Step 2 failed: could not add new vector ${currentVectorName} to ${collection}: ${String(err)}`);
          throw err;
        }

        // Step 3: Migrate data from old to new vector
        if (existingVectorName && existingVectorName !== currentVectorName) {
          logger.info(`[MemoryQdrantStore] Step 3: Migrating data from ${existingVectorName} to ${currentVectorName}`);
          try {
            // Pre-migration counts
            const oldCount = await countPointsWithVector(client, collection, existingVectorName);
            logger.info(`[MemoryQdrantStore] Pre-migration: points with ${existingVectorName}=${oldCount}`);
            await migrateVectorSpace(client, collection, existingVectorName, currentVectorName, embeddingService, 64);
            logger.info(`[MemoryQdrantStore] Step 3 complete: Migrated data from ${existingVectorName} to ${currentVectorName}`);
            // Post-migration counts
            const newCount = await countPointsWithVector(client, collection, currentVectorName);
            logger.info(`[MemoryQdrantStore] Post-migration: points with ${currentVectorName}=${newCount}`);
            // Simple check: if newCount >= oldCount, attempt to remove old vector
            if (newCount >= oldCount) {
              if (sourceVectorIsRequired) {
                logger.info(`[MemoryQdrantStore] Preserving required vector ${existingVectorName}; no removal needed after migration`);
              } else {
                logger.info(`[MemoryQdrantStore] Precondition satisfied: ${newCount} >= ${oldCount}. Attempting to remove old vector ${existingVectorName}`);
                try {
                  await removeVectorFromCollection(client, collection, existingVectorName);
                } catch (remErr) {
                  logger.warn(`[MemoryQdrantStore] removeVectorFromCollection failed: ${String(remErr)}`);
                }
              }
            } else {
              logger.warn(`[MemoryQdrantStore] Precondition failed: ${newCount} < ${oldCount}. Not removing old vector ${existingVectorName}`);
            }
          } catch (err) {
            logger.error(`[MemoryQdrantStore] Step 3 failed: Migration error from ${existingVectorName} to ${currentVectorName}: ${String(err)}`);
            // Attempt to continue: try to remove vector if partial migration isn't critical
            throw err;
          }

          // Step 4: Attempt to remove old vector (may not be supported)
          if (sourceVectorIsRequired) {
            logger.info(`[MemoryQdrantStore] Step 4 skipped: preserving required vector ${existingVectorName}`);
          } else {
            logger.info(`[MemoryQdrantStore] Step 4: Attempting to remove old vector ${existingVectorName} from collection ${collection}`);
            try {
              await removeVectorFromCollection(client, collection, existingVectorName);
              logger.info(`[MemoryQdrantStore] Step 4 complete: Removed old vector ${existingVectorName}`);
            } catch (err) {
              logger.warn(`[MemoryQdrantStore] Step 4 warning: ${String(err)}`);
            }
          }
        }
        logger.info(`[MemoryQdrantStore] Migration complete for collection "${collection}" - status=SUCCESS`);
      }

      // Ensure bm25 sparse vector config (idempotent; required for hybrid search). Uses recreation if updateCollection not supported.
      await ensureBm25SparseConfig(client, collection, currentVectorName, vectorDescriptors);
      await ensureFullTextIndexes(client, collection);
      await backfillActivationSearchVectors(client, collection, currentDim);
    }
  } catch (error) {
    logger.error(
      `[MemoryQdrantStore] Failed to initialize Qdrant memory store at "${url}" (collection="${collection}")`,
      error
    );
    throw error;
  }
}