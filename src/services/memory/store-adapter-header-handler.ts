import type { Memory } from '../../types/memory.js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { logger } from '../../utils/structured-logger.js';
import { embeddingService } from '../embedding/service.js';
import { getEmbeddingDimension } from '../embedding/config.js';
import { bm25Tokenizer } from '../embedding/bm25-tokenizer.js';
import crypto from 'node:crypto';
import { IDGenerator } from '../id-generator.js';
import { modelStats } from '../stats/model-stats.js';
import { redisCacheService } from '../redis-cache.js';
import { memoryStore, memoryAdapterSize } from '../metrics/memory-metrics.js';
import { getTenantId, getSpaceContext } from '../../utils/tenant-context.js';
import {
  getActivationPatternVectorName,
  getAdapterTitleVectorName,
  getPrimaryVectorName
} from '../../utils/qdrant-vector-types.js';
import {
  allocateAdapterSlugForMint,
  deriveDomainTaskType,
  handleDuplicateAdapter,
  type AdapterSlugMintInput
} from './store-adapter-helpers.js';
import type { MemoryQdrantStoreMethods } from './store-methods.js';
import { buildActivationSearchFieldsForMemory } from './activation-search-fields.js';

/**
 * Handles header-based adapter storage (H1/H2 sections).
 */
