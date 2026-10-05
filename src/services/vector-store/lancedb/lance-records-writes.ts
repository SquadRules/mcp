/**
 * Lance adapter write path (train/store).
 *
 * Reuses the backend-neutral parsing and build helpers the Qdrant handlers use —
 * `normalizeMarkdownBlob`, `parseFrontmatter`, `buildHeaderMemoryAdapter`,
 * `generateLabel`/`generateTags`/`parseMarkdownStructure`, `deriveDomainTaskType`,
 * `modelStats`, `buildActivationSearchFieldsForMemory` and the batch embedding
 * call with zero-vector fallback — and only swaps the index primitives (dedup,
 * slug mint, similarity guard, upsert) for the Lance `LanceWriteRepo`. The point
 * payload shape is reproduced verbatim from the header/default handlers so a
 * Lance-trained adapter reads, searches and reward-propagates exactly like a
 * Qdrant one. The header (H1/H2) vs default branch mirrors `storeAdapter`.
 */
import crypto from 'node:crypto';
import type { Memory } from '../../../types/memory.js';
import { logger } from '../../../utils/structured-logger.js';
import { CodeBlockProcessor } from '../../code-block-processor.js';
import { embeddingService } from '../../embedding/service.js';
import { getEmbeddingDimension } from '../../embedding/config.js';
import { bm25Tokenizer } from '../../embedding/bm25-tokenizer.js';
import { IDGenerator } from '../../id-generator.js';
import { modelStats } from '../../stats/model-stats.js';
import { redisCacheService } from '../../redis-cache.js';
import { memoryStore, memoryAdapterSize } from '../../metrics/memory-metrics.js';
import { getTenantId, getSpaceContext } from '../../../utils/tenant-context.js';
import { normalizeMarkdownBlob, generateLabel, generateTags, parseMarkdownStructure } from '../../../utils/memory-store-utils.js';
import { parseFrontmatter, type ParsedFrontmatter } from '../../../utils/frontmatter.js';
import { resolveProtocolSlugCandidate } from '../../../utils/protocol-slug.js';
import { SquadrulesError } from '../../../types/index.js';
import { getActivationPatternVectorName, getAdapterTitleVectorName, getPrimaryVectorName } from '../../../utils/qdrant-vector-types.js';
import { buildHeaderMemoryAdapter } from '../../memory/adapter-builder.js';
import { buildActivationSearchFieldsForMemory } from '../../memory/activation-search-fields.js';
import type { StoreAdapterOptions, StoreArtifactOptions } from '../../memory/store-adapter.js';
import type { LanceRecordEngine } from './lance-records-engine.js';
import type { LanceRecordSearch } from './lance-records-search.js';
import { LanceWriteRepo } from './lance-records-write-helpers.js';
import type { QdrantPointLike } from './lance-records-schema.js';
import { LanceArtifactWriter } from './lance-records-write-artifact.js';

type ActivationVectors = { primary: number[][]; title: number[][]; activation: number[][] };

export class LanceRecordWriter {
  private readonly repo: LanceWriteRepo;
  private readonly codeBlockProcessor = new CodeBlockProcessor();
  private readonly artifactWriter: LanceArtifactWriter;

  constructor(
    private readonly engine: LanceRecordEngine,
    search: LanceRecordSearch
  ) {
    this.repo = new LanceWriteRepo(engine, search);
    this.artifactWriter = new LanceArtifactWriter(engine, this.repo);
  }

  storeArtifact(content: string, options: StoreArtifactOptions): Promise<Memory[]> {
    return this.artifactWriter.storeArtifact(content, options);
  }

