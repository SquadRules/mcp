/**
 * Stored-ancestry walk for effective (inheritance-resolved) adapter content.
 *
 * WHY SEPARATE
 * Resolution has two halves: reading the stored chain (this module) and merging it
 * (the pure `mergeAdapterMarkdown`). The chain walk is where every incomplete-chain
 * reason is produced, so keeping it alone makes the fail-closed contract auditable:
 * `loadStoredAncestry` either returns a complete child-to-root chain or a `reason`,
 * never a silently shortened one.
 *
 * SOURCE OF TRUTH
 * Bodies live in stored layer records; the graph only holds topology. Each step reads
 * the parent record the shared scope policy resolves (child's space first, app space
 * second), and the ancestor layer pairs with the child by `layer_index`, falling back
 * to the ancestor's head layer.
 */
import type { Memory } from '../types/memory.js';
import {
  resolveStoredAdapterLayers,
  resolveStoredParentSnapshot,
  type AdapterRecordSource
} from '../services/graph-db/adapter-graph-records.js';
import { parseOverrideList } from '../services/graph-db/adapter-inheritance.js';
import type { CheckpointStageInput } from '../services/graph-db/inheritance-checkpoint.js';
import { getLayerIndex } from '../services/memory/memory-accessors.js';
import { extractMemoryBody } from '../utils/memory-body.js';

/** Safety bound on a stored ancestry walk. Reaching it fails closed, never truncates silently. */
export const MAX_INHERITANCE_DEPTH = 32;
/** Read one frontmatter string the store persisted on the layer record. */
function storedString(memory: Memory, key: string): string | undefined {
  const value = memory.adapter?.frontmatter?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Read one frontmatter override list, tolerating array or raw-authoring-string form. */
export function storedOverrideList(memory: Memory): string[] {
  // `override` is declared `string[]`, so a backend may hand it back as an array or as
  // the raw authoring string. Read it as `unknown` so both shapes stay reachable.
  const value: unknown = memory.adapter?.frontmatter?.['override'];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return parseOverrideList(value);
  }
  return [];
}

/** The ancestor layer that pairs with a child layer: same index, else the head layer. */
function pickLayerForIndex(layers: Memory[], layerIndex: number): Memory | null {
  if (layers.length === 0) return null;
  const match = layers.find((layer) => getLayerIndex(layer) === layerIndex);
  if (match) return match;
  return layers.find((layer) => getLayerIndex(layer) === 1) ?? layers[0] ?? null;
}

/** Version of one level: the stored protocol version, else the frontmatter `version`, else 0.0.0. */
function stageVersion(memory: Memory): string {
  const protocol = memory.adapter?.protocol_version;
  if (typeof protocol === 'string' && protocol.trim().length > 0) return protocol.trim();
  return storedString(memory, 'version') ?? '0.0.0';
}

/** One level as a checkpoint stage: content digest is taken by the service. */
export function toCheckpointStage(level: { slug: string; memory: Memory; spaceId: string }): CheckpointStageInput {
  return {
    slug: level.slug,
    version: stageVersion(level.memory),
    space_id: level.spaceId,
    layer_index: getLayerIndex(level.memory),
    content: extractMemoryBody(level.memory.text)
  };
}

export interface StoredAncestry {
  /** Child first: the walk order. Reversed for the merge (root first). */
  levels: Array<{ slug: string; memory: Memory; spaceId: string }>;
  /** Child-to-root slugs. */
  chain: string[];
  /** Set when the chain could not be materialised completely. */
  reason?: string;
}

/**
 * Walk the stored ancestry of `childMemory`.
 *
 * Every step reads the parent record the shared scope policy resolves, so a parent
 * stored in the app space and a parent stored in the child's own space are both found,
 * and the child's own scope always wins. A missing parent, a cycle, or the depth bound
 * returns a `reason` instead of a shorter chain: partial ancestry must be visible as
 * such to the caller.
 */
export async function loadStoredAncestry(
  source: AdapterRecordSource,
  childMemory: Memory,
  childSlug: string,
  onStageResolved?: (level: StoredAncestry['levels'][number]) => Promise<void>
): Promise<StoredAncestry> {
  const layerIndex = getLayerIndex(childMemory);
  const levels: StoredAncestry['levels'] = [
    { slug: childSlug, memory: childMemory, spaceId: childMemory.space_id ?? '' }
  ];
  const chain: string[] = [childSlug];
  const seen = new Set<string>([childSlug]);

  let current = childMemory;
  let currentSpaceId = childMemory.space_id ?? '';

  for (let depth = 0; depth < MAX_INHERITANCE_DEPTH; depth++) {
    const parentSlug = storedString(current, 'inherits');
    if (!parentSlug) return { levels, chain };
    if (seen.has(parentSlug)) {
      return { levels, chain, reason: `inheritance_cycle: ${parentSlug} repeats in the stored ancestry` };
    }

    const parent = await resolveStoredParentSnapshot(source, parentSlug, currentSpaceId);
    if (!parent) {
      return {
        levels,
        chain,
        reason: `parent_missing: "${parentSlug}" has no stored record in "${currentSpaceId}" or the app space`
      };
    }
    const parentLayers = await resolveStoredAdapterLayers(source, parentSlug, parent.spaceId);
    if (!parentLayers || parentLayers.length === 0) {
      return {
        levels,
        chain,
        reason: `parent_missing: "${parentSlug}" has no readable stored layers in "${parent.spaceId}"`
      };
    }
    const target = pickLayerForIndex(parentLayers, layerIndex);
    if (!target) {
      return {
        levels,
        chain,
        reason: `parent_missing: "${parentSlug}" has no layer ${layerIndex} or head layer`
      };
    }

    seen.add(parentSlug);
    chain.push(parentSlug);
    const level = { slug: parentSlug, memory: target, spaceId: parent.spaceId };
    levels.push(level);
    if (onStageResolved) await onStageResolved(level);
    current = target;
    currentSpaceId = parent.spaceId;
  }

  return {
    levels,
    chain,
    reason: `inheritance_depth_exceeded: stored ancestry exceeds ${MAX_INHERITANCE_DEPTH} levels`
  };
}
