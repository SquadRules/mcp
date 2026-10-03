import type { QdrantClient } from '@qdrant/js-client-rest';
import type { Memory } from '../../types/memory.js';
import { embeddingService } from '../embedding/service.js';
import { SQUADRULES_CREATION_PROTOCOL_SLUG, SQUADRULES_REFINING_PROTOCOL_SLUG, memoryIsBuiltinSearchFooterProtocol } from '../../constants/builtin-search-meta.js';
import { buildSpaceFilter } from '../../utils/space-filter.js';
import { getSearchSpaceIds } from '../../utils/tenant-context.js';
import { getAdapterTitleVectorName } from '../../utils/qdrant-vector-types.js';

export async function searchAdapterTitlesBySimilarity(params: {
  client: QdrantClient;
  collection: string;
  query: string;
  limit: number;
  mapPointToMemory: (point: { id: string; payload: Record<string, unknown> }) => Memory;
}): Promise<{ memories: Memory[]; scores: number[] }> {
  const queryKey = (params.query || '').trim();

  if (!queryKey) {
    return { memories: [], scores: [] };
  }

  const queryEmbeddingResult = await embeddingService.generateEmbedding(queryKey);
  const queryVector = queryEmbeddingResult.embedding;
  const titleVectorName = getAdapterTitleVectorName(queryVector.length);
  const searchSpaceIds = getSearchSpaceIds();
  const baseFilter = buildSpaceFilter(searchSpaceIds, {
    must: [{ key: 'adapter.layer_index', match: { value: 1 } }]
  });
  const filter = {
    ...baseFilter,
    must_not: [{ key: 'slug', match: { any: [SQUADRULES_REFINING_PROTOCOL_SLUG, SQUADRULES_CREATION_PROTOCOL_SLUG] } }]
  };
  const queryResponse = await params.client.query(params.collection, {
    query: queryVector,
    using: titleVectorName,
    limit: params.limit,
    filter,
    params: { quantization: { rescore: true } },
    with_payload: true,
    with_vector: false
  });
  const points = queryResponse?.points ?? [];

  const filtered = points
    .map((point: any) => {
      const memory = params.mapPointToMemory({ id: String(point.id), payload: point.payload || {} });
      const score = typeof point.score === 'number' ? point.score : 0;
      return { memory, score };
    })
    .filter(entry => entry.score > 0 && !memoryIsBuiltinSearchFooterProtocol(entry.memory))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.memory.memory_uuid ?? '').localeCompare(b.memory.memory_uuid ?? '');
    })
    .slice(0, params.limit);

  return {
    memories: filtered.map(entry => entry.memory),
    scores: filtered.map(entry => entry.score)
  };
}
