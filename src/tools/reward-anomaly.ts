/**
 * Touchpoint 4: reward anomaly bookkeeping.
 *
 * When `reward` records a FAILED proof/outcome, the framework writes an `Anomaly`
 * node as internal bookkeeping. The anomaly is **proposal-only**: it never
 * rewrites the parent (or any) Adapter node. Ownership of the anomaly ->
 * parent-update write is deferred until an ADR assigns it (see
 * docs/specs/ontological-knowledge-system.md, "Back-Propagation", and the
 * deferred anomaly-backpropagation ADR).
 *
 * Graceful degradation: if the graph DB is unavailable, or the identity/parent
 * resolution fails, or the anomaly write throws, the reward call still succeeds.
 * Nothing here propagates — failures are logged with `structuredLogger.warn`.
 */
import { randomUUID } from 'node:crypto';
import type { QdrantService } from '../services/qdrant/service.js';
import { getGraphDb } from '../services/graph-db/graph-owner.js';
import type { GraphRepository } from '../services/graph-db/graph-repository.js';
import type { AdapterNode } from '../services/graph-db/graph-types.js';
import {
  adapterGraphKey,
  parentScopeCandidates,
  scopeMetadata,
  storedAdapterScope
} from '../services/graph-db/adapter-scope.js';
import { anomalyTargetMetadata } from '../services/graph-db/evolution/scoped-frequency.js';
import { REWARD_FAILURE_CLAIM } from '../services/graph-db/evolution/evolution-proposal-record.js';
import { structuredLogger } from '../utils/structured-logger.js';
import { proofOfWorkStore } from '../services/proof-of-work-store.js';

/** Identity the anomaly was written under, so reward can propose against the same scope. */
export interface RewardAnomalyOutcome {
  anomaly_key: string;
  /** Scoped child key, when the failing adapter's slug was resolvable. */
  child_key: string | null;
  /** Parent slug when inheritance routes there, otherwise the failing adapter's slug. */
  routes_to: string;
  discovered_by: string;
  space_id: string;
  severity: string;
  description: string;
}

export interface RewardAnomalyParams {
  /** Wire URI the reward was recorded against. */
  uri: string;
  /** Layer UUID parsed from the reward URI. */
  layerUuid: string;
  /** Reward outcome. Only `failure` produces an anomaly. */
  outcome: 'success' | 'failure';
  /** Optional evaluator feedback, folded into the anomaly description. */
  feedback?: string;
}

/**
 * Scope of the adapter an anomaly routes to, as the frequency reader will look it up.
 *
 * WHY THE TARGET IS RECORDED AT ALL
 * `routes_to` is a bare slug, so two adapters with the same slug in different spaces write
 * indistinguishable rows — and a later frequency count cannot tell them apart
 * (`evolution/scoped-frequency.ts`). Recording the exact `adapter:<spaceId>:<slug>` target
 * and its space is what lets that count answer "distinct children of THIS adapter".
 *
 * A parent lives either in the child's own space or in the app space every scope may
 * inherit from, so the candidate order decides which identity is truthful; an unavailable
 * read is not evidence for a nearer scope. When nothing is projected yet, the reporter's
 * own scope is the only identity this path can prove, and the proposal path fails closed on
 * a missing target rather than acting on it.
 *
 * `space` is optional on a projected Adapter node. A node without an observed space is not
 * evidence for any scope, so it is skipped instead of being attributed to the child's space.
 */
async function resolveAnomalyTarget(
  graphDb: GraphRepository,
  childSpaceId: string,
  routesTo: string,
  ownNode: AdapterNode | null
): Promise<{ targetKey: string; spaceId: string }> {
  if (ownNode?.space && ownNode.slug === routesTo) {
    return { targetKey: ownNode.key, spaceId: ownNode.space };
  }
  for (const candidate of parentScopeCandidates(childSpaceId)) {
    try {
      const node = await graphDb.getAdapter(adapterGraphKey(candidate, routesTo));
      if (node?.space) return { targetKey: node.key, spaceId: node.space };
    } catch {
      break;
    }
  }
  return { targetKey: adapterGraphKey(childSpaceId, routesTo), spaceId: childSpaceId };
}

/**
 * Record a proposal-only `Anomaly` node for a failed reward.
 *
 * No-op on success, when the graph DB is absent/uninitialized, or on any error.
 * PROPOSAL-ONLY INVARIANT: this path calls `createAnomaly` and read-only lookups
 * (`getAdapter`) ONLY. It must never call an Adapter-rewrite method
 * (`createAdapterNode`, `upsertAdapterNode`, `writeAdapterFromFrontmatter`).
 */
