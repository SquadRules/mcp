import crypto from 'node:crypto';
import type { Memory } from '../../types/memory.js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { logger } from '../../utils/structured-logger.js';
import { embeddingService } from '../embedding/service.js';
import { getEmbeddingDimension } from '../embedding/config.js';
import { bm25Tokenizer } from '../embedding/bm25-tokenizer.js';
import { IDGenerator } from '../id-generator.js';
import { generateLabel, generateTags } from '../../utils/memory-store-utils.js';
import { modelStats } from '../stats/model-stats.js';
import { redisCacheService } from '../redis-cache.js';
import { memoryStore, memoryAdapterSize } from '../metrics/memory-metrics.js';
import { getTenantId, getSpaceContext } from '../../utils/tenant-context.js';
import {
  getActivationPatternVectorName,
  getAdapterTitleVectorName,
  getPrimaryVectorName
} from '../../utils/qdrant-vector-types.js';
import type { ParsedFrontmatter } from '../../utils/frontmatter.js';
import {
  allocateAdapterSlugForMint,
  deriveDomainTaskType,
  handleDuplicateAdapter
} from './store-adapter-helpers.js';
import { resolveProtocolSlugCandidate } from '../../utils/protocol-slug.js';
import { SquadrulesError } from '../../types/index.js';
import type { CodeBlockProcessor } from '../code-block-processor.js';
import type { MemoryQdrantStoreMethods } from './store-methods.js';
import { buildActivationSearchFieldsForMemory } from './activation-search-fields.js';

/**
 * Handles default adapter storage (one memory per document).
 */
