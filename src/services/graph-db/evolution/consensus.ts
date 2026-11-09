/**
 * Consensus evaluation for evolution proposals (ADR 0046).
 *
 * The ladder is the one resolved in
 * docs/specs/ontological-knowledge-system.md, Decision 5:
 * evidence → authorized human expert → two-thirds of distinct agents → branch.
 *
 * Two rules keep this honest:
 *   - **Distinct actors only.** A confirmer counted twice (same actor, same source)
 *     is one vote. Duplicate confirmations never manufacture quorum.
 *   - **Frequency is distinct children, not executions.** A frequency proposal
 *     needs three different children reporting the anomaly; one child confirming
 *     three times is still one child.
 *
 * Pure functions: no graph access, no I/O, no hashing of prose.
 */
import type { EvolutionProposalNode, ProposalConfirmation } from '../graph-types.js';

export type ConsensusDecision = 'accept' | 'reject' | 'pending' | 'branch';

export type EvidenceClass = 'evidence' | 'human_authority' | 'agent_vote' | 'none';

export interface ConsensusResult {
  decision: ConsensusDecision;
  evidence_class: EvidenceClass;
  /** Which input decided it — a short, auditable phrase. */
  decided_by: string;
  reason: string;
  required_confirmations: number;
  confirming_actors: string[];
  rejecting_actors: string[];
  distinct_children: number;
}

function actorId(confirmation: ProposalConfirmation): string {
  const actor = confirmation.actor.trim();
  // Identity, not the claimed label, is the voting unit. An authenticated subject is
  // identified by subject + kind; a runtime-local caller is ONE identity whatever kind
  // it claims, so flipping `agent` -> `human_expert` can never manufacture a second
  // vote (ADR 0046 provenance: a kind claim without an authenticated subject is not
  // authority, and it is not a second voter either).
  // Stable subject identity supersedes the earlier kind-qualified identity above.
  return confirmation.actor_source === 'auth-subject'
    ? `subject|${actor}`
    : `identity|${actor}`;
}

function hasEvidence(confirmation: ProposalConfirmation): boolean {
  const evidence = confirmation.evidence;
  // A feedback-only note remains a claim, not an empirical observation.
  // This exclusion does not define sufficient evidence or verify other payloads.
  return !!evidence && Object.keys(evidence).some((key) => key !== 'note');
}

/** A human expert claim only counts when the identity came from an authenticated subject. */
function isAuthorizedExpert(confirmation: ProposalConfirmation): boolean {
  return confirmation.actor_kind === 'human_expert' && confirmation.actor_source === 'auth-subject';
}

/** Distinct actor ids, preserving order of first appearance. */
function uniqueActors(rows: ProposalConfirmation[]): string[] {
  const seen = new Set<string>();
  const actors: string[] = [];
  for (const row of rows) {
    const id = actorId(row);
    if (seen.has(id)) continue;
    seen.add(id);
    actors.push(id);
  }
  return actors;
}

/** Minimum number of distinct agent confirmations that counts as a majority. */
export function voteThreshold(requiredConfirmations: number): number {
  const required = Math.max(requiredConfirmations, 2);
  return Math.max(2, Math.ceil((required * 2) / 3));
}

/** Distinct children that confirmed — frequency evidence, never execution count. */
export function distinctConfirmedChildren(confirmations: ProposalConfirmation[]): number {
  const children = new Set<string>();
  for (const confirmation of confirmations) {
    if (confirmation.decision !== 'confirm') continue;
    const child = (confirmation.distinct_child ?? '').trim();
    if (child.length > 0) children.add(child);
  }
  return children.size;
}