export async function recordRewardAnomaly(
  qdrantService: QdrantService,
  params: RewardAnomalyParams
): Promise<RewardAnomalyOutcome | null> {
  if (params.outcome !== 'failure') {
    return null;
  }

  const graphDb = getGraphDb(qdrantService);
  if (!graphDb) {
    return null;
  }

  try {
    // Resolve the failing adapter identity best-effort (never fatal).
    let discoveredBy = `layer:${params.layerUuid}`;
    let memorySpaceId: string | undefined;
    try {
      const memory = await qdrantService.getMemoryByUUID(params.layerUuid);
      memorySpaceId = typeof memory?.space_id === 'string' ? memory.space_id : undefined;
      const slug = typeof memory?.slug === 'string' ? memory.slug.trim() : '';
      const adapterName =
        typeof memory?.adapter?.name === 'string' ? memory.adapter.name.trim() : '';
      if (slug.length > 0) {
        discoveredBy = slug;
      } else if (adapterName.length > 0) {
        discoveredBy = adapterName;
      }
    } catch {
      /* keep the layer fallback identity */
    }

    // routes_to: the parent adapter slug when inheritance is involved, else the
    // failing adapter. This is a READ-ONLY graph lookup — proposal-only invariant.
    const scope = storedAdapterScope(memorySpaceId, 'reward');
    let routesTo = discoveredBy;
    let ownNode: AdapterNode | null = null;
    try {
      ownNode = await graphDb.getAdapter(adapterGraphKey(scope.spaceId, discoveredBy));
      const parent = ownNode?.frontmatter?.inherits;
      if (typeof parent === 'string' && parent.trim().length > 0) {
        routesTo = parent.trim();
      }
    } catch {
      /* keep the self route */
    }
    const target = await resolveAnomalyTarget(graphDb, scope.spaceId, routesTo, ownNode);

    // Severity from the stored proof failure class when available.
    let severity = 'medium';
    let description = `Reward recorded failure for ${params.uri}`;
    if (typeof params.feedback === 'string' && params.feedback.trim().length > 0) {
      description += `: ${params.feedback.trim()}`;
    }
    try {
      const storedProof = await proofOfWorkStore.getResult(params.layerUuid);
      if (storedProof?.status === 'failed') {
        const exitCode = storedProof.shell?.exit_code ?? storedProof.exit_code;
        if (exitCode !== undefined) {
          description += ` (exit_code ${exitCode})`;
          severity = exitCode === 0 ? 'medium' : 'high';
        }
      }
    } catch {
      /* keep the default severity */
    }

    // PROPOSAL-ONLY: createAnomaly writes an Anomaly node and never mutates an
    // Adapter node. The anomaly -> parent-update write is deferred to a future ADR.
    const anomalyKey = `anomaly:${randomUUID()}`;
    // Attribution: the reporting child is part of the anomaly, not a caller side note.
    // Without it the frequency rule (`>= 3 distinct children`) can never fire, because
    // the consensus reader counts distinct `source_child` values on the anomalies that
    // route to the same parent (ADR 0046).
    const knownSlug = discoveredBy === `layer:${params.layerUuid}` ? null : discoveredBy;
    const childKey = knownSlug ? adapterGraphKey(scope.spaceId, knownSlug) : null;
    await graphDb.createAnomaly({
      key: anomalyKey,
      type: 'Anomaly',
      discovered_by: discoveredBy,
      routes_to: routesTo,
      description,
      created_at: new Date().toISOString(),
      severity,
      anomaly_type: 'failure',
      status: 'open',
      ...(childKey ? { source_child: childKey } : {}),
      // Recorded so the anomaly is attributable to one scope, not to a bare slug, and to
      // the exact target `routes_to` names — the triple a scoped frequency count needs:
      // scope, target, and which claim this row reports.
      metadata: {
        ...scopeMetadata(scope),
        ...anomalyTargetMetadata(target),
        field: REWARD_FAILURE_CLAIM
      }
    });

    return {
      anomaly_key: anomalyKey,
      child_key: childKey,
      routes_to: routesTo,
      discovered_by: discoveredBy,
      space_id: scope.spaceId,
      severity,
      description
    };
  } catch (error) {
    structuredLogger.warn(
      `graph db: createAnomaly failed for reward failure "${params.uri}" — ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}
