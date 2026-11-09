/**
 * Types for the scoped ontology context projected onto `activate` (ADR 0047).
 *
 * These are descriptive shapes only: nothing here can address a graph outside the
 * activated adapter's own scope.
 */
import type { VersionNode } from '../graph-types.js';

/** Scope the context was read from, with provenance — never an implicit default. */
export interface OntologyScopeInfo {
  adapter_key: string;
  space_id: string;
  space_source: string;
}

/**
 * Explicit retrieval context. `task`/`domain` are declared by the caller; `human` and
 * `org` are resolved by the runtime from the authenticated space context.
 */
export interface OntologyContextFilters {
  task: string | null;
  domain: string | null;
  human: string | null;
  org: string | null;
  /** Where each non-null value came from, so the projection is auditable. */
  sources: Record<string, string>;
}

export interface OntologyRelationship {
  type: 'inherits' | 'concept';
  target: string;
  depth: number;
}

export interface OntologyEvidenceRow {
  key: string;
  detail: string;
}

export interface OntologyEvidence {
  open_anomalies: number;
  pending_proposals: number;
  accepted_proposals: number;
  version_snapshots: number;
  /** Newest first, capped; the counts above are the authoritative totals. */
  anomalies: OntologyEvidenceRow[];
  proposals: OntologyEvidenceRow[];
}

export interface AppliedEvolutionRow {
  version_number: string;
  adapter_version: string;
  change_type: VersionNode['change_type'];
  changed_at: string;
  changed_by: string;
  reason: string;
  /** SHA-256 of that snapshot's bytes — integrity of the record, not truth of a claim. */
  content_digest: string;
}

export interface OntologyEvolution {
  current_adapter_version: string | null;
  current_snapshot: string | null;
  applied: AppliedEvolutionRow[];
  resolution_notes: string[];
  explanation: string;
}

export interface ActivationOntologyContext {
  scope: OntologyScopeInfo;
  context: OntologyContextFilters;
  concept: { key: string; name: string; baseline_attributes: Record<string, unknown> } | null;
  relationships: OntologyRelationship[];
  evidence: OntologyEvidence;
  evolution: OntologyEvolution;
  /** Non-null when part of the projection could not be read; the rest is still true. */
  degraded: string | null;
}

/** Caller-declared retrieval context; never a search scope. */
export interface ExplicitActivationContext {
  task?: string | undefined;
  domain?: string | undefined;
}

/** Stored adapter facts the filters read (frontmatter/metadata only). */
export interface ContextAdapterFacts {
  frontmatter?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
