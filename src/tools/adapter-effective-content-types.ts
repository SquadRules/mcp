/**
 * Result and view types for effective (inheritance-resolved) adapter content.
 *
 * These are the shapes `activate`, `forward` and their callers agree on. They live
 * apart from the resolver so the "what does the agent see" contract can be read
 * without the walk or the merge in the way.
 */
import type { InferenceContractDefinition } from '../types/memory.js';
import type { EffectiveContract, EffectiveSection } from '../services/graph-db/adapter-content-merge.js';
import type { InheritanceCheckpointService } from '../services/graph-db/inheritance-checkpoint.js';

/** Effective executable payload for a single adapter layer. */
export interface EffectiveLayerContent {
  /** Merged markdown body (BODY markers stripped) — what the agent executes. */
  text: string;
  /** The effective inference contract: the nearest level that defines one. */
  inference_contract?: InferenceContractDefinition;
  /**
   * Effective contracts, nearest level first. Level-carried contracts (the executable
   * ones) precede contracts still present as fences; `[0]` is what `forward` runs.
   */
  effective_contracts: EffectiveContract[];
  /** Root-first contributing slugs (child last). */
  lineage: string[];
  /** `heading -> overriding slug` for every section a nearer level replaced. */
  overrides: Record<string, string>;
  /** Winning sections in output order — the audit view of the merge. */
  sections: EffectiveSection[];
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
  /** True only when the whole stored ancestry was materialised (or there is none). */
  resolved: boolean;
  /** Why `resolved` is false. Always present when `resolved` is false. */
  resolved_reason?: string;
  /**
   * Recovery-checkpoint outcome for this resolution. Present only when the caller supplied
   * an execution id and a checkpoint service. This is recovery metadata, never a proof.
   */
  checkpoint?: {
    status: 'missing' | 'resumed' | 'stale';
    /** Hex resume token of the state on disk; never a filesystem path. */
    token?: string;
    /** Why a stored checkpoint was not reused. */
    reason?: string;
  };
}

export interface EffectiveContentOptions {
  /** Execution id of the current run, so a crash/retry resumes the same walk. */
  executionId?: string;
  /** Owner-instance checkpoint service. Omitted by callers that do not opt in. */
  checkpoints?: InheritanceCheckpointService | null;
}

/** No inheritance declared: nothing to substitute, and nothing failed. */
export const NO_SUBSTITUTION: EffectiveContentResult = {
  substitute: false,
  inheritance_chain: [],
  resolved: true
};

/**
 * The merged adapter content surfaced by `activate`. This is the human/agent readable
 * view of what `forward` will execute: the child's identity plus the effective
 * (inheritance-resolved) markdown body, the ancestry tree, the section overrides, and
 * the exact contract fences the merge produced.
 */
export interface MergedAdapterContent {
  /** Child slug — identity stays with the activated child. */
  slug: string;
  /** Child version — identity stays with the activated child. */
  version: string | null;
  /** Effective merged markdown body (BODY markers stripped) the agent executes. */
  content: string;
  /** Inheritance chain slugs, child-to-root. */
  inheritance_chain: string[];
  /** True only when the whole stored ancestry resolved. */
  resolved: boolean;
  /** Why resolution is incomplete; absent when `resolved` is true. */
  resolved_reason?: string;
  /** Root-first contributing slugs (child last) — the recorded lineage tree (display-trimmed). */
  lineage: string[];
  /** True when `SQUADRULES_TREE_DISPLAY_DEPTH` trimmed `lineage`; content is never trimmed. */
  lineage_truncated: boolean;
  /** `heading -> overriding slug` for every explicitly overridden section. */
  overrides: Record<string, string>;
  /** Contract fences in the merged body, nearest level first; `[0]` is what forward runs. */
  effective_contracts: Array<{ source: string; heading: string; contract: InferenceContractDefinition }>;
}
