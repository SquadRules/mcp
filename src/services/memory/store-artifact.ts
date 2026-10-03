import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'node:crypto';
import { getEmbeddingDimension } from '../embedding/config.js';
import { bm25Tokenizer } from '../embedding/bm25-tokenizer.js';
import {
  getActivationPatternVectorName,
  getAdapterTitleVectorName,
  getPrimaryVectorName
} from '../../utils/qdrant-vector-types.js';
import { getSearchSpaceIds, getSpaceContext } from '../../utils/tenant-context.js';
import { buildSpaceFilter } from '../../utils/space-filter.js';
import { redisCacheService } from '../redis-cache.js';
import { logger } from '../../utils/structured-logger.js';
import { parseSquadrulesUri, type ParsedSquadrulesUri } from '../../tools/squadrules-uri.js';
import type { Memory } from '../../types/memory.js';
import type { StoreArtifactOptions } from './store-adapter.js';
import { extractArtifactMetadata } from './artifact-metadata.js';
import { ALLOWED_ARTIFACT_MIMES } from '../../tools/artifact-mime.js';

async function resolveAdapterAnchorPointId(
  client: QdrantClient,
  collectionName: string,
  slug: string
): Promise<string | null> {
  const normalized = (slug || '').trim().toLowerCase();
  if (!normalized) return null;
  const filter = buildSpaceFilter(getSearchSpaceIds(), {
    must: [
      { key: 'slug', match: { value: normalized } },
      { key: 'adapter.layer_index', match: { value: 1 } }
    ]
  });
  const ids: string[] = [];
  let offset: unknown = undefined;
  do {
    const page = await client.scroll(collectionName, {
      filter,
      limit: 64,
      offset,
      with_payload: false,
      with_vector: false
    } as any);
    const pts = page.points || [];
    for (const p of pts) {
      ids.push(String(p.id));
    }
    offset = page.next_page_offset;
  } while (offset);
  if (ids.length === 0) return null;
  ids.sort((a, b) => a.localeCompare(b));
  return ids[0] ?? null;
}

async function resolveAdapterNameByAdapterId(
  client: QdrantClient,
  collectionName: string,
  adapterId: string
): Promise<string | null> {
  const filter = buildSpaceFilter(getSearchSpaceIds(), {
    must: [
      { key: 'adapter.id', match: { value: adapterId } },
      { key: 'adapter.layer_index', match: { value: 1 } }
    ]
  });
  const page = await client.scroll(collectionName, {
    filter,
    limit: 1,
    with_payload: true,
    with_vector: false
  } as any);
  const payload = (page.points?.[0]?.payload ?? {}) as Record<string, unknown>;
  const adapter = payload['adapter'] as { name?: string } | undefined;
  if (typeof adapter?.name === 'string' && adapter.name.trim().length > 0) {
    return adapter.name.trim();
  }
  if (typeof payload['label'] === 'string' && payload['label'].trim().length > 0) {
    return payload['label'].trim();
  }
  return null;
}

interface ResolvedArtifactAdapterRef {
  adapterId: string;
  adapterName: string | null;
}

/**
 * Export and search index artifacts by `payload.adapter.id` (chain id). Train may pass a slug,
 * a layer point id, or a chain id in `squadrules://adapter/...`; normalize to the chain id.
 */
async function resolveChainAdapterIdForArtifacts(
  client: QdrantClient,
  collectionName: string,
  parsed: Extract<ParsedSquadrulesUri, { kind: 'adapter' }>
): Promise<ResolvedArtifactAdapterRef> {
  if (parsed.idKind === 'slug') {
    const headPointId = await resolveAdapterAnchorPointId(client, collectionName, parsed.id);
    if (!headPointId) {
      throw new Error(`Adapter slug "${parsed.id}" was not found for artifact attachment`);
    }
    const rows = await client.retrieve(collectionName, { ids: [headPointId], with_payload: true });
    const payload = (rows[0]?.payload ?? {}) as Record<string, unknown>;
    const adapter = payload['adapter'] as { id?: string; name?: string } | undefined;
    const adapterId = typeof adapter?.id === 'string' && adapter.id.length > 0 ? adapter.id : headPointId;
    const adapterName =
      typeof adapter?.name === 'string' && adapter.name.trim().length > 0
        ? adapter.name.trim()
        : await resolveAdapterNameByAdapterId(client, collectionName, adapterId);
    return { adapterId, adapterName };
  }
  const rows = await client.retrieve(collectionName, { ids: [parsed.id], with_payload: true });
  let adapterNameFromRow: string | null = null;
  if (Array.isArray(rows) && rows.length > 0) {
    const payload = (rows[0]?.payload ?? {}) as Record<string, unknown>;
    const adapter = payload['adapter'] as { id?: string; name?: string } | undefined;
    if (typeof adapter?.name === 'string' && adapter.name.trim().length > 0) {
      adapterNameFromRow = adapter.name.trim();
    }
    if (typeof adapter?.id === 'string' && adapter.id.length > 0) {
      const adapterName = adapterNameFromRow ?? await resolveAdapterNameByAdapterId(client, collectionName, adapter.id);
      return { adapterId: adapter.id, adapterName };
    }
  }
  const adapterName = adapterNameFromRow ?? await resolveAdapterNameByAdapterId(client, collectionName, parsed.id);
  return { adapterId: parsed.id, adapterName };
}

interface ExistingArtifactPoint {
  id: string;
  payload: Record<string, unknown>;
}

