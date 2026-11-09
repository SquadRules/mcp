/**
 * Effective (inheritance-resolved) adapter content — SquadRules 6, Touchpoints 2b + 4.
 *
 * This module is the single home for "what content does the agent actually execute".
 * Both `activate` (to surface the merged content) and `forward` (to execute it) call
 * `resolveEffectiveLayerContent`, so the content the agent sees in `activate` is
 * byte-for-byte the content `forward` runs.
 *
 * SOURCE OF TRUTH
 * Executable content lives in stored layer records, not in the graph. The graph stores
 * topology (who inherits from whom) and resolved properties; the bodies live in the
 * store. Resolution therefore walks the **stored** ancestry: child record → its
 * `inherits:` frontmatter → that parent's stored record in the shared scope policy
 * (child's own space first, app space second) → onward to the root.
 *
 * MERGE (chosen behaviour, ADR 0043)
 * Additive + selective, never whole-ancestor replacement. The child is the spine: its
 * sections keep their order and its identity (slug/version/space) stays the child's.
 * An ancestor section is inherited only when no nearer level claims the same keyed
 * heading; a nearer level's section with that heading is the explicit override and is
 * recorded. Child-only sections are additions and survive. The merge itself is the pure
 * `mergeAdapterMarkdown` in `services/graph-db/adapter-content-merge.ts`.
 *
 * FAIL-CLOSED
 * `resolved: false` carries an explicit `resolved_reason` whenever the ancestry could not
 * be fully materialised: an ancestor record is missing, the chain cycles, or the safety
 * depth bound is exceeded. It is never `true` for an incomplete chain, because a
 * `resolved: true` with silently missing parent contracts is exactly the false proof the
 * verification principle forbids.
 *
 * Graceful degradation: when the graph DB is unavailable the content still resolves from
 * stored records (they are the authority for bodies); only `resolved_properties` is
 * absent. Nothing here adds an agent-facing capability, tool, or route — ADR 0025/0028
 * govern the contract *type*, not this internal resolution.
 *
 * SHAPE OF THIS FILE
 * The chain walk lives in `adapter-effective-ancestry.ts`, the result/view types in
 * `adapter-effective-content-types.ts` (re-exported below so callers keep one import).
 * What remains here is the decision: merge, or fail closed with a reason.
 */
import type { Memory } from '../types/memory.js';
import type { MemoryQdrantStore } from '../services/memory/store.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { getGraphDb } from '../services/graph-db/graph-owner.js';
import { adapterGraphKey, storedAdapterScope } from '../services/graph-db/adapter-scope.js';
import { mergeAdapterMarkdown, type AdapterContentLevel } from '../services/graph-db/adapter-content-merge.js';
import { type CheckpointIdentity, type CheckpointLoadResult } from '../services/graph-db/inheritance-checkpoint.js';
import { TREE_DISPLAY_DEPTH } from '../config/graph-db.js';
import { getAdapterSlugForSearchOutput } from '../services/memory/memory-accessors.js';
import { extractMemoryBody } from '../utils/memory-body.js';
import { structuredLogger } from '../utils/structured-logger.js';
import {
  loadStoredAncestry,
  storedOverrideList,
  toCheckpointStage,
  type StoredAncestry
} from './adapter-effective-ancestry.js';
import {
  NO_SUBSTITUTION,
  type EffectiveContentOptions,
  type EffectiveContentResult,
  type EffectiveLayerContent,
  type MergedAdapterContent
} from './adapter-effective-content-types.js';

// One import surface for callers: the types moved out, the public path did not.
export type {
  EffectiveContentOptions,
  EffectiveContentResult,
  EffectiveLayerContent,
  MergedAdapterContent
} from './adapter-effective-content-types.js';

/**
 * Resolve the effective (merged) executable content for a child adapter layer.
 *
 * @param memoryStore   - backing store; also the record source for the ancestry walk
 * @param qdrantService - retrieval surface (kept for the `resolved_properties` graph read)
 * @param childMemory   - the child layer memory `forward`/`activate` is about to render
 */
