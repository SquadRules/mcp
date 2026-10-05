/**
 * Lance read-side semantic search (JS cosine).
 *
 * LanceDB's `nearestTo` requires a FixedSizeList column, but a data-inferred
 * embedding column is a variable `List<Float64>`; rather than hand-author an
 * Arrow schema (the recorded pitfall) we scan the adapter heads in the allowed
 * spaces and score them in JS. The three stored dense vectors map onto the same
 * terms the Qdrant formula boosts (primary relevance + adapter-title match +
 * activation-pattern match), the scalar `label`/`tags` text matches and the
 * stored `attest_boost`, and the post-processing (drop built-in footers, sort by
 * score then uuid, slice, fall back to a flat score) mirrors `vectorSearch` so
 * activation/train search sees the same ordering contract.
 */
import type { Memory } from '../../../types/memory.js';
import { embeddingService } from '../../embedding/service.js';
import { getSearchSpaceIds } from '../../../utils/tenant-context.js';
import { buildSpaceFilter } from '../../../utils/space-filter.js';
import {
  SQUADRULES_CREATION_PROTOCOL_SLUG,
  SQUADRULES_REFINING_PROTOCOL_SLUG,
  memoryIsBuiltinSearchFooterProtocol
} from '../../../constants/builtin-search-meta.js';
import {
  getActivationPatternVectorName,
  getAdapterTitleVectorName,
  getPrimaryVectorName
} from '../../../utils/qdrant-vector-types.js';
import { pointToMemory } from '../../memory/qdrant-point-to-memory.js';
import type { LanceRecordEngine } from './lance-records-engine.js';
import { toNumberArray, type LanceRecordRow } from './lance-records-schema.js';

const TITLE_MATCH_BOOST = 0.45;
const ACTIVATION_PATTERN_MATCH_BOOST = 0.35;
const LABEL_MATCH_BOOST = 0.15;
const TAG_MATCH_BOOST = 0.05;

type Scored = { memory: Memory; score: number };

function payloadOf(row: LanceRecordRow): any {
  return JSON.parse(row.payload) as Record<string, unknown>;
}

function cosine(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function tokenize(text: string): Set<string> {
  return new Set((text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/** Fraction of the query tokens present in the field text, capped to [0,1]. */
function textMatch(queryTokens: Set<string>, fieldText: string): number {
  if (queryTokens.size === 0) return 0;
  const field = tokenize(fieldText);
  let hits = 0;
  for (const token of queryTokens) if (field.has(token)) hits++;
  return Math.min(hits / queryTokens.size, 1);
}

function headFilter() {
  const base = buildSpaceFilter(getSearchSpaceIds(), {
    must: [{ key: 'adapter.layer_index', match: { value: 1 } }]
  });
  return {
    ...base,
    must_not: [{ key: 'slug', match: { any: [SQUADRULES_REFINING_PROTOCOL_SLUG, SQUADRULES_CREATION_PROTOCOL_SLUG] } }]
  };
}

function finalize(scored: Scored[], limit: number, fallbackScore: number | null): { memories: Memory[]; scores: number[] } {
  let filtered = scored
    .filter((e) => e.score > 0 && !memoryIsBuiltinSearchFooterProtocol(e.memory))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : (a.memory.memory_uuid ?? '').localeCompare(b.memory.memory_uuid ?? '')))
    .slice(0, limit);
  if (filtered.length === 0 && scored.length > 0 && fallbackScore !== null) {
    filtered = scored
      .filter((e) => !memoryIsBuiltinSearchFooterProtocol(e.memory))
      .slice(0, limit)
      .map((e) => ({ memory: e.memory, score: fallbackScore }));
  }
  return { memories: filtered.map((e) => e.memory), scores: filtered.map((e) => e.score) };
}

export class LanceRecordSearch {
  constructor(private readonly engine: LanceRecordEngine) {}

  /** Full hybrid-style ranking over the three dense legs + text boosts. */
  async searchMemories(query: string, limit: number): Promise<{ memories: Memory[]; scores: number[] }> {
    const queryKey = (query || '').trim();
    if (!queryKey) return { memories: [], scores: [] };
    const { embedding: queryVector } = await embeddingService.generateEmbedding(queryKey);
    const primaryName = getPrimaryVectorName(queryVector.length);
    const titleName = getAdapterTitleVectorName(queryVector.length);
    const activationName = getActivationPatternVectorName(queryVector.length);
    const queryTokens = tokenize(queryKey);
    const rows = await this.engine.scroll(headFilter());
    const scored = rows.map((row) => {
      const payload = payloadOf(row);
      const memory = pointToMemory({ id: row.id, payload });
      const score =
        cosine(queryVector, toNumberArray(row[primaryName])) +
        TITLE_MATCH_BOOST * cosine(queryVector, toNumberArray(row[titleName])) +
        ACTIVATION_PATTERN_MATCH_BOOST * cosine(queryVector, toNumberArray(row[activationName])) +
        LABEL_MATCH_BOOST * textMatch(queryTokens, typeof payload.label_text === 'string' ? payload.label_text : payload.label || '') +
        TAG_MATCH_BOOST * textMatch(queryTokens, typeof payload.tags_text === 'string' ? payload.tags_text : (payload.tags || []).join(' ')) +
        (typeof payload.attest_boost === 'number' ? payload.attest_boost : 0);
      return { memory, score };
    });
    return finalize(scored, limit, 0.5);
  }

  /** Adapter-title similarity gate (mirrors `searchAdapterTitlesBySimilarity`). */
  async searchAdapterTitlesBySimilarity(query: string, limit: number): Promise<{ memories: Memory[]; scores: number[] }> {
    const queryKey = (query || '').trim();
    if (!queryKey) return { memories: [], scores: [] };
    const { embedding: queryVector } = await embeddingService.generateEmbedding(queryKey);
    const titleName = getAdapterTitleVectorName(queryVector.length);
    const rows = await this.engine.scroll(headFilter());
    const scored = rows.map((row) => ({
      memory: pointToMemory({ id: row.id, payload: payloadOf(row) }),
      score: cosine(queryVector, toNumberArray(row[titleName]))
    }));
    return finalize(scored, limit, null);
  }
}