async function listExistingArtifactPoints(
  client: QdrantClient,
  collection: string,
  spaceId: string,
  adapterId: string
): Promise<ExistingArtifactPoint[]> {
  const filter = buildSpaceFilter(getSearchSpaceIds(), {
    must: [
      { key: 'space_id', match: { value: spaceId } },
      { key: 'adapter.id', match: { value: adapterId } },
      { key: 'content_type', match: { any: [...ALLOWED_ARTIFACT_MIMES] } }
    ]
  });
  const points: ExistingArtifactPoint[] = [];
  let offset: unknown = undefined;
  do {
    const page = await client.scroll(collection, {
      filter,
      limit: 128,
      offset,
      with_payload: true,
      with_vector: false
    } as any);
    const rows = Array.isArray(page.points) ? page.points : [];
    for (const row of rows) {
      points.push({
        id: String(row.id),
        payload: (row.payload ?? {}) as Record<string, unknown>
      });
    }
    offset = page.next_page_offset;
  } while (offset);
  return points;
}

export async function storeArtifact(
  client: QdrantClient,
  collection: string,
  content: string,
  options: StoreArtifactOptions
): Promise<Memory[]> {
  const parsed = parseSquadrulesUri(options.adapterUri);
  if (parsed.kind !== 'adapter') {
    throw new Error('adapterUri must be a squadrules://adapter/{slug|uuid} URI');
  }
  const { adapterId, adapterName } = await resolveChainAdapterIdForArtifacts(client, collection, parsed);
  const slugSourceInput =
    typeof options.relativePath === 'string' && options.relativePath.trim().length > 0
      ? options.relativePath.trim()
      : options.name;
  const artifact = extractArtifactMetadata(content, slugSourceInput);
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const vectorSize = getEmbeddingDimension();
  const zeroVector = Array.from({ length: vectorSize }, () => 0);
  const context = getSpaceContext();
  const spaceId = context.defaultWriteSpaceId;
  const actorId = context.userId || 'system';
  const now = new Date().toISOString();
  const normalizedArtifactName = options.name.trim().toLowerCase();
  const existingPoints = await listExistingArtifactPoints(client, collection, spaceId, adapterId);
  const matchingPoints = existingPoints.filter((point) => {
    const artifactPayload = (point.payload['artifact'] ?? {}) as Record<string, unknown>;
    const existingSlug =
      typeof artifactPayload['slug'] === 'string' ? artifactPayload['slug'].trim().toLowerCase() : '';
    const existingName =
      typeof artifactPayload['name'] === 'string' ? artifactPayload['name'].trim().toLowerCase() : '';
    if (artifact.slug_source === 'header') {
      return existingSlug === artifact.slug.toLowerCase();
    }
    return existingName === normalizedArtifactName || existingSlug === artifact.slug.toLowerCase();
  });
  matchingPoints.sort((a, b) => a.id.localeCompare(b.id));
  if (matchingPoints.length > 0 && !options.forceUpdate) {
    throw new Error(`Artifact "${options.name}" already exists on this adapter`);
  }
  const existingPoint = options.forceUpdate ? matchingPoints[0] : undefined;
  const existingCreatedAt =
    typeof existingPoint?.payload['created_at'] === 'string' && existingPoint.payload['created_at'].trim().length > 0
      ? existingPoint.payload['created_at'].trim()
      : now;
  const existingCreatedBy =
    typeof existingPoint?.payload['created_by'] === 'string' && existingPoint.payload['created_by'].trim().length > 0
      ? existingPoint.payload['created_by'].trim()
      : actorId;
  const memoryUuid = existingPoint?.id ?? crypto.randomUUID();
  const tags = ['artifact', options.mime.replace('text/', ''), `artifact:${artifact.slug}`];

  const sparseText = `${options.name}\n${artifact.slug}\n${content.slice(0, 4096)}`;
  const bm25 = bm25Tokenizer.tokenize(sparseText);
  const denseVectors = {
    [getPrimaryVectorName(vectorSize)]: zeroVector,
    [getAdapterTitleVectorName(vectorSize)]: zeroVector,
    [getActivationPatternVectorName(vectorSize)]: zeroVector
  };
  const point = {
    id: memoryUuid,
    vector: {
      ...denseVectors,
      bm25: { indices: bm25.indices, values: bm25.values }
    },
    payload: {
      space_id: spaceId,
      label: options.name,
      tags,
      text: content,
      llm_model_id: options.llmModelId,
      created_at: existingCreatedAt,
      created_by: existingCreatedBy,
      modified_at: now,
      modified_by: actorId,
      content_type: options.mime,
      artifact: {
        slug: artifact.slug,
        version: artifact.version,
        name: options.name,
        sha256,
        ...(typeof options.relativePath === 'string' && options.relativePath.trim().length > 0
          ? { relative_path: options.relativePath.trim() }
          : {})
      },
      adapter: {
        id: adapterId,
        name: adapterName ?? options.name
      }
    }
  };

  try {
    await client.upsert(collection, { points: [point] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Bad Request') || msg.includes('sparse') || msg.includes('vector')) {
      logger.warn(`[Qdrant][upsert][artifact] retrying without bm25: ${msg}`);
      await client.upsert(collection, {
        points: [{ ...point, vector: denseVectors }]
      } as Parameters<QdrantClient['upsert']>[1]);
    } else {
      throw err;
    }
  }
  await redisCacheService.invalidateAfterUpdate();

  return [{
    memory_uuid: memoryUuid,
    space_id: spaceId,
    label: options.name,
    tags,
    text: content,
    llm_model_id: options.llmModelId,
    created_at: now,
    content_type: options.mime,
    artifact: {
      slug: artifact.slug,
      version: artifact.version,
      name: options.name,
      sha256,
      ...(typeof options.relativePath === 'string' && options.relativePath.trim().length > 0
        ? { relative_path: options.relativePath.trim() }
        : {})
    },
    adapter: {
      id: adapterId,
      name: adapterName ?? options.name,
      layer_index: 0,
      layer_count: 0
    }
  }];
}