export async function resolveEffectiveLayerContent(
  memoryStore: MemoryQdrantStore,
  qdrantService: QdrantService | undefined,
  childMemory: Memory,
  logContext: 'forward' | 'activate' = 'forward',
  options: EffectiveContentOptions = {}
): Promise<EffectiveContentResult> {
  const childSlug = getAdapterSlugForSearchOutput(childMemory);
  if (!childSlug) return NO_SUBSTITUTION;

  const identity: CheckpointIdentity | null =
    options.executionId && options.checkpoints
      ? {
          execution_id: options.executionId,
          scope_id: childMemory.space_id ?? '',
          adapter_slug: childSlug
        }
      : null;

  const recordStage = async (level: StoredAncestry['levels'][number]): Promise<void> => {
    if (!identity || !options.checkpoints) return;
    try {
      await options.checkpoints.recordStage(identity, toCheckpointStage(level));
    } catch (err) {
      // Recovery metadata must never break resolution.
      structuredLogger.debug(
        `${logContext}: inheritance checkpoint write skipped for "${level.slug}" (${err instanceof Error ? err.message : String(err)})`
      );
    }
  };

  // Read the state a previous process left BEFORE this walk records its own stages.
  // Reconciling against post-walk state would compare the walk with itself and could
  // never report a changed ancestor (see `InheritanceCheckpointService.reconcile`).
  let priorCheckpoint: CheckpointLoadResult | null = null;
  if (identity && options.checkpoints) {
    try {
      priorCheckpoint = await options.checkpoints.load(identity);
    } catch (err) {
      structuredLogger.debug(
        `${logContext}: inheritance checkpoint read skipped for "${childSlug}" (${err instanceof Error ? err.message : String(err)})`
      );
    }
  }

  const ancestry = await loadStoredAncestry(memoryStore, childMemory, childSlug, recordStage);
  if (ancestry.levels.length === 1 && !ancestry.reason) {
    // No `inherits:` on the stored child: nothing to merge and nothing incomplete.
    return NO_SUBSTITUTION;
  }
  if (ancestry.levels.length === 1) {
    // The child DOES declare `inherits:`, but the parent could not be materialised
    // (missing record, self-inheritance). A single-level ancestry with a reason is an
    // INCOMPLETE chain, so it must report `resolved: false` — returning the
    // "nothing to substitute" answer here would claim a resolution that never happened.
    // `loadStoredAncestry` returns a single level here only via an early `inherits:`
    // walk that set a reason, so the fallback below is a type-safety net, not a new case.
    const incompleteReason =
      ancestry.reason ?? 'inheritance_incomplete: declared parent could not be materialised';
    structuredLogger.warn(
      `${logContext}: inheritance incomplete for "${childSlug}" (${incompleteReason}) — no ancestor content is available`
    );
    return {
      substitute: false,
      inheritance_chain: ancestry.chain,
      resolved: false,
      resolved_reason: incompleteReason
    };
  }

  // Record the child stage first: the walk records ancestors as it finds them, and a
  // crash right after the child stage still resumes the same execution identity.
  await recordStage(ancestry.levels[0]!);

  // Resume state is reconciled against the ancestry that was just read. A stored stage
  // whose version or content digest changed is invalidated with an explicit reason.
  let checkpointStatus: EffectiveContentResult['checkpoint'];
  if (identity && options.checkpoints) {
    try {
      const reconciled = await options.checkpoints.reconcile(
        identity,
        ancestry.levels.map((level) => toCheckpointStage(level)),
        priorCheckpoint ?? undefined
      );
      checkpointStatus =
        reconciled.status === 'resumed'
          ? { status: 'resumed', token: reconciled.token }
          : reconciled.status === 'stale'
            ? { status: 'stale', reason: reconciled.reason }
            : { status: 'missing' };
    } catch (err) {
      structuredLogger.debug(
        `${logContext}: inheritance checkpoint reconcile skipped for "${childSlug}" (${err instanceof Error ? err.message : String(err)})`
      );
    }
  }

  // Root-first levels for the merge (the walk is child-first).
  const mergeLevels: AdapterContentLevel[] = [...ancestry.levels]
    .reverse()
    .map((level) => ({
      slug: level.slug,
      body: extractMemoryBody(level.memory.text),
      overrides: storedOverrideList(level.memory),
      // The layer record carries the executable contract; the writer strips the fence
      // from `text`, so reading only fences here would drop the child's own contract.
      ...(level.memory.inference_contract ? { contract: level.memory.inference_contract } : {})
    }));
  const merged = mergeAdapterMarkdown(mergeLevels);

  const effectiveContracts = merged.effective_contracts;
  const effective: EffectiveLayerContent = {
    text: merged.content,
    ...(effectiveContracts[0] ? { inference_contract: effectiveContracts[0].contract } : {}),
    effective_contracts: effectiveContracts,
    lineage: merged.lineage,
    overrides: merged.overrides,
    sections: merged.sections
  };

  if (ancestry.reason) {
    structuredLogger.warn(
      `${logContext}: inheritance incomplete for "${childSlug}" (${ancestry.reason}) — executing the resolved child and its resolvable ancestors only`
    );
    return {
      substitute: true,
      effective,
      inheritance_chain: ancestry.chain,
      resolved: false,
      resolved_reason: ancestry.reason,
      ...(checkpointStatus ? { checkpoint: checkpointStatus } : {})
    };
  }

  // Graph is optional here: it supplies resolved_properties (frontmatter-level merge) and
  // is never the authority for bodies. A graph read failure must not claim the content
  // resolution failed, and must not claim it succeeded either — it simply adds nothing.
  const graphDb = getGraphDb(memoryStore);
  if (graphDb) {
    try {
      const childScope = storedAdapterScope(childMemory.space_id, `${logContext}:${childSlug}`);
      const resolved = await graphDb.resolveInheritance(adapterGraphKey(childScope.spaceId, childSlug));
      if (resolved) {
        await finishCheckpoint(identity, options, logContext, childSlug);
        return {
          substitute: true,
          effective,
          inheritance_chain: ancestry.chain,
          resolved_properties: resolved.resolved_properties,
          resolved: true,
          ...(checkpointStatus ? { checkpoint: checkpointStatus } : {})
        };
      }
    } catch (err) {
      structuredLogger.debug(
        `${logContext}: graph resolved_properties unavailable for "${childSlug}" (${err instanceof Error ? err.message : String(err)}) — content merge still authoritative`
      );
    }
  } else {
    structuredLogger.debug(
      `${logContext}: graph DB unavailable for "${childSlug}" — resolving inheritance from stored records only`
    );
  }

  await finishCheckpoint(identity, options, logContext, childSlug);
  return {
    substitute: true,
    effective,
    inheritance_chain: ancestry.chain,
    resolved: true,
    ...(checkpointStatus ? { checkpoint: checkpointStatus } : {})
  };
}

