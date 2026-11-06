/**
 * Effective (inheritance-resolved) adapter content — SquadRules 6, Touchpoint 2b.
 *
 * Touchpoint 2 made `activate` resolve the inheritance chain, but the resolution was
 * cosmetic: `forward` still executed the CHILD's raw markdown, so a child that inherits
 * `steps` from a parent (because `steps` is structurally forbidden from `override:`,
 * see `services/graph-db/adapter-inheritance.ts`) had no contract blocks to run.
 *
 * This module is the single home for "what content does the agent actually execute".
 * Both `activate` (to surface the merged content in its response — Option A) and
 * `forward` (to execute it) call `resolveEffectiveLayerContent`, so the content the
 * agent sees in `activate` is byte-for-byte the content `forward` runs.
 *
 * Identity stays with the CHILD: the agent activated the child, so slug/version/
 * memory_uuid/adapter info are never substituted. Only the executable payload
 * (markdown body + inference contract) is taken from the nearest ancestor that
 * defines it, per the override-list merge semantics in docs/specs/graph-schema.md § 5.4.
 *
 * Graceful degradation: when the graph DB is unavailable or resolution throws, the
 * result carries `resolved: false` and `substitute: false`, a warning is logged, and
 * the caller uses the raw child adapter exactly as it did before this touchpoint.
 *
 * ADR 0025 (forward-link-only) governs the `mcp`/`forward` CONTRACT TYPE, not this
 * server-internal resolution: `forward` gains no new agent-facing query capability,
 * no new MCP tool and no new HTTP route. It executes what `activate` resolved.
 */
import type { InferenceContractDefinition, Memory } from '../types/memory.js';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { getGraphDbService } from '../services/graph-db/graph-db-singleton.js';
import {
  getAdapterId,
  getAdapterSlugForSearchOutput,
  getLayerIndex
} from '../services/memory/memory-accessors.js';
import { extractMemoryBody } from '../utils/memory-body.js';
import { structuredLogger } from '../utils/structured-logger.js';

/** Effective executable payload for a single adapter layer. */
export interface EffectiveLayerContent {
  /** Raw markdown body (BODY markers intact) so downstream `extractMemoryBody` still applies. */
  text: string;
  /** Inference contract for the layer; undefined when the source layer defines none. */
  inference_contract?: InferenceContractDefinition;
}

export interface EffectiveContentResult {
  /** True when the child layer's executable payload must be replaced by `effective`. */
  substitute: boolean;
  /** The substituted payload; present exactly when `substitute` is true. */
  effective?: EffectiveLayerContent;
  /** Inheritance chain slugs, child-to-root. Empty when there is no inheritance. */
  inheritance_chain: string[];
  /** Merged frontmatter properties from the graph resolution (identity from child). */
  resolved_properties?: Record<string, unknown>;
  /** False on graceful degradation (graph DB unavailable or resolution threw). */
  resolved: boolean;
}

/** No inheritance declared, or adapter absent from the graph: nothing to substitute. */
const NO_SUBSTITUTION: EffectiveContentResult = {
  substitute: false,
  inheritance_chain: [],
  resolved: true
};

/**
 * Resolve the effective (merged) executable content for a child adapter layer.
 *
 * @param memoryStore   - backing store used to load ancestor layer memories
 * @param qdrantService - retrieval surface used to map an ancestor slug to its layers
 * @param childMemory   - the child layer memory `forward`/`activate` is about to render
 */
export async function resolveEffectiveLayerContent(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  childMemory: Memory,
  logContext: 'forward' | 'activate' = 'forward'
): Promise<EffectiveContentResult> {
  const childSlug = getAdapterSlugForSearchOutput(childMemory);
  if (!childSlug) {
    // No slug → cannot key into the graph. Not a degradation, just nothing to resolve.
    return NO_SUBSTITUTION;
  }

  const graphDb = getGraphDbService();
  if (!graphDb || !graphDb.isInitialized()) {
    structuredLogger.warn(
      `${logContext}: graph DB unavailable — inheritance not resolved for "${childSlug}", executing raw adapter`
    );
    return { substitute: false, inheritance_chain: [], resolved: false };
  }

  try {
    const result = await graphDb.resolveInheritance(`adapter:${childSlug}`);
    if (!result) {
      // Adapter not in the graph (e.g. trained before the graph DB was enabled).
      // Not an error and not a degradation — there is simply no inheritance data.
      return NO_SUBSTITUTION;
    }

    // `inheritance_chain` is sorted deepest-first (root first); reverse to nearest-parent-first.
    const ancestorSlugs = result.inheritance_chain
      .map((n) => (n as { slug?: string }).slug)
      .filter((s): s is string => Boolean(s))
      .reverse();
    const chain = [result.adapter.slug, ...ancestorSlugs];

    if (ancestorSlugs.length === 0) {
      // Chain of one: the child inherits from nothing.
      return {
        substitute: false,
        inheritance_chain: chain,
        resolved_properties: result.resolved_properties,
        resolved: true
      };
    }

    const effective = await loadAncestorLayerContent(
      memoryStore,
      qdrantService,
      ancestorSlugs,
      getLayerIndex(childMemory)
    );

    if (!effective) {
      // Ancestors are in the graph but have no matching stored layer content.
      // Fall back to the raw child rather than executing nothing.
      return {
        substitute: false,
        inheritance_chain: chain,
        resolved_properties: result.resolved_properties,
        resolved: true
      };
    }

    return {
      substitute: true,
      effective,
      inheritance_chain: chain,
      resolved_properties: result.resolved_properties,
      resolved: true
    };
  } catch (err) {
    structuredLogger.warn(
      `${logContext}: resolveInheritance failed for "${childSlug}" (${err instanceof Error ? err.message : String(err)}) — executing raw adapter`
    );
    return { substitute: false, inheritance_chain: [], resolved: false };
  }
}

