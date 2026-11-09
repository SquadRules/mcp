import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { getGraphDb } from '../services/graph-db/graph-owner.js';
import { adapterGraphKey, storedAdapterScope } from '../services/graph-db/adapter-scope.js';
import {
  resolveEffectiveLayerContent,
  buildMergedAdapterContent,
  type MergedAdapterContent
} from './adapter-effective-content.js';
import type { ActivateOutput } from './activate_schema.js';

export interface ActivationInheritanceResult {
  chain: string[];
  resolved: boolean;
  /** Merged executable content for the top match (Option A surfacing); null when unavailable. */
  merged: MergedAdapterContent | null;
  /** Slug the `merged` content belongs to, so it is attached to the right choice. */
  mergedSlug: string | null;
}

/**
 * Resolve the inheritance chain for the top matched adapter choice.
 *
 * Graceful degradation: if the graph DB is unavailable or resolveInheritance throws,
 * returns `{ chain: [], resolved: false }` and logs a warning. The activation still
 * succeeds using the raw adapter.
 */
export async function resolveActivationInheritance(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  choices: ActivateOutput['choices']
): Promise<ActivationInheritanceResult> {
  const topMatch = choices.find((c) => c.role === 'match' && c.slug);
  if (!topMatch?.slug) {
    // No match choice with a slug — nothing to resolve, not a degradation.
    return { chain: [], resolved: true, merged: null, mergedSlug: null };
  }

  // Primary path (Touchpoint 2b): when retrieval is available, load the child's entry
  // layer and resolve the effective content through the SAME helper `forward` executes.
  // One graph resolution yields both the chain and the merged executable content, so what
  // activate surfaces is byte-for-byte what forward runs (Option A).
  let resolvedChild: Awaited<ReturnType<MemoryQdrantStore['getMemory']>> | null = null;
  if (qdrantService) {
    try {
      const entry = await qdrantService.findFirstStepMemoryUuidBySlug(topMatch.slug);
      const childMemory = entry.layerUuid ? await memoryStore.getMemory(entry.layerUuid) : null;
      resolvedChild = childMemory;
      if (childMemory) {
        const effective = await resolveEffectiveLayerContent(
          memoryStore,
          qdrantService,
          childMemory,
          'activate'
        );
        return {
          chain: effective.inheritance_chain,
          resolved: effective.resolved,
          merged: buildMergedAdapterContent(childMemory, effective),
          mergedSlug: topMatch.slug
        };
      }
    } catch (err) {
      structuredLogger.warn(
        `activate: effective-content resolution failed for "${topMatch.slug}" (${err instanceof Error ? err.message : String(err)}) — falling back to chain-only resolution`
      );
    }
  }

  // Fallback: slug-only chain resolution (no retrieval, or the child entry layer could not
  // be loaded). Surfaces the chain but no merged content; forward still resolves on its own.
  const graphDb = getGraphDb(memoryStore);
  if (!graphDb) {
    structuredLogger.warn(
      `activate: graph DB unavailable — inheritance not resolved for "${topMatch.slug}"`
    );
    return { chain: [], resolved: false, merged: null, mergedSlug: null };
  }

  // Scope comes from the stored record. Without it the slug alone is ambiguous (the
  // same slug can exist in several spaces), so the graph is not consulted.
  if (!resolvedChild) {
    structuredLogger.warn(
      `activate: stored record for "${topMatch.slug}" is unavailable — inheritance chain cannot be resolved without its space`
    );
    return { chain: [], resolved: false, merged: null, mergedSlug: null };
  }

  try {
    const childScope = storedAdapterScope(resolvedChild.space_id, `activate:${topMatch.slug}`);
    const adapterKey = adapterGraphKey(childScope.spaceId, topMatch.slug);
    const result = await graphDb.resolveInheritance(adapterKey);

    if (!result) {
      // Adapter not in graph (e.g. trained before graph DB was enabled).
      // Not an error — just no inheritance data available.
      return { chain: [], resolved: true, merged: null, mergedSlug: null };
    }

    // Build child-to-root slug list: [child, parent, grandparent, ...]
    // result.inheritance_chain is sorted deepest-first (root first), so reverse
    // to get nearest-parent-first, then prepend the child.
    const ancestorSlugs = result.inheritance_chain
      .map((n) => (n as { slug?: string }).slug)
      .filter((s): s is string => Boolean(s))
      .reverse();
    const chain = [result.adapter.slug, ...ancestorSlugs];

    return { chain, resolved: true, merged: null, mergedSlug: null };
  } catch (err) {
    structuredLogger.warn(
      `activate: resolveInheritance failed for "${topMatch.slug}" (${err instanceof Error ? err.message : String(err)}) — continuing with raw adapter`
    );
    return { chain: [], resolved: false, merged: null, mergedSlug: null };
  }
}
