import { logger } from '../../utils/structured-logger.js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { SquadrulesError } from '../../types/index.js';
import { SIMILAR_MEMORY_THRESHOLD } from '../../config.js';
import { getSpaceContext } from '../../utils/tenant-context.js';
import { buildSpaceFilter } from '../../utils/space-filter.js';
import { isProtectedWriteSpace, protectedWriteErrorMessage } from '../../utils/protected-space-write-guard.js';
import type { MemoryQdrantStoreMethods } from './store-methods.js';
import { buildAdapterUri, buildLayerUri } from '../../tools/squadrules-uri.js';
import { MAX_AUTO_SUFFIX_ATTEMPTS, nextAutoSlugCandidate } from '../../utils/protocol-slug.js';

/**
 * Derives domain task type from label, text, and tags.
 */
export function deriveDomainTaskType(label: string, text: string, tags: string[]) {
  const lower = (s: string) => (s || '').toLowerCase();
  const ltext = `${lower(label)}\n${lower(text)}`;
  const ltags = (tags || []).map(t => lower(t));

  const tasks = ['networking', 'security', 'optimization', 'troubleshooting', 'error-handling', 'installation', 'configuration', 'testing', 'deployment', 'database'] as const;

  const task = tasks.find(t => ltags.includes(t) || ltext.includes(t)) || 'general';

  let type: 'pattern' | 'rule' | 'context' = 'context';
  if (/```/.test(text) || ltags.includes('pattern') || ltext.includes('pattern')) type = 'pattern';
  else if (ltags.includes('rule') || ltext.includes('rule')) type = 'rule';

  return { task, type };
}

/**
 * Checks for duplicate adapter by adapter UUID.
 */
export async function checkDuplicateAdapter(
  client: QdrantClient,
  collection: string,
  adapterUuid: string
): Promise<{ points: any[] }> {
  const filter = buildSpaceFilter(getSpaceContext().allowedSpaceIds, {
    must: [{ key: 'adapter.id', match: { value: adapterUuid } }]
  });
  const dupReq = { filter, limit: 256, with_payload: true, with_vector: false } as any;
  logger.debug(`[Qdrant][scroll-dup] collection=${collection} req=${JSON.stringify(dupReq)}`);
  const dup = await client.scroll(collection, dupReq);
  logger.debug(`[Qdrant][scroll-dup] result_count=${dup?.points?.length || 0}`);
  return dup;
}

/**
 * Handles duplicate adapter: either throws error or deletes the existing adapter.
 */
export async function handleDuplicateAdapter(
  client: QdrantClient,
  collection: string,
  adapterUuid: string,
  forceUpdate: boolean
): Promise<void> {
  const dup = await checkDuplicateAdapter(client, collection, adapterUuid);

  if ((dup.points?.length || 0) > 0) {
    if (!forceUpdate) {
      const items = (dup.points || []).map((p: any) => ({
        label: (p.payload?.label as string) || 'Memory',
        uri: buildLayerUri(String(p.id))
      }));
      throw new SquadrulesError('Duplicate adapter', 'DUPLICATE_ADAPTER', 409, { adapter_id: adapterUuid, items });
    }
    const protectedEntries = (dup.points || []).filter((p: any) =>
      isProtectedWriteSpace(typeof p?.payload?.space_id === 'string' ? p.payload.space_id : '')
    );
    if (protectedEntries.length > 0) {
      const items = protectedEntries.map((p: any) => ({
        label: (p.payload?.label as string) || 'Memory',
        uri: buildLayerUri(String(p.id)),
        space_id: typeof p?.payload?.space_id === 'string' ? p.payload.space_id : undefined
      }));
      const firstSpaceId =
        typeof protectedEntries[0]?.payload?.space_id === 'string' ? protectedEntries[0].payload.space_id : undefined;
      throw new SquadrulesError(
        protectedWriteErrorMessage(firstSpaceId),
        'PROTECTED_SPACE_WRITE_FORBIDDEN',
        403,
        { adapter_id: adapterUuid, items }
      );
    }
    const filter = buildSpaceFilter(getSpaceContext().allowedSpaceIds, {
      must: [{ key: 'adapter.id', match: { value: adapterUuid } }]
    });
    const delReq = { filter } as any;
    logger.debug(`[Qdrant][delete-adapter] collection=${collection} req=${JSON.stringify(delReq)}`);
    await client.delete(collection, delReq);
  }
}

/** Max length for train-time similarity search text (adapter title / H1 only). */
const ADAPTER_SIMILARITY_QUERY_MAX = 400;

/**
 * Text for pre-train similarity search: adapter title (H1) only — no layer/memory headings.
 */
export function buildAdapterSimilaritySearchQuery(adapterTitle: string): string {
  const a = adapterTitle.trim();
  if (!a) return 'Memory';
  return a.slice(0, ADAPTER_SIMILARITY_QUERY_MAX);
}

/**
 * Similarity guard before train (store): hybrid/vector search on adapter title only.
 * Set SIMILAR_MEMORY_THRESHOLD=1 in env to effectively disable.
 * With force_update: true, duplicate adapter id is handled by handleDuplicateAdapter (replace).
 */
export async function checkSimilarAdapterByTitle(
  methods: MemoryQdrantStoreMethods,
  adapterTitle: string,
  forceUpdate: boolean
): Promise<void> {
  if (forceUpdate) {
    return;
  }

  const label = buildAdapterSimilaritySearchQuery(adapterTitle);

  const { memories, scores } = await methods.searchAdapterTitlesBySimilarity(label, 10);

  if (memories.length === 0 || scores.length === 0) {
    return;
  }

  let bestMatch = memories[0]!;
  let bestScore = scores[0] ?? 0;
  for (let i = 1; i < memories.length; i++) {
    const score = scores[i] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = memories[i]!;
    }
  }

  if (bestScore >= SIMILAR_MEMORY_THRESHOLD) {
    const adapterUri = bestMatch.adapter?.id ? buildAdapterUri(bestMatch.adapter.id) : buildLayerUri(bestMatch.memory_uuid);
    const layerUri = buildLayerUri(bestMatch.memory_uuid);
    const existingMemory = {
      uri: layerUri,
      memory_uuid: bestMatch.memory_uuid,
      label: bestMatch.label,
      adapter_name: bestMatch.adapter?.name ?? null,
      score: bestScore,
      layer_count: bestMatch.adapter?.layer_count ?? 1
    };
    const next_action = `call export with ${adapterUri} and format "markdown" for flat Markdown to inspect the similar adapter. If your markdown uses the same adapter id, call train with force_update: true to replace that adapter; otherwise pick a distinct adapter title (H1)`;
    const content_preview = [bestMatch.label, bestMatch.text].filter(Boolean).join('\n').slice(0, 300);

    const matchedAdapterName = bestMatch.adapter?.name ?? bestMatch.label;
    logger.warn(
      `[MemoryQdrantStore] Similar adapter title: query "${label}" ~ existing "${matchedAdapterName}" score ${bestScore.toFixed(3)}`
    );

    throw new SquadrulesError(
      'Similar memory found by title',
      'SIMILAR_MEMORY_FOUND',
      409,
      {
        existing_memory: existingMemory,
        similarity_score: bestScore,
        message: `Adapter title similar to existing "${matchedAdapterName}" (${Math.round(bestScore * 100)}% match). Verify or use force_update: true with the same adapter id to replace.`,
        must_obey: true,
        next_action,
        content_preview
      }
    );
  }
}

/** Input for resolving a unique slug before adapter upsert (after handleDuplicateAdapter). */
export interface AdapterSlugMintInput {
  slug: string;
  authorSupplied: boolean;
}

async function scrollPointsWithSlug(
  client: QdrantClient,
  collection: string,
  slug: string
): Promise<Array<{ id: string | number; payload: Record<string, unknown> }>> {
  const allowed = getSpaceContext().allowedSpaceIds;
  const filter = buildSpaceFilter(allowed, { must: [{ key: 'slug', match: { value: slug } }] });
  const dup = await client.scroll(collection, {
    filter,
    limit: 24,
    with_payload: true,
    with_vector: false
  } as any);
  return (dup.points ?? []).map((p: any) => ({ id: p.id, payload: p.payload || {} }));
}

/**
 * Allocate a slug that does not collide with another adapter in allowed spaces.
 * Author slugs: exact collision with a different adapter -> DUPLICATE_SLUG.
 * Auto slugs: append -2, -3, ... until free.
 */
export async function allocateAdapterSlugForMint(
  client: QdrantClient,
  collection: string,
  input: AdapterSlugMintInput,
  newAdapterUuid: string
): Promise<string> {
  const { slug: baseSlug, authorSupplied } = input;

  async function usedByOtherAdapter(candidate: string): Promise<{ otherAdapterId: string; sample_uri?: string } | null> {
    const hits = await scrollPointsWithSlug(client, collection, candidate);
    for (const h of hits) {
      const adapterId = typeof (h.payload['adapter'] as { id?: string } | undefined)?.id === 'string'
        ? (h.payload['adapter'] as { id: string }).id
        : undefined;
      if (adapterId && adapterId !== newAdapterUuid) {
        return {
          otherAdapterId: adapterId,
          sample_uri: buildLayerUri(String(h.id))
        };
      }
    }
    return null;
  }

  if (authorSupplied) {
    const clash = await usedByOtherAdapter(baseSlug);
    if (clash) {
      throw new SquadrulesError(
        `Slug "${baseSlug}" is already used by another protocol in this space.`,
        'DUPLICATE_SLUG',
        409,
        {
          slug: baseSlug,
          adapter_id: clash.otherAdapterId,
          sample_uri: clash.sample_uri
        }
      );
    }
    return baseSlug;
  }

  for (let attempt = 1; attempt <= MAX_AUTO_SUFFIX_ATTEMPTS; attempt++) {
    const candidate = nextAutoSlugCandidate(baseSlug, attempt);
    const clash = await usedByOtherAdapter(candidate);
    if (!clash) return candidate;
  }

  throw new SquadrulesError(
    `Could not allocate a unique slug from "${baseSlug}" after ${MAX_AUTO_SUFFIX_ATTEMPTS} attempts.`,
    'SLUG_ALLOCATION_EXHAUSTED',
    409,
    { base_slug: baseSlug }
  );
}
