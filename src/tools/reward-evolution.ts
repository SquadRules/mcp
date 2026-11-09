/**
 * Reward → evolution proposal bridge (ADR 0046).
 *
 * A failed reward already records an anomaly (proposal-only). This module turns that
 * anomaly into a **verifiable, scoped proposal** and — when the caller names one —
 * records a confirmation and settles the consensus.
 *
 * It never mutates the target adapter: the accepted change is handed back as an
 * apply plan that the caller performs with normal `train`/`tune` + `expected_version`.
 */
import type { QdrantService } from '../services/qdrant/service.js';
import { getGraphDb } from '../services/graph-db/graph-owner.js';
import { adapterGraphKey, parentScopeCandidates, storedAdapterKey } from '../services/graph-db/adapter-scope.js';
import type { GraphRepository } from '../services/graph-db/graph-repository.js';
import {
  EvolutionIntegrityError,
  loadEvolutionTarget,
  confirmProposal,
  proposeChange,
  settleProposal,
  type EvolutionApplyPlan,
  type EvolutionIntegrityDiagnostic
} from '../services/graph-db/evolution/evolution.service.js';
import type { RewardAnomalyOutcome } from './reward-anomaly.js';
import type { RewardInput } from './reward_schema.js';
import { parseSquadrulesUriOrThrow } from './squadrules-uri.js';
import { structuredLogger } from '../utils/structured-logger.js';

/** Compact report returned to the reward caller. */
export interface RewardEvolutionReport {
  proposal: string | null;
  status: string | null;
  decision: string | null;
  decided_by: string | null;
  required_confirmations: number | null;
  distinct_children: number | null;
  anomaly: string | null;
  apply_plan: EvolutionApplyPlan | null;
  diagnostic?: EvolutionIntegrityDiagnostic | null;
  next_action: string;
}

const NONE: RewardEvolutionReport = {
  proposal: null,
  status: null,
  decision: null,
  decided_by: null,
  required_confirmations: null,
  distinct_children: null,
  anomaly: null,
  apply_plan: null,
  next_action: 'no evolution record was written (graph unavailable or outcome not a failure)'
};

function nextActionFor(report: Omit<RewardEvolutionReport, 'next_action'>): string {
  if (report.diagnostic) return `blocked: ${report.diagnostic.code}. ${report.diagnostic.recovery_action}`;
  if (report.apply_plan) return report.apply_plan.instructions;
  switch (report.decision) {
    case 'reject':
      return 'rejected: the parent stays unchanged; no write is needed.';
    case 'branch':
      return 'branch: keep the parent unchanged and train a sub-category adapter for this child instead.';
    case 'accept':
      return 'blocked: no scoped, version-bound apply plan was verified; reload the proposal before applying.';
    default:
      return report.proposal
        ? `pending: collect confirmations with reward({ proposal: "${report.proposal}", proposal_decision: "confirm" }); ${report.required_confirmations ?? 1} distinct confirmation(s) needed.`
        : 'no proposal was recorded.';
  }
}

/** Resolve the scoped key of the proposal target: the parent when it exists, else the child. */
async function resolveTarget(
  graphDb: GraphRepository,
  anomaly: RewardAnomalyOutcome
): Promise<{ key: string; slug: string; space: string; version: string }> {
  const candidates = anomaly.routes_to === anomaly.discovered_by
    ? [anomaly.space_id]
    : parentScopeCandidates(anomaly.space_id);
  for (const candidate of candidates) {
    const key = adapterGraphKey(candidate, anomaly.routes_to);
    try {
      const node = await loadEvolutionTarget(graphDb, key, anomaly.routes_to, candidate);
      return { key: node.key, slug: node.slug, space: candidate, version: node.version };
    } catch (err) {
      // Only a successful absence permits fallback; unavailable/foreign reads stop.
      if (!(err instanceof EvolutionIntegrityError) || err.diagnostic.code !== 'target_missing') throw err;
    }
  }
  throw new EvolutionIntegrityError('target_missing', 'Reload the stored scoped target and graph projection; no target or version was invented.');
}

/** Distinct children that already reported the same routable anomaly. */
async function reportingChildren(graphDb: GraphRepository, routesTo: string): Promise<number> {
  try {
    const anomalies = await graphDb.listAnomalies({ routesTo, limit: 500 });
    const children = new Set<string>();
    for (const anomaly of anomalies) {
      const child = (anomaly.source_child ?? '').trim();
      if (child.length > 0) children.add(child);
    }
    return children.size;
  } catch {
    return 0;
  }
}

/**
 * Record a proposal for a failed reward and settle its current consensus.
 *
 * Frequency uses **distinct children** reporting the same anomaly; three failures of
 * one child never raise the bar to a frequency change.
 */
