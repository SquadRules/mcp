// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Memory } from '../../types/memory.js';
import { logger } from '../../utils/structured-logger.js';
import { KAIROS_APP_SPACE_ID } from '../../config.js';
import { getSpaceContext, getSearchSpaceIds } from '../../utils/tenant-context.js';
import { buildSpaceFilter } from '../../utils/space-filter.js';
import { CodeBlockProcessor } from '../code-block-processor.js';
import { redisCacheService } from '../redis-cache.js';
import { embeddingService } from '../embedding/service.js';
import { bm25Tokenizer } from '../embedding/bm25-tokenizer.js';
import { buildHeaderMemoryAdapter as buildAdapter } from './adapter-builder.js';
import {
  KAIROS_CREATION_PROTOCOL_SLUG,
  KAIROS_REFINING_PROTOCOL_SLUG,
  memoryIsBuiltinSearchFooterProtocol
} from '../../constants/builtin-search-meta.js';
import { pointToMemory as mapQdrantPointToMemory } from './qdrant-point-to-memory.js';
import { searchAdapterTitlesBySimilarity as searchAdapterTitlesBySimilarityImpl } from './store-title-similarity-search.js';
import {
  getActivationPatternVectorName,
  getAdapterTitleVectorName,
  getPrimaryVectorName
} from '../../utils/qdrant-vector-types.js';

export class MemoryQdrantStoreMethods {
  private client: QdrantClient;
  private collection: string;
  private url: string;
  private codeBlockProcessor: CodeBlockProcessor;

  constructor(client: QdrantClient, collection: string, url: string, codeBlockProcessor: CodeBlockProcessor) {
    this.client = client;
    this.collection = collection;
    this.url = url;
    this.codeBlockProcessor = codeBlockProcessor;
  }

  async getMemory(memory_uuid: string): Promise<Memory | null> {
    if (!memory_uuid) return null;

    // Check shared cache first (Redis when configured, in-memory otherwise)
    const cached = await redisCacheService.getMemoryResource(memory_uuid);
    if (cached) return cached;

    const retrieveReq = {
      ids: [memory_uuid],
      with_payload: true,
      with_vector: false
    } as any;
    logger.debug(`[Qdrant][retrieve] collection=${this.collection} req=${JSON.stringify(retrieveReq)}`);
    const points = await this.client.retrieve(this.collection, {
      ids: [memory_uuid],
      with_payload: true,
      with_vector: false
    });
    logger.debug(`[Qdrant][retrieve] result_count=${points?.length || 0}`);

    if (!points || points.length === 0) {
      return null;
    }
    const point = points[0]!;
    const pointSpaceId = (point.payload as any)?.space_id ?? KAIROS_APP_SPACE_ID;
    const allowed = getSpaceContext().allowedSpaceIds;
    const canRead = allowed.includes(pointSpaceId) || pointSpaceId === KAIROS_APP_SPACE_ID;
    if (!canRead) {
      return null;
    }

    const memory = this.pointToMemory(point);
    // Populate shared cache for subsequent reads
    await redisCacheService.setMemoryResource(memory);
    return memory;
  }

  // Fetch bypassing in-process cache to ensure freshest view (e.g., after updates)
  async getMemoryFresh(memory_uuid: string): Promise<Memory | null> {
    if (!memory_uuid) return null;
    const points = await this.client.retrieve(this.collection, {
      ids: [memory_uuid],
      with_payload: true,
      with_vector: false
    });
    if (!points || points.length === 0) return null;
    const point = points[0]!;
    const pointSpaceId = (point.payload as any)?.space_id ?? KAIROS_APP_SPACE_ID;
    const allowed = getSpaceContext().allowedSpaceIds;
    const canRead = allowed.includes(pointSpaceId) || pointSpaceId === KAIROS_APP_SPACE_ID;
    if (!canRead) {
      return null;
    }
    return this.pointToMemory(point);
  }

  async searchMemories(query: string, limit: number, collapse: boolean = true): Promise<{ memories: Memory[], scores: number[] }> {
    const queryKey = (query || '').trim();

    if (!queryKey) {
      return { memories: [], scores: [] };
    }

    const vectorResult = await this.vectorSearch(queryKey, limit);
    await redisCacheService.setSearchResult(queryKey, limit, vectorResult, { collapse });
    return vectorResult;
  }

  async searchAdapterTitlesBySimilarity(query: string, limit: number): Promise<{ memories: Memory[], scores: number[] }> {
    return searchAdapterTitlesBySimilarityImpl({
      client: this.client,
      collection: this.collection,
      query,
      limit,
      mapPointToMemory: (point) => this.pointToMemory(point)
    });
  }