/** Evaluate one proposal against its confirmations. Pure. */
export function evaluateConsensus(
  proposal: EvolutionProposalNode,
  confirmations: ProposalConfirmation[]
): ConsensusResult {
  const relevant = confirmations.filter((row) => row.proposal_key === proposal.key);
  const confirming = relevant.filter((row) => row.decision === 'confirm');
  const rejecting = relevant.filter((row) => row.decision === 'reject');

  const confirmingActors = uniqueActors(confirming);
  const rejectingActors = uniqueActors(rejecting);
  const children = distinctConfirmedChildren(confirming);
  const required = Math.max(proposal.required_confirmations, 1);

  const evidenceConfirm = confirming.filter(hasEvidence);
  const evidenceReject = rejecting.filter(hasEvidence);
  const expertConfirm = confirming.filter(isAuthorizedExpert);
  const expertReject = rejecting.filter(isAuthorizedExpert);

  const base = {
    required_confirmations: required,
    confirming_actors: confirmingActors,
    rejecting_actors: rejectingActors,
    distinct_children: children
  };

  if (evidenceConfirm.length > 0 && evidenceReject.length > 0) {
    return {
      ...base,
      decision: 'branch',
      evidence_class: 'evidence',
      decided_by: 'conflicting evidence',
      reason:
        'confirming and rejecting confirmations both carry evidence — keep the parent unchanged and split the competing claims into a branch'
    };
  }
  if (evidenceConfirm.length > 0) {
    return {
      ...base,
      decision: 'accept',
      evidence_class: 'evidence',
      decided_by: `evidence from ${uniqueActors(evidenceConfirm).join(', ')}`,
      reason: 'empirical evidence outranks opinion and authority'
    };
  }
  if (evidenceReject.length > 0) {
    return {
      ...base,
      decision: 'reject',
      evidence_class: 'evidence',
      decided_by: `evidence from ${uniqueActors(evidenceReject).join(', ')}`,
      reason: 'empirical evidence contradicts the proposal — the parent stays unchanged'
    };
  }
  if (expertConfirm.length > 0) {
    return {
      ...base,
      decision: 'accept',
      evidence_class: 'human_authority',
      decided_by: `human expert ${uniqueActors(expertConfirm).join(', ')}`,
      reason: 'an authenticated human expert authorized the change'
    };
  }
  if (expertReject.length > 0) {
    return {
      ...base,
      decision: 'reject',
      evidence_class: 'human_authority',
      decided_by: `human expert ${uniqueActors(expertReject).join(', ')}`,
      reason: 'an authenticated human expert rejected the change'
    };
  }

  if (required <= 1) {
    if (confirmingActors.length >= 1) {
      return {
        ...base,
        decision: 'accept',
        evidence_class: 'agent_vote',
        decided_by: `core contradiction confirmed by ${confirmingActors.join(', ')}`,
        reason: 'a core contradiction needs one confirming observation'
      };
    }
    return {
      ...base,
      decision: rejectingActors.length > 0 ? 'reject' : 'pending',
      evidence_class: 'none',
      decided_by: rejectingActors.length > 0 ? 'rejection without evidence' : 'no confirmation yet',
      reason:
        rejectingActors.length > 0
          ? 'the only recorded observation rejects the proposal'
          : 'the proposal is recorded; no confirmation has been observed yet'
    };
  }

  const threshold = voteThreshold(required);
  const childrenSatisfied = children >= 3;
  if (confirmingActors.length >= threshold && childrenSatisfied) {
    return {
      ...base,
      decision: 'accept',
      evidence_class: 'agent_vote',
      decided_by: `${confirmingActors.length} distinct agents (${children} distinct children)`,
      reason: 'at least two thirds of the required distinct agents confirmed'
    };
  }
  if (rejectingActors.length >= confirmingActors.length && rejectingActors.length > 0) {
    return {
      ...base,
      decision: 'branch',
      evidence_class: 'none',
      decided_by: `${rejectingActors.length} rejecting vs ${confirmingActors.length} confirming`,
      reason: 'participants disagree without deciding evidence — create a sub-category branch instead of changing the parent'
    };
  }
  return {
    ...base,
    decision: 'pending',
    evidence_class: 'none',
    decided_by: 'quorum not reached',
    reason: childrenSatisfied
      ? `needs ${threshold} distinct agent confirmations; ${confirmingActors.length} recorded`
      : `needs 3 distinct children reporting the anomaly; ${children} recorded`
  };
}