  async storeAdapter(docs: string[], llmModelId: string, options: StoreAdapterOptions = {}): Promise<Memory[]> {
    if (!Array.isArray(docs) || docs.length === 0) return [];
    const normalizedDocs = docs.map(normalizeMarkdownBlob);
    const now = new Date();
    let docsForDefault = normalizedDocs;
    let effectiveProtocolVersion = options.protocolVersion;
    let parsedSingleDoc: ParsedFrontmatter | undefined;

    if (normalizedDocs.length === 1) {
      const markdownDoc = normalizedDocs[0]!;
      const parsed = parseFrontmatter(markdownDoc);
      parsedSingleDoc = parsed;
      const docForAdapter = parsed.body.length > 0 ? parsed.body : markdownDoc;
      effectiveProtocolVersion = options.protocolVersion ?? parsed.version;

      const headerMemories = buildHeaderMemoryAdapter(docForAdapter, llmModelId, now, this.codeBlockProcessor);
      if (headerMemories.length > 0) {
        if (effectiveProtocolVersion) {
          for (const m of headerMemories) if (m.adapter) m.adapter.protocol_version = effectiveProtocolVersion;
        }
        if (parsedSingleDoc?.chainRoot) {
          for (const m of headerMemories) if (m.adapter) m.adapter.chain_root = parsedSingleDoc.chainRoot!;
        }
        const adapterTitle = this.resolveAdapterTitle(headerMemories[0]);
        const slugCand = resolveProtocolSlugCandidate(
          parsedSingleDoc?.slugRaw !== undefined ? { slugRaw: parsedSingleDoc.slugRaw } : {},
          adapterTitle
        );
        if ('error' in slugCand) throw new SquadrulesError(slugCand.message, 'INVALID_SLUG', 400, { message: slugCand.message });
        const titleForSimilarity = (parsedSingleDoc?.title?.trim() || adapterTitle).slice(0, 120);
        await this.repo.checkSimilarAdapterByTitle(titleForSimilarity, options.forceUpdate || false);
        return this.storeHeaderBasedAdapter(
          headerMemories,
          llmModelId,
          options.forceUpdate || false,
          { slug: slugCand.slug, authorSupplied: slugCand.authorSupplied },
          !!options.forkNewAdapter
        );
      }
      docsForDefault = [docForAdapter];
    }

    const doc0 = docsForDefault[0]!;
    const struct0 = parseMarkdownStructure(doc0);
    const titleForSimilarity = (parsedSingleDoc?.title?.trim() || struct0.h1 || generateLabel(doc0)).slice(0, 120);
    await this.repo.checkSimilarAdapterByTitle(titleForSimilarity, options.forceUpdate || false);

    return this.storeDefaultAdapter(
      docsForDefault,
      llmModelId,
      now,
      options.forceUpdate || false,
      effectiveProtocolVersion,
      parsedSingleDoc,
      !!options.forkNewAdapter
    );
  }

  private resolveAdapterTitle(first: Memory | undefined): string {
    const firstLabel = first?.label || 'Knowledge Adapter';
    const explicit = first?.adapter?.name;
    if (explicit && explicit.trim().length > 0) return explicit.trim();
    return firstLabel.includes(':') ? firstLabel.split(':')[0]!.trim() : firstLabel.trim();
  }

  private async embedActivation(memories: Memory[]): Promise<ActivationVectors> {
    const vectorSize = getEmbeddingDimension();
    const activationFields = memories.map((m) => buildActivationSearchFieldsForMemory(m));
    const zeros = (): number[][] => memories.map(() => Array(vectorSize).fill(0));
    try {
      const batch = await embeddingService.generateBatchEmbeddings(
        activationFields.flatMap((f) => [f.primaryDenseText, f.titleDenseText, f.activationPatternDenseText])
      );
      const embeddings = batch.embeddings;
      const wrongCount = embeddings.length !== memories.length * 3;
      const wrongDim = embeddings.some((v) => !Array.isArray(v) || v.length !== vectorSize);
      if (wrongCount || wrongDim) {
        logger.warn(`[LanceStore] Embedding shape mismatch (count=${embeddings.length}/${memories.length * 3}); zero vectors`);
        return { primary: zeros(), title: zeros(), activation: zeros() };
      }
      return {
        primary: memories.map((_, i) => embeddings[i * 3]!),
        title: memories.map((_, i) => embeddings[i * 3 + 1]!),
        activation: memories.map((_, i) => embeddings[i * 3 + 2]!)
      };
    } catch (err) {
      logger.error('[LanceStore] Embedding generation failed; falling back to zero vectors', err);
      return { primary: zeros(), title: zeros(), activation: zeros() };
    }
  }