  /**
   * Hybrid search: dense + activation-focused dense legs + BM25 via Query API.
   * All ranking stays in Qdrant so the tool surface sees the same scores the
   * index produced.
   */
  private async vectorSearch(query: string, limit: number): Promise<{ memories: Memory[], scores: number[] }> {
    const queryEmbeddingResult = await embeddingService.generateEmbedding(query);
    const queryVector = queryEmbeddingResult.embedding;
    const primaryVectorName = getPrimaryVectorName(queryVector.length);
    const titleVectorName = getAdapterTitleVectorName(queryVector.length);
    const activationPatternVectorName = getActivationPatternVectorName(queryVector.length);
    const searchLimit = Math.min(limit * 3, 200);
    const sparseQuery = bm25Tokenizer.tokenize(query);

    const searchSpaceIds = getSearchSpaceIds();
    const baseFilter = buildSpaceFilter(searchSpaceIds, {
      must: [{ key: 'adapter.layer_index', match: { value: 1 } }]
    });
    const filter = {
      ...baseFilter,
      must_not: [{ key: 'slug', match: { any: [KAIROS_REFINING_PROTOCOL_SLUG, KAIROS_CREATION_PROTOCOL_SLUG] } }]
    };

    const bm25Leg = {
      query: { indices: sparseQuery.indices, values: sparseQuery.values },
      using: 'bm25' as const,
      filter
    };

    let points: Array<{ id: string | number; score?: number; payload?: Record<string, unknown> | null }>;
    try {
      const TITLE_MATCH_BOOST = 0.45;
      const ACTIVATION_PATTERN_MATCH_BOOST = 0.35;
      const LABEL_MATCH_BOOST = 0.15;
      const TAG_MATCH_BOOST = 0.05;
      const queryResponse = await this.client.query(this.collection, {
        prefetch: {
          prefetch: [
            {
              query: queryVector,
              using: primaryVectorName,
              limit: 60,
              filter,
              params: { quantization: { rescore: true } }
            },
            {
              query: queryVector,
              using: titleVectorName,
              limit: 40,
              filter,
              params: { quantization: { rescore: true } }
            },
            {
              query: queryVector,
              using: activationPatternVectorName,
              limit: 40,
              filter,
              params: { quantization: { rescore: true } }
            },
            { ...bm25Leg, limit: 60 },
            { ...bm25Leg, limit: 30 }
          ],
          query: { fusion: 'rrf' },
          limit: 80,
        },
        query: {
          formula: {
            sum: [
              '$score',
              {
                mult: [
                  TITLE_MATCH_BOOST,
                  { key: 'adapter_name_text', match: { text: query } }
                ]
              },
              {
                mult: [
                  ACTIVATION_PATTERN_MATCH_BOOST,
                  { key: 'activation_patterns_text', match: { text: query } }
                ]
              },
              {
                mult: [
                  LABEL_MATCH_BOOST,
                  { key: 'label_text', match: { text: query } }
                ]
              },
              {
                mult: [
                  TAG_MATCH_BOOST,
                  { key: 'tags_text', match: { text: query } }
                ]
              },
              'attest_boost'
            ]
          },
          defaults: { attest_boost: 0 }
        },
        with_payload: true,
        limit: searchLimit
      });
      points = queryResponse?.points ?? [];
    } catch (queryErr) {
      logger.warn(
        `Hybrid query failed, falling back to dense search: ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`
      );
      const fallbackResponse = await this.client.query(this.collection, {
        query: queryVector,
        using: primaryVectorName,
        limit: searchLimit,
        filter,
        params: { quantization: { rescore: true } },
        with_payload: true,
        with_vector: false
      });
      points = fallbackResponse?.points ?? [];
    }
    type SearchHit = { id: string | number; score?: number; payload?: Record<string, unknown> | null };
    const scored = points.map((r: SearchHit) => {
      const payload = r.payload || {};
      const memory = this.pointToMemory({ id: String(r.id), payload });
      const score = typeof r.score === 'number' ? r.score : 0.5;
      return { memory, score };
    });

    let filtered = scored
      .filter(entry => entry.score > 0 && !memoryIsBuiltinSearchFooterProtocol(entry.memory))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.memory.memory_uuid ?? '').localeCompare(b.memory.memory_uuid ?? '');
      })
      .slice(0, limit);

    if (filtered.length === 0 && scored.length > 0) {
      filtered = scored
        .filter(entry => !memoryIsBuiltinSearchFooterProtocol(entry.memory))
        .slice(0, limit)
        .map(entry => ({ memory: entry.memory, score: 0.5 }));
    }

    return {
      memories: filtered.map(entry => entry.memory),
      scores: filtered.map(entry => entry.score)
    };
  }

  private pointToMemory(point: any): Memory {
    return mapQdrantPointToMemory(point);
  }

  buildHeaderMemoryAdapter(markdownDoc: string, llmModelId: string, now: Date): Memory[] {
    return buildAdapter(markdownDoc, llmModelId, now, this.codeBlockProcessor);
  }
}