export async function storeHeaderBasedAdapter(
  client: QdrantClient,
  collection: string,
  methods: MemoryQdrantStoreMethods,
  headerAdapterMemories: Memory[],
  llmModelId: string,
  forceUpdate: boolean,
  slugInput: AdapterSlugMintInput,
  forkNewAdapter = false
): Promise<Memory[]> {
  const tenantId = getTenantId();

  const firstLabel = headerAdapterMemories[0]?.label || 'Knowledge Adapter';
  const explicitAdapterTitle = headerAdapterMemories[0]?.adapter?.name;
  const adapterTitle = (explicitAdapterTitle && explicitAdapterTitle.trim().length > 0)
    ? explicitAdapterTitle.trim()
    : (firstLabel.includes(':') ? firstLabel.split(':')[0]!.trim() : firstLabel.trim());
  const adapterUuid = forkNewAdapter ? crypto.randomUUID() : IDGenerator.generateAdapterUUIDv5(adapterTitle);

  await handleDuplicateAdapter(client, collection, adapterUuid, forceUpdate);

  const protocolSlug = await allocateAdapterSlugForMint(client, collection, slugInput, adapterUuid);

  const vectorSize = getEmbeddingDimension();
  const primaryVectorName = getPrimaryVectorName(vectorSize);
  const titleVectorName = getAdapterTitleVectorName(vectorSize);
  const activationPatternVectorName = getActivationPatternVectorName(vectorSize);
  const activationFields = headerAdapterMemories.map((memory) => buildActivationSearchFieldsForMemory(memory));
  let primaryVectors: number[][];
  let titleVectors: number[][];
  let activationPatternVectors: number[][];
  try {
    const batch = await embeddingService.generateBatchEmbeddings(
      activationFields.flatMap((fields) => [
        fields.primaryDenseText,
        fields.titleDenseText,
        fields.activationPatternDenseText
      ])
    );
    const embeddings = batch.embeddings;
    const wrongCount = embeddings.length !== headerAdapterMemories.length * 3;
    const wrongDim = embeddings.some(v => !Array.isArray(v) || v.length !== vectorSize);
    if (wrongCount || wrongDim) {
      logger.warn(
        `[MemoryQdrantStore] Embedding shape mismatch for header-based adapter (count=${embeddings.length}/${headerAdapterMemories.length * 3}, dimOK=${!wrongDim}). Falling back to zero vectors.`
      );
      primaryVectors = headerAdapterMemories.map(() => Array(vectorSize).fill(0));
      titleVectors = headerAdapterMemories.map(() => Array(vectorSize).fill(0));
      activationPatternVectors = headerAdapterMemories.map(() => Array(vectorSize).fill(0));
    } else {
      primaryVectors = headerAdapterMemories.map((_, index) => embeddings[index * 3]!);
      titleVectors = headerAdapterMemories.map((_, index) => embeddings[index * 3 + 1]!);
      activationPatternVectors = headerAdapterMemories.map((_, index) => embeddings[index * 3 + 2]!);
    }
  } catch (err) {
    logger.error('[MemoryQdrantStore] Failed to generate embeddings for header-based adapter; falling back to zero vectors', err);
    primaryVectors = headerAdapterMemories.map(() => Array(vectorSize).fill(0));
    titleVectors = headerAdapterMemories.map(() => Array(vectorSize).fill(0));
    activationPatternVectors = headerAdapterMemories.map(() => Array(vectorSize).fill(0));
  }

  const layerCount = headerAdapterMemories.length;
  const context = getSpaceContext();
  const spaceId = context.defaultWriteSpaceId;
  const actorId = context.userId || 'system';

  const points = headerAdapterMemories.map((memory, i) => {
    const dtt = deriveDomainTaskType(memory.label, memory.text, memory.tags);
    const qualityMetadata = modelStats.calculateStepQualityMetadata(
      memory.label,
      'general',
      dtt.task,
      dtt.type,
      memory.tags
    );
    const fields = activationFields[i]!;
    const sparse = bm25Tokenizer.tokenize(fields.sparseText);
    const adapter = memory.adapter ?? {
      id: adapterUuid,
      name: adapterTitle,
      layer_index: i + 1,
      layer_count: layerCount
    };
    const inferenceContract = memory.inference_contract;
    return ({
      id: memory.memory_uuid,
      vector: {
        [primaryVectorName]: primaryVectors[i]!,
        [titleVectorName]: titleVectors[i]!,
        [activationPatternVectorName]: activationPatternVectors[i]!,
        bm25: { indices: sparse.indices, values: sparse.values }
      },
      payload: {
        space_id: spaceId,
        label: memory.label,
        tags: memory.tags,
        text: memory.text,
        llm_model_id: memory.llm_model_id,
        created_at: memory.created_at,
        created_by: actorId,
        modified_at: memory.created_at,
        modified_by: actorId,
        adapter_name_text: fields.adapterNameText,
        label_text: fields.labelText,
        activation_patterns_text: fields.activationPatternsText,
        tags_text: fields.tagsText,
        inference_contract: inferenceContract,
        task: dtt.task,
        type: dtt.type,
        quality_metadata: {
          step_quality_score: qualityMetadata.step_quality_score,
          step_quality: qualityMetadata.step_quality
        },
        adapter: {
          id: adapterUuid,
          name: adapterTitle,
          layer_index: i + 1,
          layer_count: layerCount,
          ...(adapter.protocol_version && { protocol_version: adapter.protocol_version }),
          ...(adapter.activation_patterns && { activation_patterns: adapter.activation_patterns }),
          ...(typeof adapter.reward_signal === 'string' && { reward_signal: adapter.reward_signal }),
          ...(typeof adapter.chain_root === 'string' && adapter.chain_root.length > 0 && { chain_root: adapter.chain_root }),
          ...(adapter.frontmatter && { frontmatter: adapter.frontmatter })
        },
        slug: protocolSlug
      }
    });
  });

  logger.tool(
    'memory-qdrant-store',
    'upsert',
    `mode=h1-h2 sections=${headerAdapterMemories.length} collection=${collection} points=${points.length}`
  );
  logger.debug(
    `[Qdrant][upsert] collection=${collection} points=${points.length} payload=${JSON.stringify({ points })}`
  );
  try {
    await client.upsert(collection, { points });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Bad Request') || msg.includes('sparse') || msg.includes('vector')) {
      const pointsDenseOnly = points.map(p => ({
        ...p,
        vector: Object.fromEntries(
          Object.entries(p.vector as Record<string, unknown>).filter(([name]) => name !== 'bm25')
        )
      }));
      logger.warn(`[Qdrant][upsert] retrying without bm25 (collection may lack sparse config): ${msg}`);
      await client.upsert(collection, { points: pointsDenseOnly } as any);
    } else {
      throw err;
    }
  }

  await redisCacheService.invalidateAfterUpdate();

  for (const memory of headerAdapterMemories) {
    try {
      const { task, type } = deriveDomainTaskType(memory.label, memory.text, memory.tags);
      const score = modelStats.calculateQualityScore(memory.label, task, type, memory.tags);
      await modelStats.processContribution(memory.llm_model_id, score, memory.label);

      const quality = score.quality;
      memoryStore.inc({ quality, tenant_id: tenantId });

      if (memory.adapter) {
        memoryAdapterSize.observe({ tenant_id: tenantId }, memory.adapter.layer_count);
      }
    } catch { }
  }

  return headerAdapterMemories;
}
