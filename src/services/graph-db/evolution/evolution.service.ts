/**
 * Evidence-gated evolution orchestration (ADR 0046).
 *
 * A proposal is a **verifiable record**, never a mutation: it stores the target,
 * the field, the from/to values, the unique source child, and a digest over its
 * evidence. `apply` is performed by the normal `train`/`tune` path against the
 * parent's current version, so the existing validators still run and a version
 * conflict is still actionable. Nothing here rewrites an Adapter node.
 *
 * The digest proves the evidence bytes were not edited after the fact. It does
 * not prove the claim is true; truthfulness is what the consensus ladder is for.
 */
import type { GraphRepository } from '../graph-repository.js';
import type {
  AdapterNode,
  EvolutionProposalNode,
  ProposalConfirmation,
  ProposalStatus
} from '../graph-types.js';
import { resolveGraphActor } from '../graph-actor.js';
import { adapterGraphKey, parseAdapterGraphKey } from '../adapter-scope.js';
import { getSpaceContextFromStorage } from '../../../utils/tenant-context.js';
import { sha256Hex } from '../../../utils/sha256.js';
import { structuredLogger } from '../../../utils/structured-logger.js';
import { evaluateConsensus, type ConsensusResult } from './consensus.js';
import {
  EvolutionIntegrityError,
  ExpertAuthorityDeferredError,
  EXPERT_AUTHORITY_DEFERRED,
  EXPERT_AUTHORITY_DEFERRAL,
  REWARD_FAILURE_CLAIM,
  proposalKey,
  proposalNode,
  type ConfirmProposalInput,
  type EvolutionIntegrityDiagnostic,
  type ExpertAuthorityDeferral,
  type ExpertAuthorityDeferralReason,
  type ProposeChangeInput
} from './evolution-proposal-record.js';
import { buildApplyPlan, type EvolutionApplyPlan } from './evolution-plans.js';

export {
  EvolutionIntegrityError,
  ExpertAuthorityDeferredError,
  EXPERT_AUTHORITY_DEFERRED,
  EXPERT_AUTHORITY_DEFERRAL,
  REWARD_FAILURE_CLAIM,
  proposalKey,
  buildApplyPlan
};
export type {
  EvolutionIntegrityDiagnostic,
  ExpertAuthorityDeferral,
  ExpertAuthorityDeferralReason,
  ProposeChangeInput,
  ConfirmProposalInput,
  EvolutionApplyPlan
};

/** Use the existing scoped graph read and request access, never an invented target. */
export async function loadEvolutionTarget(
  graphDb: GraphRepository,
  key: string,
  slug: string,
  space: string
): Promise<AdapterNode> {
  if (!space.trim() || !slug.trim() || key !== adapterGraphKey(space, slug)) {
    throw new EvolutionIntegrityError('target_scope_mismatch', 'Reload the proposal with its exact scoped target.');
  }
  if (!getSpaceContextFromStorage().allowedSpaceIds.includes(space)) {
    throw new EvolutionIntegrityError('scope_forbidden', 'Use an existing authorized context for the proposal scope.');
  }
  let target: AdapterNode | null;
  try {
    target = await graphDb.getAdapter(key);
  } catch {
    throw new EvolutionIntegrityError('target_unavailable', 'Restore target reads, then reload before settling.');
  }
  if (!target) {
    throw new EvolutionIntegrityError('target_missing', 'Reload the stored target and its graph projection before settling.');
  }
  if (target.key !== key || target.slug !== slug || target.space !== space) {
    throw new EvolutionIntegrityError('target_scope_mismatch', 'Reconcile the scoped target projection before settling.');
  }
  if (typeof target.version !== 'string' || !target.version.trim()) {
    throw new EvolutionIntegrityError('target_version_missing', 'Reload a target with an observed stored version before settling.');
  }
  return target;
}

/**
 * Record a proposal. Returns the existing row when the same child already raised
 * the same change, so retries are idempotent and never duplicate.
 */
export async function proposeChange(
  graphDb: GraphRepository,
  input: ProposeChangeInput
): Promise<{ proposal: EvolutionProposalNode; created: boolean }> {
  const key = proposalKey(input.targetKey, input.field, input.sourceChild, input.toValue);
  const existing = await graphDb.getProposal(key);
  if (existing) return { proposal: existing, created: false };

  const proposal = proposalNode(key, input);
  try {
    await graphDb.createProposal(proposal);
    return { proposal, created: true };
  } catch (err) {
    // A concurrent writer may have created the same deterministic key. Re-read it.
    const raced = await graphDb.getProposal(key);
    if (raced) return { proposal: raced, created: false };
    throw err;
  }
}