/**
 * Walk the ancestor chain nearest-parent-first and return the first ancestor whose
 * stored layers contain a layer matching `layerIndex`. Because `steps`/`contract` are
 * structurally forbidden from `override:`, executable content always originates in the
 * parent chain; the nearest ancestor that actually stored the layer wins.
 */
async function loadAncestorLayerContent(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  ancestorSlugs: string[],
  layerIndex: number
): Promise<EffectiveLayerContent | null> {
  if (!qdrantService) {
    // Without retrieval we cannot map an ancestor slug to its layers.
    return null;
  }
  for (const slug of ancestorSlugs) {
    const entry = await qdrantService.findFirstStepMemoryUuidBySlug(slug);
    if (!entry.layerUuid) continue;
    const entryMemory = await memoryStore.getMemory(entry.layerUuid);
    if (!entryMemory) continue;

    const adapterId = getAdapterId(entryMemory);
    const layers = await qdrantService.getAdapterLayers(adapterId);
    const match = layers.find(
      (l) => (l.payload?.adapter?.layer_index ?? 1) === layerIndex
    );
    const targetMemory = match
      ? await memoryStore.getMemory(match.uuid)
      : entryMemory;
    if (!targetMemory) continue;

    return {
      text: targetMemory.text,
      ...(targetMemory.inference_contract !== undefined
        ? { inference_contract: targetMemory.inference_contract }
        : {})
    };
  }
  return null;
}

/**
 * Apply an effective-content result to a child memory, returning a memory whose
 * executable payload (text + inference contract) is the merged one while every
 * identity field (memory_uuid, slug, adapter info, space) stays the child's.
 *
 * Returns the original memory unchanged when there is nothing to substitute.
 */
export function applyEffectiveContent(
  childMemory: Memory,
  result: EffectiveContentResult
): Memory {
  if (!result.substitute || !result.effective) {
    return childMemory;
  }
  // Identity fields (memory_uuid, slug, adapter, space_id) are preserved by the spread;
  // only the executable payload is replaced. exactOptionalPropertyTypes forbids assigning
  // `undefined` to an optional property, so an ancestor layer with no contract must DELETE
  // the child's contract rather than set it to undefined.
  const merged: Memory = {
    ...childMemory,
    text: result.effective.text
  };
  if (result.effective.inference_contract !== undefined) {
    merged.inference_contract = result.effective.inference_contract;
  } else {
    delete merged.inference_contract;
  }
  return merged;
}

/**
 * The merged adapter content surfaced by `activate` (Option A). This is the human/agent
 * readable view of what `forward` will execute: the child's identity plus the effective
 * (inheritance-resolved) markdown body. Contract blocks, steps, judgment_criteria,
 * timeout and interpreter all live inside `content` as the adapter's fenced ```json
 * contract blocks and step prose, exactly as `forward` renders them.
 */
export interface MergedAdapterContent {
  /** Child slug — identity stays with the activated child. */
  slug: string;
  /** Child version — identity stays with the activated child. */
  version: string | null;
  /** Effective markdown body (BODY markers stripped) the agent executes. */
  content: string;
  /** Inheritance chain slugs, child-to-root. */
  inheritance_chain: string[];
  /** False on graceful degradation (graph DB unavailable). */
  resolved: boolean;
}

/**
 * Build the surfaceable merged-content view from a child memory and its effective-content
 * resolution. When nothing is substituted (no inheritance, or graceful degradation) the
 * child's own body is surfaced, so the field is always safe to emit.
 */
export function buildMergedAdapterContent(
  childMemory: Memory,
  result: EffectiveContentResult
): MergedAdapterContent {
  const effectiveText =
    result.substitute && result.effective ? result.effective.text : childMemory.text;
  const slug = getAdapterSlugForSearchOutput(childMemory) ?? '';
  const version = childMemory.adapter?.protocol_version ?? null;
  return {
    slug,
    version,
    content: extractMemoryBody(effectiveText),
    inheritance_chain: result.inheritance_chain,
    resolved: result.resolved
  };
}
