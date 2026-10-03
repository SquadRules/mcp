import { QdrantClient } from '@qdrant/js-client-rest';
import type { Memory } from '../../types/memory.js';
import { logger } from '../../utils/structured-logger.js';
import { CodeBlockProcessor } from '../code-block-processor.js';
import { MemoryQdrantStoreMethods } from './store-methods.js';
import { memoryStoreDuration } from '../metrics/memory-metrics.js';
import { getTenantId } from '../../utils/tenant-context.js';
import { normalizeMarkdownBlob, generateLabel, parseMarkdownStructure } from '../../utils/memory-store-utils.js';
import type { ParsedFrontmatter } from '../../utils/frontmatter.js';
import { parseFrontmatter } from '../../utils/frontmatter.js';
import { resolveProtocolSlugCandidate } from '../../utils/protocol-slug.js';
import { SquadrulesError } from '../../types/index.js';
import { storeHeaderBasedAdapter } from './store-adapter-header-handler.js';
import { storeDefaultAdapter } from './store-adapter-default-handler.js';
import { checkSimilarAdapterByTitle } from './store-adapter-helpers.js';
import { storeArtifact as storeArtifactPoint } from './store-artifact.js';

export interface StoreAdapterOptions {
  forceUpdate?: boolean;
  protocolVersion?: string;
  /** When true (train fork from `source_adapter_uri`), allocate a new adapter id instead of title-derived v5. */
  forkNewAdapter?: boolean;
}

export interface StoreArtifactOptions {
  mime: string;
  name: string;
  adapterUri: string;
  llmModelId: string;
  forceUpdate?: boolean;
  /** Skill-root-relative path (normalized); used for slug uniqueness and skill export layout. */
  relativePath?: string;
}

export class MemoryQdrantStoreAdapter {
  constructor(
    private client: QdrantClient,
    private collection: string,
    private codeBlockProcessor: CodeBlockProcessor,
    private methods: MemoryQdrantStoreMethods
  ) {}

  async storeAdapter(docs: string[], llmModelId: string, options: StoreAdapterOptions = {}): Promise<Memory[]> {
    const tenantId = getTenantId();
    const timer = memoryStoreDuration.startTimer({ tenant_id: tenantId });

    try {
      if (!Array.isArray(docs) || docs.length === 0) {
        return [];
      }

      const normalizedDocs = docs.map(normalizeMarkdownBlob);
      logger.debug(
        `[MemoryQdrantStore] storeAdapter normalizedDocs lengths=${normalizedDocs.map(d => d?.length ?? 0).join(',')}`
      );

      const now = new Date();
      let docsForDefaultPath = normalizedDocs;
      let effectiveProtocolVersion: string | undefined = options.protocolVersion;
      let parsedSingleDoc: ParsedFrontmatter | undefined;

      if (normalizedDocs.length === 1) {
        const markdownDoc = normalizedDocs[0]!;
        const parsed = parseFrontmatter(markdownDoc);
        parsedSingleDoc = parsed;
        const docForAdapter = parsed.body.length > 0 ? parsed.body : markdownDoc;
        effectiveProtocolVersion = options.protocolVersion ?? parsed.version;

        const headerAdapterMemories = this.methods.buildHeaderMemoryAdapter(docForAdapter, llmModelId, now);

        if (headerAdapterMemories.length > 0) {
          if (effectiveProtocolVersion) {
            for (const memory of headerAdapterMemories) {
              if (memory.adapter) memory.adapter.protocol_version = effectiveProtocolVersion;
            }
          }
          if (parsedSingleDoc?.chainRoot) {
            for (const memory of headerAdapterMemories) {
              if (memory.adapter) memory.adapter.chain_root = parsedSingleDoc.chainRoot;
            }
          }
          const firstLabel = headerAdapterMemories[0]?.label || 'Knowledge Adapter';
          const explicitAdapterTitle = headerAdapterMemories[0]?.adapter?.name;
          const adapterTitle =
            explicitAdapterTitle && explicitAdapterTitle.trim().length > 0
              ? explicitAdapterTitle.trim()
              : firstLabel.includes(':')
                ? firstLabel.split(':')[0]!.trim()
                : firstLabel.trim();
          const slugCand = resolveProtocolSlugCandidate(
            parsedSingleDoc?.slugRaw !== undefined ? { slugRaw: parsedSingleDoc.slugRaw } : {},
            adapterTitle
          );
          if ('error' in slugCand) {
            throw new SquadrulesError(slugCand.message, 'INVALID_SLUG', 400, { message: slugCand.message });
          }

          const adapterTitleForSimilarity = (
            parsedSingleDoc?.title?.trim() || adapterTitle
          ).slice(0, 120);
          await checkSimilarAdapterByTitle(
            this.methods,
            adapterTitleForSimilarity,
            options.forceUpdate || false
          );
          return await storeHeaderBasedAdapter(
            this.client,
            this.collection,
            this.methods,
            headerAdapterMemories,
            llmModelId,
            options.forceUpdate || false,
            { slug: slugCand.slug, authorSupplied: slugCand.authorSupplied },
            !!options.forkNewAdapter
          );
        }
        docsForDefaultPath = [docForAdapter];
        logger.debug('[MemoryQdrantStore] Header-based adapter parsing failed, falling back to single memory storage');
      }

      const doc0 = docsForDefaultPath[0]!;
      const struct0 = parseMarkdownStructure(doc0);
      const adapterTitleForSimilarity = (
        parsedSingleDoc?.title?.trim() || struct0.h1 || generateLabel(doc0)
      ).slice(0, 120);
      await checkSimilarAdapterByTitle(
        this.methods,
        adapterTitleForSimilarity,
        options.forceUpdate || false
      );

      return await storeDefaultAdapter(
        this.client,
        this.collection,
        this.methods,
        this.codeBlockProcessor,
        docsForDefaultPath,
        llmModelId,
        now,
        options.forceUpdate || false,
        effectiveProtocolVersion,
        parsedSingleDoc,
        !!options.forkNewAdapter
      );
    } finally {
      timer({ tenant_id: tenantId });
    }
  }

  async storeArtifact(content: string, options: StoreArtifactOptions): Promise<Memory[]> {
    return storeArtifactPoint(this.client, this.collection, content, options);
  }
}