/** Record a confirmation. Duplicate actors collapse at consensus time. */
export async function confirmProposal(
  graphDb: GraphRepository,
  input: ConfirmProposalInput
): Promise<ProposalConfirmation> {
  const actor = resolveGraphActor();
  const proposal = await graphDb.getProposal(input.proposalKey);
  if (!proposal || proposal.key !== input.proposalKey) {
    throw new EvolutionIntegrityError('proposal_missing', 'Reload an existing proposal before confirming.');
  }
  if (proposal.status !== 'proposed') {
    throw new EvolutionIntegrityError('proposal_not_pending', 'Reload the durable settlement; do not confirm a terminal proposal.');
  }
  if (actor.actor_source !== 'auth-subject' || !actor.actor.trim()) {
    throw new EvolutionIntegrityError('authenticated_subject_required', 'Confirm only with a stable runtime-authenticated subject.');
  }
  if (actor.actor.trim() === proposal.created_by.trim()) {
    throw new EvolutionIntegrityError('self_confirmation_forbidden', 'A different authenticated subject must supply the confirmation.');
  }
  if (input.actorKind !== 'agent') {
    // WHY A STRUCTURED DEFERRAL RATHER THAN A SILENT DOWNGRADE
    // The ladder's second rung (consensus.ts) is intact and would count an
    // `auth-subject` + `human_expert` confirmation, but nothing in the runtime proves the
    // subject holds an expert role: identity is authenticated, authority is not. Accepting
    // the caller's own label is the spoof ADR 0046 rejects, and recording the claim as an
    // agent vote would let the caller pick which rung reads it. Fail closed with a stable
    // code the caller can branch on; a future trusted role mapping activates the rung
    // without touching this ladder.
    throw new ExpertAuthorityDeferredError();
  }
  const target = await loadEvolutionTarget(graphDb, proposal.target_key, proposal.target_slug, proposal.space);
  const childScope = parseAdapterGraphKey(input.distinctChild ?? '');
  if (!childScope || childScope.spaceId !== proposal.space) {
    throw new EvolutionIntegrityError('confirmation_scope_mismatch', 'Use a stored observation child in the same proposal scope.');
  }
  const child = await graphDb.getAdapter(input.distinctChild!);
  if (!child || child.key !== input.distinctChild || child.slug !== childScope.slug || child.space !== proposal.space) {
    throw new EvolutionIntegrityError('confirmation_child_missing', 'Reload the stored observation child before confirming.');
  }
  const related = child.key === target.key
    ? proposal.source_child === target.key
    : (await graphDb.findPathToRoot(child.key)).some((row) => row.ancestor.key === target.key);
  if (!related) {
    throw new EvolutionIntegrityError('confirmation_child_unrelated', 'Confirm only from a child related to the exact scoped target.');
  }
  // Evidence belongs to the record identity: a confirmation that later supplies proof is
  // a new row, not a duplicate of the bare vote. Consensus still collapses votes by actor,
  // so this can make the evidence rung reachable but can never inflate the quorum.
  const evidenceMaterial = input.evidence ? JSON.stringify(input.evidence) : '';
  const key = `confirmation:${sha256Hex(
    [input.proposalKey, actor.actor, input.decision, evidenceMaterial].join('\u0000')
  ).slice(0, 32)}`;
  const confirmation: ProposalConfirmation = {
    key,
    type: 'confirmation',
    proposal_key: input.proposalKey,
    actor: actor.actor,
    actor_kind: input.actorKind,
    actor_source: actor.actor_source,
    decision: input.decision,
    created_at: new Date().toISOString()
  };
  if (input.distinctChild) confirmation.distinct_child = input.distinctChild;
  if (input.evidence) confirmation.evidence = input.evidence;
  await graphDb.recordConfirmation(confirmation);
  return confirmation;
}

/** Read a proposal with its consensus verdict. */
export async function loadConsensus(
  graphDb: GraphRepository,
  proposalKeyValue: string
): Promise<{ proposal: EvolutionProposalNode; consensus: ConsensusResult } | null> {
  const proposal = await graphDb.getProposal(proposalKeyValue);
  if (!proposal || proposal.key !== proposalKeyValue) return null;
  const confirmations = await graphDb.listConfirmations(proposalKeyValue);
  return { proposal, consensus: evaluateConsensus(proposal, confirmations) };
}

/**
 * Settle a proposal that consensus has decided.
 *
 * Accepted/rejected/branched all persist the outcome on the proposal; none of them
 * touch the parent adapter. The returned plan is the only way to apply an accepted
 * change, and it runs through `tune`.
 */
