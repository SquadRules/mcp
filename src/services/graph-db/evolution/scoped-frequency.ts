/**
 * Scoped anomaly frequency for the consensus ladder (ADR 0046 §§3–4).
 *
 * WHY THIS EXISTS
 * `frequency_met` decides how many confirmations a proposal needs, so the set it
 * counts must be the set the decision is actually about: distinct children
 * reporting the *same* claim against the *same scoped* adapter. Aggregating on the
 * routing slug alone let an unrelated space — or a different contested field on the
 * same slug — move a threshold it has no bearing on.
 *
 * WHAT IT COUNTS
 * One entry per distinct `source_child` key. A child that reported the same claim
 * twice is one reporter, not two.
 *
 * TARGET IDENTITY
 * Every current producer records the target an anomaly was raised against
 * (`metadata.target_key` / `metadata.target_space_id`, see
 * `anomalyTargetMetadata`). Rows written before those fields existed carry only the
 * reporting child's own scope, so they are matched by the documented legacy rule in
 * `anomalyMatchesTarget` rather than silently dropped.
 *
 * WINDOW
 * The read is bounded. A filled window means the count may be an undercount, and
 * `truncated` says so instead of presenting the window as the population.
 */
import { SQUADRULES_APP_SPACE_ID } from '../../../config.js';
import type { GraphRepository } from '../graph-repository.js';
import type { AnomalyNode } from '../graph-types.js';

/** Rows read for one frequency count. Bounded on purpose; see `truncated`. */
export const ANOMALY_FREQUENCY_WINDOW = 500;

/** The exact adapter + claim a frequency count is about. */
export interface ScopedAnomalyTarget {
  /** Scoped graph key of the targeted adapter: `adapter:<spaceId>:<slug>`. */
  targetKey: string;
  /** Space the targeted adapter lives in. */
  spaceId: string;
  /** Slug the anomaly routes to (the unscoped legacy field). */
  slug: string;
  /** Contested field / claim identity. */
  field: string;
}

export interface ScopedFrequencyResult {
  /** Distinct scoped child keys reporting this claim against this target. */
  children: string[];
  /** True when the read window filled, so `children` may be an undercount. */
  truncated: boolean;
  /** The window `truncated` refers to. */
  window: number;
}

/**
 * Claim identity comparison: case- and whitespace-insensitive, type-insensitive.
 *
 * A field name reaches this function from frontmatter (a string), from a stored
 * anomaly's metadata (whatever the backend handed back), and from a detection
 * result. Normalizing once is what makes those three sources comparable.
 */
export function normalizeClaimIdentity(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim().toLowerCase();
}

function metaString(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * True when this anomaly is a report of `target`'s claim against `target`'s adapter.
 *
 * Scope is resolved from the strongest evidence the row carries, in order: the
 * recorded target key, then the recorded target space, then the legacy rule for rows
 * that predate target recording. The legacy rule is deliberately narrow — it counts
 * a row only where the scope cannot change the claim's meaning: the reporting child
 * is in the target's own scope, or the target is the app-space adapter every scope
 * may inherit from.
 */
export function anomalyMatchesTarget(anomaly: AnomalyNode, target: ScopedAnomalyTarget): boolean {
  if ((anomaly.routes_to ?? '').trim() !== target.slug) return false;
  if (normalizeClaimIdentity(anomaly.metadata?.['field']) !== normalizeClaimIdentity(target.field)) return false;

  const recordedKey = metaString(anomaly.metadata, 'target_key');
  if (recordedKey.length > 0) return recordedKey === target.targetKey;

  const recordedSpace = metaString(anomaly.metadata, 'target_space_id');
  if (recordedSpace.length > 0) return recordedSpace === target.spaceId;

  const childScope = metaString(anomaly.metadata, 'scope_space_id');
  return childScope === target.spaceId || target.spaceId === SQUADRULES_APP_SPACE_ID;
}

/**
 * Target-identity metadata every anomaly producer records.
 *
 * Written at creation time so a later frequency count can tell two same-slug
 * adapters in different scopes apart. Without it the count has only the routing
 * slug, which is exactly the ambiguity this module exists to remove.
 */
export function anomalyTargetMetadata(target: {
  targetKey: string;
  spaceId: string;
}): Record<string, string> {
  return { target_key: target.targetKey, target_space_id: target.spaceId };
}

/** Count distinct children reporting `target`'s claim, disclosing the read window. */
export async function countScopedReportingChildren(
  graphDb: GraphRepository,
  target: ScopedAnomalyTarget
): Promise<ScopedFrequencyResult> {
  const anomalies = await graphDb.listAnomalies({
    routesTo: target.slug,
    limit: ANOMALY_FREQUENCY_WINDOW
  });
  const children = new Set<string>();
  for (const anomaly of anomalies) {
    if (!anomalyMatchesTarget(anomaly, target)) continue;
    const child = (anomaly.source_child ?? '').trim();
    if (child.length > 0) children.add(child);
  }
  return {
    children: [...children].sort(),
    truncated: anomalies.length >= ANOMALY_FREQUENCY_WINDOW,
    window: ANOMALY_FREQUENCY_WINDOW
  };
}

/** Distinct scoped child keys reporting this claim against this target. */
export async function distinctScopedReportingChildren(
  graphDb: GraphRepository,
  target: ScopedAnomalyTarget
): Promise<string[]> {
  return (await countScopedReportingChildren(graphDb, target)).children;
}