export async function storeDefaultAdapter(
  client: QdrantClient,
  collection: string,
  methods: MemoryQdrantStoreMethods,
  codeBlockProcessor: CodeBlockProcessor,
  normalizedDocs: string[],
  llmModelId: string,
  now: Date,
  forceUpdate: boolean,
  protocolVersion?: string,
  parsedFrontmatter?: ParsedFrontmatter,
  forkNewAdapter = false
): Promise<Memory[]> {
  const tenantId = getTenantId();

  const uuids = normalizedDocs.map(() => crypto.randomUUID());
  const processedDocs = normalizedDocs.map(text => {
    const codeResult = codeBlockProcessor.processMarkdown(text);
    const enhancedText = codeBlockProcessor.enhanceContentForSearch(text, codeResult);
    return { original: text, enhanced: enhancedText, codeResult };
  });

  if (processedDocs.length === 0) {
    return [];
  }

  const firstGeneratedLabel = generateLabel(processedDocs[0]!.original);
  const adapterUuid = forkNewAdapter ? crypto.randomUUID() : IDGenerator.generateAdapterUUIDv5(firstGeneratedLabel);

  await handleDuplicateAdapter(client, collection, adapterUuid, forceUpdate);

  const slugCand = resolveProtocolSlugCandidate(
    parsedFrontmatter?.slugRaw !== undefined ? { slugRaw: parsedFrontmatter.slugRaw } : {},
    firstGeneratedLabel
  );
  if ('error' in slugCand) {
    throw new SquadrulesError(slugCand.message, 'INVALID_SLUG', 400, { message: slugCand.message });
  }
  const protocolSlug = await allocateAdapterSlugForMint(
    client,
    collection,
    { slug: slugCand.slug, authorSupplied: slugCand.authorSupplied },
    adapterUuid
  );

  const vectorSize = getEmbeddingDimension();
  const primaryVectorName = getPrimaryVectorName(vectorSize);
  const titleVectorName = getAdapterTitleVectorName(vectorSize);
  const activationPatternVectorName = getActivationPatternVectorName(vectorSize);
  const memories: Memory[] = processedDocs.map((processed, index) => {
    const memory_uuid = uuids[index]!;
    const baseTags = generateTags(processed.original);
    const codeTags = processed.codeResult.allIdentifiers.slice(0, 5);
    const allTags = [...baseTags, ...codeTags];

    const layerLabel = generateLabel(processed.original);
    const adapter: NonNullable<Memory['adapter']> = {
      id: adapterUuid,
      name: firstGeneratedLabel,
      layer_index: index + 1,
      layer_count: normalizedDocs.length
    };
    if (protocolVersion) adapter.protocol_version = protocolVersion;
    return {
      memory_uuid,
      label: layerLabel,
      tags: allTags,
      text: processed.enhanced,
      llm_model_id: llmModelId,
      created_at: now.toISOString(),
      adapter
    };
  });

  const activationFields = memories.map((memory) => buildActivationSearchFieldsForMemory(memory));
  let primaryEmbeddings: number[][];
  let titleEmbeddings: number[][];
  let activationPatternEmbeddings: number[][];
  try {
    const textsToEmbed = activationFields.flatMap((fields) => [
      fields.primaryDenseText,
      fields.titleDenseText,
      fields.activationPatternDenseText
    ]);
    const embeddingBatch = await embeddingService.generateBatchEmbeddings(textsToEmbed);
    const embeddingCount = embeddingBatch.embeddings.length;
    const wrongCount = embeddingCount !== memories.length * 3;
    const wrongDim = embeddingBatch.embeddings.some(
      (embedding) => !Array.isArray(embedding) || embedding.length !== vectorSize
    );
    if (wrongCount || wrongDim) {
      throw new Error(
        `embedding shape mismatch for activation vectors (count=${embeddingCount}/${memories.length * 3}, dim_ok=${!wrongDim})`
      );
    }
    primaryEmbeddings = activationFields.map((_, index) => embeddingBatch.embeddings[index * 3]!);
    titleEmbeddings = activationFields.map((_, index) => embeddingBatch.embeddings[index * 3 + 1]!);
    activationPatternEmbeddings = activationFields.map(
      (_, index) => embeddingBatch.embeddings[index * 3 + 2]!
    );
  } catch (err) {
    logger.warn(
      '[MemoryQdrantStore] Failed to generate activation-aware embeddings for default path; falling back to zero vectors: ' +
        (err instanceof Error ? err.message : String(err))
    );
    primaryEmbeddings = memories.map(() => Array(vectorSize).fill(0));
    titleEmbeddings = memories.map(() => Array(vectorSize).fill(0));
    activationPatternEmbeddings = memories.map(() => Array(vectorSize).fill(0));
  }

  const context = getSpaceContext();
  const spaceId = context.defaultWriteSpaceId;
  const actorId = context.userId || 'system';
  const points = memories.map((memory, index) => {
    const { task, type } = deriveDomainTaskType(memory.label, memory.text, memory.tags);
    const qualityMetadata = modelStats.calculateStepQualityMetadata(
      memory.label,
      'general',
      task,
      type,
      memory.tags
    );
    const fields = activationFields[index]!;
    const sparse = bm25Tokenizer.tokenize(fields.sparseText);
    const adapter = memory.adapter ?? {
      id: adapterUuid,
      name: firstGeneratedLabel,
      layer_index: index + 1,
      layer_count: normalizedDocs.length
    };
    const inferenceContract = memory.inference_contract;
    return ({
      id: memory.memory_uuid,
      vector: {
        [primaryVectorName]: primaryEmbeddings[index]!,
        [titleVectorName]: titleEmbeddings[index]!,
        [activationPatternVectorName]: activationPatternEmbeddings[index]!,
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
        slug: protocolSlug,
        adapter_name_text: fields.adapterNameText,
        label_text: fields.labelText,
        activation_patterns_text: fields.activationPatternsText,
        tags_text: fields.tagsText,
        inference_contract: inferenceContract,
        task,
        type,
        quality_metadata: {
          step_quality_score: qualityMetadata.step_quality_score,
          step_quality: qualityMetadata.step_quality
        },
        adapter: {
          id: adapter.id,
          name: adapter.name,
          layer_index: adapter.layer_index,
          layer_count: adapter.layer_count,
          ...(adapter.protocol_version && { protocol_version: adapter.protocol_version }),
          ...(adapter.activation_patterns && { activation_patterns: adapter.activation_patterns }),
          ...(typeof adapter.reward_signal === 'string' && { reward_signal: adapter.reward_signal })
        }
      }
    });
  });

  logger.tool(
    'memory-qdrant-store',
    'upsert',
    `mode=default docs=${normalizedDocs.length} collection=${collection} points=${points.length}`
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

  for (const memory of memories) {
    try {
      const ltags = (memory.tags || []).map(t => t.toLowerCase());
      const knownTasks = new Set(['networking', 'security', 'optimization', 'troubleshooting', 'error-handling', 'installation', 'configuration', 'testing', 'deployment', 'database']);
      const task = ltags.find(t => knownTasks.has(t)) || 'general';
      const type = /```/.test(memory.text) || ltags.includes('pattern') ? 'pattern' : (ltags.includes('rule') ? 'rule' : 'context');
      const score = modelStats.calculateQualityScore(memory.label, task, type, memory.tags);
      await modelStats.processContribution(memory.llm_model_id, score, memory.label);

      const quality = score.quality;
      memoryStore.inc({ quality, tenant_id: tenantId });

      if (memory.adapter) {
        memoryAdapterSize.observe({ tenant_id: tenantId }, memory.adapter.layer_count);
      }
    } catch { }
  }

  return memories;
}
