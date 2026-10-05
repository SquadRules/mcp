/**
 * Lance artifact write path.
 *
 * Mirrors `store-artifact.ts` exactly — chain-id normalization, artifact
 * metadata + sha256, duplicate detection by slug/name, created-at/by preservation
 * on force-update, and the zero-vector dense columns (artifacts carry no learned
 * embeddings) — but persists through the Lance engine and resolves adapter anchors
 * via `LanceWriteRepo`. Keeping the returned `Memory` shape identical means artifact
 * export/search behaves the same as on Qdrant.
 */
import crypto from 'node:crypto';
import type { Memory } from '../../../types/memory.js';
import { logger } from '../../../utils/structured-logger.js';
import { getEmbeddingDimension } from '../../embedding/config.js';
import { bm25Tokenizer } from '../../embedding/bm25-tokenizer.js';
import {
  getActivationPatternVectorName,
  getAdapterTitleVectorName,
  getPrimaryVectorName
} from '../../../utils/qdrant-vector-types.js';
import { getSpaceContext } from '../../../utils/tenant-context.js';
import { redisCacheService } from '../../redis-cache.js';
import { parseSquadrulesUri } from '../../../tools/squadrules-uri.js';
import { extractArtifactMetadata } from '../../memory/artifact-metadata.js';
import type { StoreArtifactOptions } from '../../memory/store-adapter.js';
import type { LanceRecordEngine } from './lance-records-engine.js';
import type { LanceWriteRepo } from './lance-records-write-helpers.js';
import type { QdrantPointLike } from './lance-records-schema.js';

export class LanceArtifactWriter {
  constructor(private readonly engine: LanceRecordEngine, private readonly repo: LanceWriteRepo) {}

  async storeArtifact(content: string, options: StoreArtifactOptions): Promise<Memory[]> {
    const parsed = parseSquadrulesUri(options.adapterUri);
    if (parsed.kind !== 'adapter') {
      throw new Error('adapterUri must be a squadrules://adapter/{slug|uuid} URI');
    }
    const { adapterId, adapterName } = await this.repo.resolveChainAdapterIdForArtifacts(parsed);
    const slugSourceInput =
      typeof options.relativePath === 'string' && options.relativePath.trim().length > 0 ? options.relativePath.trim() : options.name;
    const artifact = extractArtifactMetadata(content, slugSourceInput);
    const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    const vectorSize = getEmbeddingDimension();
    const zeroVector = Array.from({ length: vectorSize }, () => 0);
    const context = getSpaceContext();
    const spaceId = context.defaultWriteSpaceId;
    const actorId = context.userId || 'system';
    const now = new Date().toISOString();
    const normalizedArtifactName = options.name.trim().toLowerCase();

    const existingPoints = await this.repo.listExistingArtifactPoints(spaceId, adapterId);
    const matchingPoints = existingPoints.filter((point) => {
      const artifactPayload = (point.payload['artifact'] ?? {}) as Record<string, unknown>;
      const existingSlug = typeof artifactPayload['slug'] === 'string' ? artifactPayload['slug'].trim().toLowerCase() : '';
      const existingName = typeof artifactPayload['name'] === 'string' ? artifactPayload['name'].trim().toLowerCase() : '';
      if (artifact.slug_source === 'header') return existingSlug === artifact.slug.toLowerCase();
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

    const point: QdrantPointLike = {
      id: memoryUuid,
      vector: {
        [getPrimaryVectorName(vectorSize)]: zeroVector,
        [getAdapterTitleVectorName(vectorSize)]: zeroVector,
        [getActivationPatternVectorName(vectorSize)]: zeroVector,
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
          ...(typeof options.relativePath === 'string' && options.relativePath.trim().length > 0 ? { relative_path: options.relativePath.trim() } : {})
        },
        adapter: { id: adapterId, name: adapterName ?? options.name }
      }
    };

    await this.engine.putPoints([point]);
    logger.tool('lance-store', 'upsert', `artifact adapter=${adapterId} slug=${artifact.slug}`);
    await redisCacheService.invalidateAfterUpdate();

    return [
      {
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
          ...(typeof options.relativePath === 'string' && options.relativePath.trim().length > 0 ? { relative_path: options.relativePath.trim() } : {})
        },
        adapter: { id: adapterId, name: adapterName ?? options.name, layer_index: 0, layer_count: 0 }
      }
    ];
  }
}