  private vectorNames(): { primary: string; title: string; activation: string } {
    const size = getEmbeddingDimension();
    return { primary: getPrimaryVectorName(size), title: getAdapterTitleVectorName(size), activation: getActivationPatternVectorName(size) };
  }

  private async storeHeaderBasedAdapter(
    memories: Memory[],
    llmModelId: string,
    forceUpdate: boolean,
    slugInput: { slug: string; authorSupplied: boolean },
    forkNewAdapter: boolean
  ): Promise<Memory[]> {
    const adapterTitle = this.resolveAdapterTitle(memories[0]);
    const adapterUuid = forkNewAdapter ? crypto.randomUUID() : IDGenerator.generateAdapterUUIDv5(adapterTitle);
    await this.repo.handleDuplicateAdapter(adapterUuid, forceUpdate);
    const protocolSlug = await this.repo.allocateAdapterSlugForMint(slugInput, adapterUuid);

    const names = this.vectorNames();
    const vectors = await this.embedActivation(memories);
    const activationFields = memories.map((m) => buildActivationSearchFieldsForMemory(m));
    const context = getSpaceContext();
    const spaceId = context.defaultWriteSpaceId;
    const actorId = context.userId || 'system';
    const layerCount = memories.length;

    const points: QdrantPointLike[] = memories.map((memory, i) => {
      const dtt = this.repo.deriveDomainTaskType(memory.label, memory.text, memory.tags || []);
      const qualityMetadata = modelStats.calculateStepQualityMetadata(memory.label, 'general', dtt.task, dtt.type, memory.tags);
      const fields = activationFields[i]!;
      const sparse = bm25Tokenizer.tokenize(fields.sparseText);
      const adapter = memory.adapter ?? { id: adapterUuid, name: adapterTitle, layer_index: i + 1, layer_count: layerCount };
      return {
        id: memory.memory_uuid!,
        vector: {
          [names.primary]: vectors.primary[i]!,
          [names.title]: vectors.title[i]!,
          [names.activation]: vectors.activation[i]!,
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
          inference_contract: memory.inference_contract,
          task: dtt.task,
          type: dtt.type,
          quality_metadata: { step_quality_score: qualityMetadata.step_quality_score, step_quality: qualityMetadata.step_quality },
          adapter: {
            id: adapterUuid,
            name: adapterTitle,
            layer_index: i + 1,
            layer_count: layerCount,
            ...(adapter.protocol_version && { protocol_version: adapter.protocol_version }),
            ...(adapter.activation_patterns && { activation_patterns: adapter.activation_patterns }),
            ...(typeof adapter.reward_signal === 'string' && { reward_signal: adapter.reward_signal }),
            ...(typeof adapter.chain_root === 'string' && adapter.chain_root.length > 0 && { chain_root: adapter.chain_root })
          },
          slug: protocolSlug
        }
      };
    });

    await this.enginePut(points);
    await this.recordContributions(memories);
    return memories;
  }

