/**
 * Lance write-path primitives.
 *
 * The Qdrant store/adapter handlers reach the index through three client calls —
 * `scroll` (duplicate + slug collision), `delete` (force-update replace) and the
 * title-similarity search — plus a handful of artifact anchor lookups. This module
 * reimplements exactly those over the Lance engine and the JS-cosine searcher, so
 * the higher-level writer can reuse the backend-neutral parsing/build helpers
 * (`resolveProtocolSlugCandidate`, `deriveDomainTaskType`, `buildHeaderMemoryAdapter`,
 * embeddings) unchanged and produce a store that reads/searches with the same
 * contract as Qdrant. Payload semantics (protected-space guard, duplicate/slug error
 * codes, similarity threshold, artifact anchor resolution) are mirrored verbatim.
 */
import { SIMILAR_MEMORY_THRESHOLD } from '../../../config.js';
import { getSpaceContext, getSearchSpaceIds } from '../../../utils/tenant-context.js';
import { buildSpaceFilter } from '../../../utils/space-filter.js';
import { isProtectedWriteSpace, protectedWriteErrorMessage } from '../../../utils/protected-space-write-guard.js';
import { SquadrulesError } from '../../../types/index.js';
import { buildAdapterUri, buildLayerUri } from '../../../tools/squadrules-uri.js';
import { MAX_AUTO_SUFFIX_ATTEMPTS, nextAutoSlugCandidate } from '../../../utils/protocol-slug.js';
import { ALLOWED_ARTIFACT_MIMES } from '../../../tools/artifact-mime.js';
import { deriveDomainTaskType, buildAdapterSimilaritySearchQuery, type AdapterSlugMintInput } from '../../memory/store-adapter-helpers.js';
import type { LanceRecordEngine } from './lance-records-engine.js';
import type { LanceRecordSearch } from './lance-records-search.js';
import type { LanceRecordRow } from './lance-records-schema.js';

function payloadOf(row: LanceRecordRow): any {
  return JSON.parse(row.payload) as Record<string, unknown>;
}