export async function recordRewardEvolution(
  qdrantService: QdrantService,
  anomaly: RewardAnomalyOutcome,
  input: RewardInput
): Promise<RewardEvolutionReport> {
  const graphDb = getGraphDb(qdrantService);
  if (!graphDb || !graphDb.isInitialized() || !anomaly.child_key) {
    return { ...NONE, anomaly: anomaly.anomaly_key };
  }

  try {
    const target = await resolveTarget(graphDb, anomaly);
    const distinctChildren = Math.max(1, await reportingChildren(graphDb, anomaly.routes_to));
    const proposed = await proposeChange(graphDb, {
      targetKey: target.key,
      targetSlug: target.slug,
      space: target.space,
      changeType: 'subcategory_split',
      field: 'reward_failure',
      fromValue: null,
      toValue: (input.feedback ?? 'recorded failure').trim().slice(0, 500),
      reason: anomaly.description,
      sourceChild: anomaly.child_key,
      sourceAnomaly: anomaly.anomaly_key,
      evidence: {
        kind: 'reward-failure',
        target_adapter_version: target.version,
        uri: input.uri,
        outcome: input.outcome,
        severity: anomaly.severity,
        distinct_children: distinctChildren,
        frequency_met: distinctChildren >= 3
      },
      requiredConfirmations: distinctChildren >= 3 ? 3 : 1
    });

    const settled = await settleProposal(graphDb, proposed.proposal.key);
    if (!settled) return { ...NONE, anomaly: anomaly.anomaly_key };

    const body = {
      proposal: settled.proposal.key,
      status: settled.proposal.status,
      decision: settled.consensus.decision,
      decided_by: settled.consensus.decided_by,
      required_confirmations: settled.consensus.required_confirmations,
      // Two counts share this field on purpose: how many distinct children the framework
      // has seen involved, reporting OR confirming. A fresh proposal has no confirmations
      // yet but may already be backed by three reporting children — which is precisely
      // why `required_confirmations` is 3 here, so the report must explain itself instead
      // of saying "0 children" next to "3 confirmations needed".
      distinct_children: Math.max(settled.consensus.distinct_children, distinctChildren),
      anomaly: anomaly.anomaly_key,
      diagnostic: settled.diagnostic,
      apply_plan: settled.apply_plan
    };
    return { ...body, next_action: nextActionFor(body) };
  } catch (err) {
    structuredLogger.warn(
      `reward evolution: proposal write failed for ${anomaly.anomaly_key} — ${err instanceof Error ? err.message : String(err)}`
    );
    const diagnostic = err instanceof EvolutionIntegrityError
      ? err.diagnostic
      : { code: 'proposal_record_failed', recovery_action: 'Reload the anomaly and proposal before retrying; no settlement was verified.' };
    return { ...NONE, anomaly: anomaly.anomaly_key, diagnostic, next_action: `blocked: ${diagnostic.code}. ${diagnostic.recovery_action}` };
  }
}

/**
 * Scoped key of the child that supplies a confirmation's observation.
 *
 * Derived from the stored record behind the reward's layer URI — never from caller
 * text — so frequency evidence (`>= 3 distinct children`) counts real adapters. An
 * unattributable layer yields `null`, and the confirmation then carries no child at
 * all instead of inventing one.
 */
async function confirmationChild(qdrantService: QdrantService, uri: string): Promise<string | null> {
  try {
    const parsed = parseSquadrulesUriOrThrow(uri);
    if (parsed.kind !== 'layer') return null;
    const memory = await qdrantService.getMemoryByUUID(parsed.id);
    return storedAdapterKey(memory as { slug?: unknown; space_id?: unknown } | null);
  } catch {
    return null;
  }
}

/** Record the caller's confirmation and re-settle the proposal. */
export async function recordRewardProposalDecision(
  qdrantService: QdrantService,
  input: RewardInput
): Promise<RewardEvolutionReport | null> {
  const proposalKey = (input.proposal ?? '').trim();
  const decision = input.proposal_decision;
  if (!proposalKey || !decision) return null;

  const graphDb = getGraphDb(qdrantService);
  if (!graphDb || !graphDb.isInitialized()) {
    return { ...NONE, proposal: proposalKey, next_action: 'graph unavailable: the confirmation was not recorded' };
  }

  try {
    const evidence = input.proposal_evidence;
    // Ordinary reward feedback remains feedback, not empirical confirmation evidence.
    const child = await confirmationChild(qdrantService, input.uri);
    await confirmProposal(graphDb, {
      proposalKey,
      actorKind: input.proposal_actor_kind ?? 'agent',
      decision,
      ...(child !== null && { distinctChild: child }),
      ...(evidence !== undefined && { evidence })
    });
    const settled = await settleProposal(graphDb, proposalKey);
    if (!settled) {
      return { ...NONE, proposal: proposalKey, next_action: `proposal ${proposalKey} was not found` };
    }
    const body = {
      proposal: settled.proposal.key,
      status: settled.proposal.status,
      decision: settled.consensus.decision,
      decided_by: settled.consensus.decided_by,
      required_confirmations: settled.consensus.required_confirmations,
      distinct_children: settled.consensus.distinct_children,
      anomaly: settled.proposal.source_anomaly ?? null,
      diagnostic: settled.diagnostic,
      apply_plan: settled.apply_plan
    };
    return { ...body, next_action: nextActionFor(body) };
  } catch (err) {
    structuredLogger.warn(
      `reward evolution: decision on ${proposalKey} failed — ${err instanceof Error ? err.message : String(err)}`
    );
    const diagnostic = err instanceof EvolutionIntegrityError
      ? err.diagnostic
      : { code: 'proposal_decision_failed', recovery_action: 'Reload the proposal before retrying; confirmation or settlement persistence was not verified.' };
    return { ...NONE, proposal: proposalKey, diagnostic, next_action: `blocked: ${diagnostic.code}. ${diagnostic.recovery_action}` };
  }
}
