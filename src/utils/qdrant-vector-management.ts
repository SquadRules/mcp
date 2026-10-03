import { QdrantClient } from '@qdrant/js-client-rest';
import { logger } from './structured-logger.js';
import { VectorDescriptorMap } from './qdrant-vector-types.js';
import { createQdrantCollection } from './qdrant-collection-utils.js';
import { SQUADRULES_APP_SPACE_ID } from '../config.js';
import { getSpaceContext } from '../utils/tenant-context.js';
import { buildSpaceFilter } from '../utils/space-filter.js';

/**
 * Add named vectors to an existing collection by updating its config.
 * This uses client.updateCollection and will fail if the server does not support the operation.
 */
export async function addVectorsToCollection(client: QdrantClient, collectionName: string, vectors: VectorDescriptorMap): Promise<void> {
  logger.info(`addVectorsToCollection: Attempting to add vectors [${Object.keys(vectors).join(', ')}] to collection ${collectionName}`);
  try {
    const updateCtx: any = { vectors: {} };
    Object.entries(vectors).forEach(([k, v]) => {
      updateCtx.vectors[k] = { size: v.size, distance: v.distance || 'Cosine', on_disk: v.on_disk };
    });
    // Attempt to call Qdrant updateCollection if available
    if (typeof (client as any).updateCollection === 'function') {
      await (client as any).updateCollection(collectionName, { vectors: updateCtx.vectors });
      logger.info(`addVectorsToCollection: updateCollection called successfully for ${collectionName} -> added ${Object.keys(updateCtx.vectors).join(',')}`);
    } else {
      // Try fallback: for older JS client versions, may not support updateCollection
      throw new Error('Qdrant client does not support updateCollection; please recreate collection with named vectors');
    }
  } catch (err) {
    // If updateCollection fails because server doesn't allow adding new vector names, we need a safer migration path
    const msg = (err as any)?.data?.status?.error || (err as any)?.message || String(err);
    logger.warn(`addVectorsToCollection: updateCollection failed: ${msg}`);
    // Heuristic: detect "Not existing vector name" error and attempt safe recreate + restore
    if (String(msg).includes('Not existing vector name') || String(msg).includes('Not existing named vector')) {
      logger.info(`addVectorsToCollection: detected inability to add vector via updateCollection, starting recreation-based migration for ${collectionName} to add vectors [${Object.keys(vectors).join(', ')}]`);
      // Step 1: Gather existing points via scroll in batches
      const allPoints: any[] = [];
      const filter = buildSpaceFilter(getSpaceContext().allowedSpaceIds);
      let offset: any = undefined;
      do {
        const page = await client.scroll(collectionName, {
          filter,
          with_payload: true,
          with_vector: true,
          limit: 256,
          offset
        } as any);
        if (!page?.points || page.points.length === 0) break;
        for (const p of page.points) {
          allPoints.push({ id: p.id, payload: p.payload, vector: p.vector });
        }
        offset = page.next_page_offset;
      } while (offset);

      logger.info(`addVectorsToCollection: fetched ${allPoints.length} points from ${collectionName} for recreation`);

      // Step 2: Recreate collection with merged vector set (existing vectors + requested)
      // Gather existing vector descriptors so we can merge them
      let mergedVectors: VectorDescriptorMap = {};
      try {
        const existingCollectionInfo = await client.getCollection(collectionName);
        const existingVectors = existingCollectionInfo.config?.params?.vectors;
        if (existingVectors) {
          if (typeof existingVectors === 'object' && !(existingVectors as any)?.size) {
            Object.entries(existingVectors as any).forEach(([k, v]: [string, any]) => {
              mergedVectors[k] = { size: (v as any).size, distance: (v as any).distance || 'Cosine', on_disk: (v as any).on_disk };
            });
          } else if (typeof existingVectors === 'object' && (existingVectors as any).size) {
            // older single-vector layout
            const ev = existingVectors as any;
            mergedVectors[`vs${ev.size}`] = { size: ev.size, distance: ev.distance || 'Cosine', on_disk: ev.on_disk };
          }
        }
      } catch (infoErr) {
        // ignore; best-effort merge
        logger.warn(`addVectorsToCollection: could not read existing collection info for ${collectionName}: ${String(infoErr)}`);
      }
      mergedVectors = { ...mergedVectors, ...vectors };
      // We simply delete and recreate the collection with the desired vectors
      try {
        await client.deleteCollection(collectionName);
        // small pause to ensure deletion is processed
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (delErr) {
        logger.warn(`addVectorsToCollection: failed to delete collection ${collectionName}: ${String(delErr)}; attempting to proceed`);
      }

      await createQdrantCollection(client, collectionName, mergedVectors);
      logger.info(`addVectorsToCollection: recreated collection ${collectionName} with new vectors: ${Object.keys(mergedVectors).join(',')}`);

      // Step 3: Re-insert points in batches to prevent memory pressure
      const BATCH_SIZE = 256;
      logger.info(`addVectorsToCollection: starting restore of ${allPoints.length} points to collection ${collectionName} (batchSize=${BATCH_SIZE})`);
      let restored = 0;
      for (let i = 0; i < allPoints.length; i += BATCH_SIZE) {
        const batch = allPoints.slice(i, i + BATCH_SIZE).map(pt => ({
          id: pt.id,
          vector: pt.vector,
          payload: { ...pt.payload, space_id: pt.payload?.space_id ?? SQUADRULES_APP_SPACE_ID }
        }));
        try {
          await client.upsert(collectionName, { points: batch } as any);
          restored += batch.length;
          logger.info(`addVectorsToCollection: upserted ${batch.length} restored points to ${collectionName} (restored total=${restored})`);
        } catch (upErr) {
          // If we fail here, try to continue and log
          logger.error(`addVectorsToCollection: failed upserting batch during recreation: ${String(upErr)}`);
        }
      }
      logger.info(`addVectorsToCollection: restore complete, collection ${collectionName} now contains ${restored} points (attempted ${allPoints.length})`);
      return;
    }
    throw err;
  }
}

/**
 * Migrate points from one named vector to another by re-embedding content.
 * Assumes the new vector space is already added to the collection.
 * @param client Qdrant client
 * @param collectionName Collection name
 * @param fromVectorName Source vector name (e.g., 'vs1024')
 * @param toVectorName Target vector name (e.g., 'vs1536')
 * @param embeddingService Service to generate new embeddings
 * @param batchSize Batch size for migration (default 64)
 */
export async function migrateVectorSpace(
  client: QdrantClient,
  collectionName: string,
  fromVectorName: string,
  toVectorName: string,
  embeddingService: any, // EmbeddingService
  batchSize: number = 64
): Promise<void> {
  let offset: any = undefined;
  let migrated = 0;
  let failed = 0;
  logger.info(`migrateVectorSpace: Starting migration from ${fromVectorName} to ${toVectorName} in collection ${collectionName} - status=START`);

  const filter = buildSpaceFilter(getSpaceContext().allowedSpaceIds);
  do {
    // Scroll points with the old vector
    const page = await client.scroll(collectionName, {
      filter,
      with_payload: true,
      with_vector: [fromVectorName], // Only fetch the old vector
      limit: batchSize,
      offset
    });

    if (!page.points || page.points.length === 0) break;

    const updates: any[] = [];

    for (const point of page.points) {
      const payload = point.payload as any;
      // Re-embed the content to get new vector
      const textToEmbed = [
        payload.text || '',
        payload.label || '',
        payload.text || '',
        `Tags: ${(payload.tags || []).join(', ')}`
      ].filter(t => t.trim()).join('\n');

      if (!textToEmbed.trim()) {
        logger.warn(`Point ${point.id} has no embeddable content, skipping`);
        continue;
      }

      let newVector: number[] | null = null;
      try {
        const embeddingResult = await embeddingService.generateEmbedding(textToEmbed);
        newVector = embeddingResult.embedding;
      } catch (embedErr) {
        failed += 1;
        logger.warn(`migrateVectorSpace: failed to generate embedding for point ${point.id}; skipping; reason=${String(embedErr)}`);
        continue;
      }

      // Prepare update: set new vector, keep payload
      updates.push({
        id: point.id,
        vector: { [toVectorName]: newVector },
        payload // Keep existing payload
      });
    }

    if (updates.length > 0) {
      try {
        await client.upsert(collectionName, { points: updates });
        migrated += updates.length;
        logger.info(`migrateVectorSpace: Migrated ${updates.length} points in current batch, total migrated: ${migrated}`);
      } catch (upErr) {
        // If upsert fails, log and attempt to continue
        logger.error(`migrateVectorSpace: failed to upsert migrated vectors batch: ${String(upErr)}; migrated so far: ${migrated}`);
      }
    }

    offset = page.next_page_offset;
  } while (offset);

  logger.info(`migrateVectorSpace: Migration complete for ${collectionName}: migrated=${migrated}, failed=${failed}, from=${fromVectorName}, to=${toVectorName} - status=COMPLETE`);
}

/**
 * Remove a named vector from the collection after migration.
 * Note: Qdrant may not support removing vectors once added; this is a placeholder.
 */
export async function removeVectorFromCollection(client: QdrantClient, collectionName: string, vectorName: string): Promise<void> {
  logger.info(`removeVectorFromCollection: Attempting to remove vector '${vectorName}' from collection '${collectionName}'`);
  // Recreate the collection without the given vectorName by gathering all points, removing the vector field,
  // and recreating the collection with a merged vector map that excludes the vectorName.
  try {
    const collectionInfo = await client.getCollection(collectionName);
    const vectors = collectionInfo.config?.params?.vectors;
    if (!vectors) {
      logger.warn(`removeVectorFromCollection: No vector config found for ${collectionName}; nothing to remove`);
      return;
    }

    // Convert to descriptor map
    const existingVectors: VectorDescriptorMap = {};
    if (typeof vectors === 'object' && !(vectors as any).size) {
      Object.entries(vectors as any).forEach(([k, v]: [string, any]) => {
        existingVectors[k] = { size: v.size, distance: v.distance || 'Cosine', on_disk: v.on_disk };
      });
    } else if (typeof vectors === 'object' && (vectors as any).size) {
      // Single root vector; cannot remove unless recreating collection & leaving no vectors which is invalid
      const ev = vectors as any;
      existingVectors[`vs${ev.size}`] = { size: ev.size, distance: ev.distance || 'Cosine', on_disk: ev.on_disk };
    }

    if (!(vectorName in existingVectors)) {
      logger.info(`removeVectorFromCollection: vector '${vectorName}' not present in collection '${collectionName}', nothing to remove`);
      return;
    }

    // Build new vector map excluding the vectorName
    const newVectors: VectorDescriptorMap = {};
    Object.entries(existingVectors).forEach(([k, v]) => {
      if (k !== vectorName) newVectors[k] = v;
    });

    if (Object.keys(newVectors).length === 0) {
      logger.error(`removeVectorFromCollection: Cannot remove vector '${vectorName}' as it would leave collection '${collectionName}' without any vectors`);
      return;
    }

    // Gather all points and strip the vectorName from all points
    const filter = buildSpaceFilter(getSpaceContext().allowedSpaceIds);
    const allPoints: any[] = [];
    let offset: any = undefined;
    do {
      const page = await client.scroll(collectionName, { filter, with_payload: true, with_vector: true, limit: 256, offset } as any);
      if (!page?.points || page.points.length === 0) break;
      for (const p of page.points) {
        const vec = p.vector || {};
        // Copy all vector fields except the removed one
        const newVectorFields: Record<string, any> = {};
        Object.entries(vec).forEach(([vn, v]: [string, any]) => {
          if (vn !== vectorName) newVectorFields[vn] = v;
        });
        allPoints.push({ id: p.id, vector: newVectorFields, payload: p.payload });
      }
      offset = page.next_page_offset;
    } while (offset);

    logger.info(`removeVectorFromCollection: Fetched ${allPoints.length} points from ${collectionName} to recreate without ${vectorName}`);

    // Delete, recreate with new vectors, and upsert points (without the removed vector)
    try {
      await client.deleteCollection(collectionName);
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (delErr) {
      logger.warn(`removeVectorFromCollection: failed to delete collection ${collectionName}: ${String(delErr)}; attempting to proceed`);
    }

    await createQdrantCollection(client, collectionName, newVectors);
    logger.info(`removeVectorFromCollection: recreated collection ${collectionName} without vector ${vectorName}; new vectors: ${Object.keys(newVectors).join(',')}`);

    const BATCH_SIZE = 256;
    let restored = 0;
    for (let i = 0; i < allPoints.length; i += BATCH_SIZE) {
      const batch = allPoints.slice(i, i + BATCH_SIZE).map(p => ({
        id: p.id,
        vector: p.vector,
        payload: { ...p.payload, space_id: p.payload?.space_id ?? SQUADRULES_APP_SPACE_ID }
      }));
      try {
        await client.upsert(collectionName, { points: batch } as any);
        restored += batch.length;
        logger.info(`removeVectorFromCollection: upserted ${batch.length} restored points into ${collectionName} (restored=${restored})`);
      } catch (upErr) {
        logger.error(`removeVectorFromCollection: upsert failed during recreation: ${String(upErr)}`);
      }
    }

    logger.info(`removeVectorFromCollection: Completed removal of ${vectorName} on ${collectionName} - restored points=${restored}`);
  } catch (err) {
    logger.error(`removeVectorFromCollection: removal failed for ${vectorName} on ${collectionName}: ${String(err)}`);
  }
}