  private async storeDefaultAdapter(
    normalizedDocs: string[],
    llmModelId: string,
    now: Date,
    forceUpdate: boolean,
    protocolVersion: string | undefined,
    parsedFrontmatter: ParsedFrontmatter | undefined,
    forkNewAdapter: boolean
  ): Promise<Memory[]> {
    const uuids = normalizedDocs.map(() => crypto.randomUUID());
    const processedDocs = normalizedDocs.map((text) => {
      const codeResult = this.codeBlockProcessor.processMarkdown(text);
      const enhanced = this.codeBlockProcessor.enhanceContentForSearch(text, codeResult);
      return { original: text, enhanced, codeResult };
    });
    if (processedDocs.length === 0) return [];

    const firstGeneratedLabel = generateLabel(processedDocs[0]!.original);
    const adapterUuid = forkNewAdapter ? crypto.randomUUID() : IDGenerator.generateAdapterUUIDv5(firstGeneratedLabel);
    await this.repo.handleDuplicateAdapter(adapterUuid, forceUpdate);

    const slugCand = resolveProtocolSlugCandidate(
      parsedFrontmatter?.slugRaw !== undefined ? { slugRaw: parsedFrontmatter.slugRaw } : {},
      firstGeneratedLabel
    );
    if ('error' in slugCand) throw new SquadrulesError(slugCand.message, 'INVALID_SLUG', 400, { message: slugCand.message });
    const protocolSlug = await this.repo.allocateAdapterSlugForMint({ slug: slugCand.slug, authorSupplied: slugCand.authorSupplied }, adapterUuid);

    const memories: Memory[] = processedDocs.map((processed, index) => {
      const allTags = [...generateTags(processed.original), ...processed.codeResult.allIdentifiers.slice(0, 5)];
      const adapter: NonNullable<Memory['adapter']> = { id: adapterUuid, name: firstGeneratedLabel, layer_index: index + 1, layer_count: normalizedDocs.length };
      if (protocolVersion) adapter.protocol_version = protocolVersion;
      return {
        memory_uuid: uuids[index]!,
        label: generateLabel(processed.original),
        tags: allTags,
        text: processed.enhanced,
        llm_model_id: llmModelId,
        created_at: now.toISOString(),
        adapter
      };
    });

    const names = this.vectorNames();
    const vectors = await this.embedActivation(memories);
    const activationFields = memories.map((m) => buildActivationSearchFieldsForMemory(m));
    const context = getSpaceContext();
    const spaceId = context.defaultWriteSpaceId;
    const actorId = context.userId || 'system';

    const points: QdrantPointLike[] = memories.map((memory, index) => {
      const { task, type } = this.repo.deriveDomainTaskType(memory.label, memory.text, memory.tags || []);
      const qualityMetadata = modelStats.calculateStepQualityMetadata(memory.label, 'general', task, type, memory.tags);
      const fields = activationFields[index]!;
      const sparse = bm25Tokenizer.tokenize(fields.sparseText);
      const adapter = memory.adapter ?? { id: adapterUuid, name: firstGeneratedLabel, layer_index: index + 1, layer_count: normalizedDocs.length };
      return {
        id: memory.memory_uuid!,
        vector: {
          [names.primary]: vectors.primary[index]!,
          [names.title]: vectors.title[index]!,
          [names.activation]: vectors.activation[index]!,
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
          inference_contract: memory.inference_contract,
          task,
          type,
          quality_metadata: { step_quality_score: qualityMetadata.step_quality_score, step_quality: qualityMetadata.step_quality },
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
      };
    });

    await this.enginePut(points);
    await this.recordContributions(memories);
    return memories;
  }

  private async enginePut(points: QdrantPointLike[]): Promise<void> {
    const count = await this.engine.putPoints(points);
    logger.tool('lance-store', 'upsert', `points=${count}`);
    await redisCacheService.invalidateAfterUpdate();
  }

  private async recordContributions(memories: Memory[]): Promise<void> {
    const tenantId = getTenantId();
    for (const memory of memories) {
      try {
        const { task, type } = this.repo.deriveDomainTaskType(memory.label, memory.text, memory.tags || []);
        const score = modelStats.calculateQualityScore(memory.label, task, type, memory.tags);
        await modelStats.processContribution(memory.llm_model_id, score, memory.label);
        memoryStore.inc({ quality: score.quality, tenant_id: tenantId });
        if (memory.adapter) memoryAdapterSize.observe({ tenant_id: tenantId }, memory.adapter.layer_count);
      } catch {
        /* metrics are best-effort */
      }
    }
  }
}