/** Terminal cleanup: a fully resolved walk has no recovery value left. */
async function finishCheckpoint(
  identity: CheckpointIdentity | null,
  options: EffectiveContentOptions,
  logContext: string,
  childSlug: string
): Promise<void> {
  if (!identity || !options.checkpoints) return;
  try {
    await options.checkpoints.finish(identity);
  } catch (err) {
    structuredLogger.debug(
      `${logContext}: inheritance checkpoint cleanup skipped for "${childSlug}" (${err instanceof Error ? err.message : String(err)})`
    );
  }
}

/**
 * Apply an effective-content result to a child memory, returning a memory whose
 * executable payload (text + inference contract) is the merged one while every
 * identity field (memory_uuid, slug, adapter info, space) stays the child's.
 *
 * The contract applied here is exactly `effective_contracts[0]` — the first entry the
 * resolution surfaced — so `forward` cannot execute a contract `activate` did not show.
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
  // `undefined` to an optional property, so a merge with no contract must DELETE the
  // child's contract rather than set it to undefined.
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
 * Build the surfaceable merged-content view from a child memory and its effective-content
 * resolution. When nothing is substituted (no inheritance) the child's own body is
 * surfaced, so the field is always safe to emit.
 */
export function buildMergedAdapterContent(
  childMemory: Memory,
  result: EffectiveContentResult
): MergedAdapterContent {
  const effectiveText =
    result.substitute && result.effective ? result.effective.text : childMemory.text;
  const slug = getAdapterSlugForSearchOutput(childMemory) ?? '';
  const version = childMemory.adapter?.protocol_version ?? null;
  const fullLineage =
    result.effective?.lineage ??
    (result.inheritance_chain.length > 0 ? [...result.inheritance_chain].reverse() : []);
  // Display depth is a presentation preference: it trims only the surfaced tree, keeping
  // the nearest levels. Content, contracts, and the materialisation walk stay complete.
  const displayDepth = TREE_DISPLAY_DEPTH;
  const lineage =
    displayDepth > 0 && fullLineage.length > displayDepth
      ? fullLineage.slice(fullLineage.length - displayDepth)
      : fullLineage;
  const base = {
    slug,
    version,
    content: extractMemoryBody(effectiveText),
    inheritance_chain: result.inheritance_chain,
    resolved: result.resolved,
    lineage,
    lineage_truncated: lineage.length !== fullLineage.length,
    overrides: result.effective?.overrides ?? {},
    effective_contracts:
      result.effective?.effective_contracts.map((entry) => ({
        source: entry.source,
        heading: entry.heading,
        contract: entry.contract
      })) ?? []
  };
  return result.resolved_reason !== undefined
    ? { ...base, resolved_reason: result.resolved_reason }
    : base;
}