function adapterIdOf(payload: any): string | undefined {
  const id = payload?.adapter?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export class LanceWriteRepo {
  constructor(private readonly engine: LanceRecordEngine, private readonly search: LanceRecordSearch) {}

  /** Points already stored under this adapter id (duplicate check). */
  async checkDuplicateAdapter(adapterUuid: string): Promise<{ points: Array<{ id: string; payload: any }> }> {
    const filter = buildSpaceFilter(getSpaceContext().allowedSpaceIds, {
      must: [{ key: 'adapter.id', match: { value: adapterUuid } }]
    });
    const rows = await this.engine.scroll(filter, 256);
    return { points: rows.map((r) => ({ id: r.id, payload: payloadOf(r) })) };
  }

  /**
   * Replace-or-reject an existing adapter. Mirrors `handleDuplicateAdapter`: throw
   * DUPLICATE_ADAPTER unless force_update, block writes into protected spaces, then
   * delete the old adapter rows so the mint re-creates a clean chain.
   */
  async handleDuplicateAdapter(adapterUuid: string, forceUpdate: boolean): Promise<void> {
    const dup = await this.checkDuplicateAdapter(adapterUuid);
    if (dup.points.length === 0) return;

    if (!forceUpdate) {
      const items = dup.points.map((p) => ({ label: (p.payload?.label as string) || 'Memory', uri: buildLayerUri(p.id) }));
      throw new SquadrulesError('Duplicate adapter', 'DUPLICATE_ADAPTER', 409, { adapter_id: adapterUuid, items });
    }

    const protectedEntries = dup.points.filter((p) =>
      isProtectedWriteSpace(typeof p.payload?.space_id === 'string' ? p.payload.space_id : '')
    );
    if (protectedEntries.length > 0) {
      const items = protectedEntries.map((p) => ({
        label: (p.payload?.label as string) || 'Memory',
        uri: buildLayerUri(p.id),
        space_id: typeof p.payload?.space_id === 'string' ? p.payload.space_id : undefined
      }));
      const firstSpaceId = typeof protectedEntries[0]?.payload?.space_id === 'string' ? protectedEntries[0].payload.space_id : undefined;
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
    await this.engine.deleteByFilter(filter);
  }

  /** Slug collision scan within allowed spaces. */
  async scrollPointsWithSlug(slug: string): Promise<Array<{ id: string; payload: any }>> {
    const filter = buildSpaceFilter(getSpaceContext().allowedSpaceIds, { must: [{ key: 'slug', match: { value: slug } }] });
    const rows = await this.engine.scroll(filter, 24);
    return rows.map((r) => ({ id: r.id, payload: payloadOf(r) }));
  }

  /** Allocate a non-colliding slug (author exact-collision rejects; auto appends -2, -3…). */
  async allocateAdapterSlugForMint(input: AdapterSlugMintInput, newAdapterUuid: string): Promise<string> {
    const { slug: baseSlug, authorSupplied } = input;

    const usedByOtherAdapter = async (candidate: string): Promise<{ otherAdapterId: string; sample_uri?: string } | null> => {
      const hits = await this.scrollPointsWithSlug(candidate);
      for (const h of hits) {
        const adapterId = adapterIdOf(h.payload);
        if (adapterId && adapterId !== newAdapterUuid) {
          return { otherAdapterId: adapterId, sample_uri: buildLayerUri(h.id) };
        }
      }
      return null;
    };

    if (authorSupplied) {
      const clash = await usedByOtherAdapter(baseSlug);
      if (clash) {
        throw new SquadrulesError(
          `Slug "${baseSlug}" is already used by another protocol in this space.`,
          'DUPLICATE_SLUG',
          409,
          { slug: baseSlug, adapter_id: clash.otherAdapterId, sample_uri: clash.sample_uri }
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

  /** Title-similarity guard before mint (throws SIMILAR_MEMORY_FOUND above threshold). */
  async checkSimilarAdapterByTitle(adapterTitle: string, forceUpdate: boolean): Promise<void> {
    if (forceUpdate) return;
    const label = buildAdapterSimilaritySearchQuery(adapterTitle);
    const { memories, scores } = await this.search.searchAdapterTitlesBySimilarity(label, 10);
    if (memories.length === 0 || scores.length === 0) return;

    let bestMatch = memories[0]!;
    let bestScore = scores[0] ?? 0;
    for (let i = 1; i < memories.length; i++) {
      const score = scores[i] ?? 0;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = memories[i]!;
      }
    }
    if (bestScore < SIMILAR_MEMORY_THRESHOLD) return;

    const adapterUri = bestMatch.adapter?.id ? buildAdapterUri(bestMatch.adapter.id) : buildLayerUri(bestMatch.memory_uuid ?? '');
    const existingMemory = {
      uri: buildLayerUri(bestMatch.memory_uuid ?? ''),
      memory_uuid: bestMatch.memory_uuid,
      label: bestMatch.label,
      adapter_name: bestMatch.adapter?.name ?? null,
      score: bestScore,
      layer_count: bestMatch.adapter?.layer_count ?? 1
    };
    const next_action = `call export with ${adapterUri} and format "markdown" for flat Markdown to inspect the similar adapter. If your markdown uses the same adapter id, call train with force_update: true to replace that adapter; otherwise pick a distinct adapter title (H1)`;
    const content_preview = [bestMatch.label, bestMatch.text].filter(Boolean).join('\n').slice(0, 300);
    const matchedAdapterName = bestMatch.adapter?.name ?? bestMatch.label;

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

  /** Resolve an adapter head point id by slug (lowest id wins). */
  async resolveAdapterAnchorPointId(slug: string): Promise<string | null> {
    const normalized = (slug || '').trim().toLowerCase();
    if (!normalized) return null;
    const filter = buildSpaceFilter(getSearchSpaceIds(), {
      must: [{ key: 'slug', match: { value: normalized } }, { key: 'adapter.layer_index', match: { value: 1 } }]
    });
    const rows = await this.engine.scroll(filter);
    if (rows.length === 0) return null;
    const ids = rows.map((r) => r.id).sort((a, b) => a.localeCompare(b));
    return ids[0] ?? null;
  }

  async resolveAdapterNameByAdapterId(adapterId: string): Promise<string | null> {
    const filter = buildSpaceFilter(getSearchSpaceIds(), {
      must: [{ key: 'adapter.id', match: { value: adapterId } }, { key: 'adapter.layer_index', match: { value: 1 } }]
    });
    const rows = await this.engine.scroll(filter, 1);
    const payload = rows[0] ? payloadOf(rows[0]) : {};
    const name = payload?.adapter?.name;
    if (typeof name === 'string' && name.trim().length > 0) return name.trim();
    if (typeof payload?.label === 'string' && payload.label.trim().length > 0) return payload.label.trim();
    return null;
  }

  /** Normalize a slug / layer-id / chain-id adapter reference to its chain id + name. */
  async resolveChainAdapterIdForArtifacts(parsed: { id: string; idKind?: string }): Promise<{ adapterId: string; adapterName: string | null }> {
    if (parsed.idKind === 'slug') {
      const headPointId = await this.resolveAdapterAnchorPointId(parsed.id);
      if (!headPointId) throw new Error(`Adapter slug "${parsed.id}" was not found for artifact attachment`);
      const row = await this.engine.retrieveRaw(headPointId);
      const payload = row ? payloadOf(row) : {};
      const adapterId = typeof payload?.adapter?.id === 'string' && payload.adapter.id.length > 0 ? payload.adapter.id : headPointId;
      const adapterName =
        typeof payload?.adapter?.name === 'string' && payload.adapter.name.trim().length > 0
          ? payload.adapter.name.trim()
          : await this.resolveAdapterNameByAdapterId(adapterId);
      return { adapterId, adapterName };
    }
    const row = await this.engine.retrieveRaw(parsed.id);
    const payload = row ? payloadOf(row) : {};
    const nameFromRow = typeof payload?.adapter?.name === 'string' && payload.adapter.name.trim().length > 0 ? payload.adapter.name.trim() : null;
    const idFromRow = typeof payload?.adapter?.id === 'string' && payload.adapter.id.length > 0 ? payload.adapter.id : null;
    if (idFromRow) {
      const adapterName = nameFromRow ?? (await this.resolveAdapterNameByAdapterId(idFromRow));
      return { adapterId: idFromRow, adapterName };
    }
    const adapterName = nameFromRow ?? (await this.resolveAdapterNameByAdapterId(parsed.id));
    return { adapterId: parsed.id, adapterName };
  }

  /** Existing artifact points for an adapter+space (for duplicate detection). */
  async listExistingArtifactPoints(spaceId: string, adapterId: string): Promise<Array<{ id: string; payload: any }>> {
    const filter = buildSpaceFilter(getSearchSpaceIds(), {
      must: [
        { key: 'space_id', match: { value: spaceId } },
        { key: 'adapter.id', match: { value: adapterId } },
        { key: 'content_type', match: { any: [...ALLOWED_ARTIFACT_MIMES] } }
      ]
    });
    const rows = await this.engine.scroll(filter);
    return rows.map((r) => ({ id: r.id, payload: payloadOf(r) }));
  }

  /** Re-export domain/task/type for the writer's per-memory metric loop. */
  deriveDomainTaskType(label: string, text: string, tags: string[]): { task: string; type: string } {
    return deriveDomainTaskType(label, text, tags);
  }
}