export async function settleProposal(
  graphDb: GraphRepository,
  proposalKeyValue: string
): Promise<{
  proposal: EvolutionProposalNode;
  consensus: ConsensusResult;
  apply_plan: EvolutionApplyPlan | null;
  diagnostic: EvolutionIntegrityDiagnostic | null;
} | null> {
  const loaded = await loadConsensus(graphDb, proposalKeyValue);
  if (!loaded) return null;
  const { proposal, consensus } = loaded;

  const status: ProposalStatus | null =
    consensus.decision === 'accept'
      ? 'accepted'
      : consensus.decision === 'reject'
        ? 'rejected'
        : consensus.decision === 'branch'
          ? 'branched'
          : null;

  // Keep the last observed row: a failed write/readback cannot certify new status.
  const observed = { ...proposal };
  const blocked = (diagnostic: EvolutionIntegrityDiagnostic, lastObserved = observed) => ({
    proposal: lastObserved,
    consensus: {
      ...consensus,
      decision: 'pending' as const,
      evidence_class: 'none' as const,
      decided_by: diagnostic.code,
      reason: diagnostic.recovery_action
    },
    apply_plan: null,
    diagnostic
  });
  if (status && !getSpaceContextFromStorage().allowedSpaceIds.includes(proposal.space)) {
    return blocked({ code: 'scope_forbidden', recovery_action: 'Use an existing authorized context for the proposal scope; no settlement was written.' });
  }
  if (status && proposal.status !== 'proposed' && proposal.status !== status) {
    return blocked({ code: 'settlement_conflict', recovery_action: 'Reload the terminal proposal; no replacement settlement was written.' });
  }
  let plan: EvolutionApplyPlan | null = null;
  if (status === 'accepted') {
    try {
      const target = await loadEvolutionTarget(graphDb, proposal.target_key, proposal.target_slug, proposal.space);
      plan = buildApplyPlan(proposal);
      if (!plan) {
        throw new EvolutionIntegrityError('target_version_missing', 'The proposal lacks an observed target version; rebase it before settling.');
      }
      if (plan.expected_version !== target.version) {
        throw new EvolutionIntegrityError('target_version_conflict', 'Rebase the proposal against the current scoped target version.');
      }
    } catch (err) {
      if (err instanceof EvolutionIntegrityError) return blocked(err.diagnostic);
      throw err;
    }
  }
  let settled = observed;
  if (status && status !== proposal.status) {
    try {
      await graphDb.updateProposalStatus(proposal.key, status, {
        consensus: consensus.decision,
        decided_by: consensus.decided_by,
        settled_at: new Date().toISOString()
      });
    } catch (err) {
      structuredLogger.warn(
        `evolution: proposal ${proposal.key} status update failed — ${err instanceof Error ? err.message : String(err)}`
      );
      return blocked({ code: 'settlement_persistence_failed', recovery_action: 'No durable settlement was verified. Reload the proposal before retrying; the returned status is the last observed state.' });
    }
    let persisted: EvolutionProposalNode | null;
    try {
      persisted = await graphDb.getProposal(proposal.key);
    } catch {
      return blocked({ code: 'settlement_unverified', recovery_action: 'Restore proposal reads and reload; the status write may have persisted, but no apply plan is authorized.' });
    }
    if (!persisted || persisted.key !== proposal.key || persisted.status !== status ||
        persisted.target_key !== proposal.target_key || persisted.space !== proposal.space ||
        persisted.target_slug !== proposal.target_slug || persisted.field !== proposal.field ||
        persisted.from_value !== proposal.from_value || persisted.to_value !== proposal.to_value ||
        persisted.source_child !== proposal.source_child || persisted.evidence_digest !== proposal.evidence_digest ||
        persisted.evidence['target_adapter_version'] !== proposal.evidence['target_adapter_version']) {
      return blocked({ code: 'settlement_conflict', recovery_action: 'Reload the proposal: settlement readback did not match the requested status and change. No apply plan was emitted.' });
    }
    settled = persisted;
  }

  if (plan) {
    // This detects observed drift, not an atomic settlement/adapter transaction.
    try {
      const target = await loadEvolutionTarget(graphDb, settled.target_key, settled.target_slug, settled.space);
      if (target.version !== plan.expected_version) {
        throw new EvolutionIntegrityError('target_version_conflict', 'Target moved during settlement. Reload and rebase before applying; no adapter write was performed.');
      }
    } catch (err) {
      if (err instanceof EvolutionIntegrityError) return blocked(err.diagnostic, settled);
      throw err;
    }
  }
  return { proposal: settled, consensus, apply_plan: plan, diagnostic: null };
}

/** Record that an accepted proposal was applied (or deliberately abandoned). */
export async function resolveProposal(
  graphDb: GraphRepository,
  proposalKeyValue: string,
  resolution: 'applied' | 'superseded' | 'abandoned',
  note: string
): Promise<void> {
  const proposal = await graphDb.getProposal(proposalKeyValue);
  if (!proposal) return;
  try {
    await graphDb.updateProposalStatus(proposal.key, proposal.status, {
      resolution,
      resolution_note: note,
      resolved_at: new Date().toISOString()
    });
  } catch (err) {
    structuredLogger.warn(
      `evolution: proposal ${proposal.key} resolution note failed — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
