/**
 * Derived evolution facts for a successful adapter write (ADR 0045 / ADR 0046).
 *
 * Two bookkeeping legs that read the *authored* document rather than the stored state:
 *
 *   1. an `Anomaly` node when the document declared `anomaly:` frontmatter,
 *   2. an evolution proposal for every **deterministic** child/parent contradiction.
 *
 * Detection reads the authored document because a contradiction and an `anomaly:`
 * declaration are the author's claims about a document, not properties of the
 * reconstructed bytes. Neither leg mutates the parent adapter: proposals are records,
 * and the parent change happens through a later normal `tune`.
 *
 * CONTRACT: nothing exported here throws. Each leg reports its own failure through the
 * caller's report so a partly-failing pass still records the legs that worked.
 */
import { randomUUID } from 'node:crypto';
import type { Memory } from '../../types/memory.js';
import type { AdapterRecordSource } from './adapter-graph-records.js';
import { resolveStoredAdapterLayers, resolveStoredParentSnapshot } from './adapter-graph-records.js';
import { adapterGraphKey } from './adapter-scope.js';
import { detectContradictions, factsFromMarkdown, parsePrimitive } from './evolution/detection.js';
import { proposeChange } from './evolution/evolution.service.js';
import {
  anomalyTargetMetadata,
  countScopedReportingChildren
} from './evolution/scoped-frequency.js';
import type { GraphRepository } from './graph-repository.js';
import type { AnomalyNode } from './graph-types.js';
import { parseFrontmatter } from '../../utils/frontmatter.js';
import { structuredLogger } from '../../utils/structured-logger.js';

/** The parts of a write this module needs: the stored head and its record source. */
export interface EvolutionFactInput {
  /** Stored head layer of the adapter that was just written. */
  head: Memory;
  /** Record-enumerating surface used to read the parent, when one exists. */
  source?: AdapterRecordSource | null;
}

/** What the caller reports back; only `degraded` is appended to. */
export interface EvolutionFactReport {
  degraded: string[];
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function anomalyNode(
  parsedAnomaly: Record<string, string>,
  discoveredBy: string,
  routesTo: string,
  scope: string
): AnomalyNode {
  const description =
    parsedAnomaly['reason']?.trim() ||
    parsedAnomaly['description']?.trim() ||
    `agent-declared ${parsedAnomaly['type']?.trim() || 'anomaly'} on ${discoveredBy}`;
  const node: AnomalyNode = {
    key: `anomaly:${randomUUID()}`,
    type: 'Anomaly',
    discovered_by: discoveredBy,
    routes_to: routesTo,
    description,
    created_at: new Date().toISOString(),
    severity: parsedAnomaly['severity']?.trim() || 'medium',
    anomaly_type: parsedAnomaly['type']?.trim() || 'contradiction',
    status: parsedAnomaly['status']?.trim() || 'open'
  };
  node.metadata = {
    scope_space_id: scope,
    scope_source: 'stored-record',
    source: 'frontmatter',
    field: parsedAnomaly['field'] ?? null,
    observed: parsedAnomaly['observed'] ?? null,
    expected: parsedAnomaly['expected'] ?? null
  };
  return node;
}

/**
 * Record the `anomaly:` a document declared, attributed to the stored adapter itself.
 *
 * Returns the new node's key, or `null` when the write failed. A declaration names the
 * adapter it was written on (`slug`/`space_id` from the stored record), never a
 * caller-supplied actor or child (ADR 0045).
 */
export async function recordDeclaredAnomaly(
  graphDb: GraphRepository,
  parsedAnomaly: Record<string, string>,
  slug: string,
  spaceId: string,
  sourceChild: string
): Promise<string | null> {
  try {
    const routesTo = parsedAnomaly['routes_to']?.trim() || slug;
    const node = anomalyNode(parsedAnomaly, slug, routesTo, spaceId);
    node.source_child = sourceChild;
    // Target identity is recorded only where it is unambiguous. A self-routing anomaly
    // targets this adapter in this scope. A parent-routed one may target an app-space
    // parent, and guessing "this scope" here would make the row unmatchable by a
    // frequency count that resolves the parent's real scope - so that case records no
    // target and relies on the shared helper's documented row-only rule.
    if (routesTo === slug) {
      Object.assign(node.metadata ?? {}, anomalyTargetMetadata({ targetKey: sourceChild, spaceId }));
    }
    await graphDb.createAnomaly(node);
    return node.key;
  } catch (err) {
    structuredLogger.warn(
      `evolution: declared anomaly write failed for ${slug} — ${describeError(err)}`
    );
    return null;
  }
}

interface ResolvedContradictions {
  parentKey: string;
  parentSpaceId: string;
  parentVersion: string;
  contradictions: ReturnType<typeof detectContradictions>;
  frequency: Map<string, string[]>;
  /** Fields whose frequency read filled its window, so the count is a floor. */
  frequencyTruncated: Set<string>;
}

/**
 * Resolve the parent and every deterministic contradiction to it.
 *
 * Returns `null` when the child declares no parent, the parent cannot be read from
 * any candidate scope, or nothing deterministic contradicts it. Semantic ("this
 * means something different") judgements are intentionally excluded.
 */
async function resolveContradictions(
  input: EvolutionFactInput,
  graphDb: GraphRepository,
  scopeSpaceId: string,
  authored: string
): Promise<ResolvedContradictions | null> {
  const declaredParent = input.head.adapter?.frontmatter?.inherits;
  const parentSlug = typeof declaredParent === 'string' ? declaredParent.trim() : '';
  if (!parentSlug || !input.source) return null;

  const resolved = await resolveStoredParentSnapshot(input.source, parentSlug, scopeSpaceId);
  if (!resolved) return null;

  const parentLayers = await resolveStoredAdapterLayers(input.source, parentSlug, resolved.spaceId);
  const parentHead =
    parentLayers?.find((layer) => (layer.adapter?.layer_index ?? 1) === 1) ?? parentLayers?.[0];
  const parentFields: Record<string, string> = {};
  for (const [name, value] of Object.entries(resolved.snapshot.frontmatter)) {
    if (value === undefined || value === null) continue;
    parentFields[name] = String(value);
  }
  const contradictions = detectContradictions(factsFromMarkdown(authored), {
    fields: parentFields,
    body: parentHead?.text ?? ''
  });
  if (contradictions.length === 0) return null;

  const parentKey = adapterGraphKey(resolved.spaceId, resolved.snapshot.slug);
  const frequency = new Map<string, string[]>();
  const frequencyTruncated = new Set<string>();
  for (const contradiction of contradictions) {
    const counted = await countScopedReportingChildren(graphDb, {
      targetKey: parentKey,
      spaceId: resolved.spaceId,
      slug: resolved.snapshot.slug,
      field: contradiction.field
    });
    frequency.set(contradiction.field, counted.children);
    if (counted.truncated) frequencyTruncated.add(contradiction.field);
  }

  return {
    parentKey,
    parentSpaceId: resolved.spaceId,
    parentVersion: resolved.snapshot.version,
    contradictions,
    frequency,
    frequencyTruncated
  };
}

/**
 * Record one proposal per deterministic contradiction to the resolved parent.
 *
 * The frequency set comes from `evolution/scoped-frequency.ts` so this producer and the
 * reward producer count the same children. The previous routing-slug query let another
 * space, or an unrelated contested field on the same slug, move `frequency_met`.
 */
export async function recordProposals(
  graphDb: GraphRepository,
  input: EvolutionFactInput,
  snapshot: { slug: string; frontmatter: Record<string, unknown> } | null,
  sourceChild: string,
  scopeSpaceId: string,
  authored: string,
  report: EvolutionFactReport
): Promise<string[]> {
  if (!snapshot) return [];
  const inherited = snapshot.frontmatter['inherits'];
  const targetSlug = typeof inherited === 'string' && inherited.trim().length > 0 ? inherited : snapshot.slug;
  try {
    const resolved = await resolveContradictions(input, graphDb, scopeSpaceId, authored);
    if (!resolved) return [];

    const keys: string[] = [];
    for (const contradiction of resolved.contradictions) {
      const reporting = resolved.frequency.get(contradiction.field) ?? [];
      const frequencyMet = new Set([...reporting, sourceChild]).size >= 3;
      const proposed = await proposeChange(graphDb, {
        targetKey: resolved.parentKey,
        targetSlug,
        space: resolved.parentSpaceId,
        changeType: 'parent_update',
        field: contradiction.field,
        fromValue: contradiction.parent_value,
        toValue: childPrimitive(
          snapshot.frontmatter,
          authored,
          contradiction.field,
          contradiction.child_value
        ),
        reason: contradiction.summary,
        sourceChild,
        evidence: {
          kind: 'deterministic-contradiction',
          contradiction_kind: contradiction.kind,
          parent_value: contradiction.parent_value,
          child_value: contradiction.child_value,
          // Both names are recorded on purpose: `parent_adapter_version` describes the
          // observation, and `target_adapter_version` is what `buildApplyPlan` turns into
          // the `expected_version` of the normal `tune` that applies the change.
          parent_adapter_version: resolved.parentVersion,
          target_adapter_version: resolved.parentVersion,
          supporting_children: [...new Set([...reporting, sourceChild])].sort(),
          frequency_met: frequencyMet,
          // A filled window makes the count a floor, so the threshold it supported is
          // recorded as provisional rather than presented as a population.
          frequency_truncated: resolved.frequencyTruncated.has(contradiction.field),
          detected_from: 'frontmatter-primitives-and-rule-statements'
        },
        requiredConfirmations: frequencyMet ? 3 : 1
      });
      keys.push(proposed.proposal.key);
    }
    return keys;
  } catch (err) {
    structuredLogger.warn(
      `evolution: proposal pass failed for ${sourceChild} — ${describeError(err)}`
    );
    report.degraded.push(`proposal pass failed — ${describeError(err)}`);
    return [];
  }
}

/** Child's declared value for the contested field, falling back to the observed literal. */
function childPrimitive(
  frontmatter: Record<string, unknown>,
  markdown: string,
  field: string,
  fallback: string
): string {
  const declared = frontmatter[field];
  if (
    typeof declared === 'string' ||
    typeof declared === 'number' ||
    typeof declared === 'boolean'
  ) {
    return String(declared);
  }
  const parsed = parsePrimitive(parseFrontmatter(markdown).fields[field] ?? '');
  return parsed === undefined ? fallback : String(parsed);
}
