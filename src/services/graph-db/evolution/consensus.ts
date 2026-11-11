/**
 * Consensus evaluation for evolution proposals (ADR 0046).
 *
 * The ladder is the one resolved in
 * docs/specs/ontological-knowledge-system.md, Decision 5:
 * evidence → authorized human expert → two-thirds of distinct agents → branch.
 *
 * Three rules keep this honest:
 *   - **Distinct actors only.** A confirmer counted twice (same actor, same source)
 *     is one vote. Duplicate confirmations never manufacture quorum.
 *   - **Frequency is distinct children, not executions.** A frequency proposal
 *     needs three different children reporting the anomaly; one child confirming
 *     three times is still one child.
 *   - **Evidence must be checkable.** The evidence rung reads only evidence the
 *     framework itself can produce — a deterministic detector result or a recorded
 *     reward failure — and only with its provenance. Any other payload is attached
 *     to the record and echoed, but it never decides (see
 *     `EVIDENCE_SUFFICIENCY_ALLOWLIST`).
 *
 * Pure functions: no graph access, no I/O, no hashing of prose.
 */
import type { EvolutionProposalNode, ProposalConfirmation } from '../graph-types.js';

export type ConsensusDecision = 'accept' | 'reject' | 'pending' | 'branch';

export type EvidenceClass = 'evidence' | 'human_authority' | 'agent_vote' | 'none';

/** Evidence kinds the framework itself can produce, and therefore verify. */
export type EvidenceSufficiencyKind = 'deterministic-contradiction' | 'reward-failure';

/**
 * How much authority one confirmation's evidence payload carries.
 *
 * `absent` and `attached-unverified` are deliberately distinct: a bare vote attached
 * nothing, while an unverified payload was attached and must be reported as
 * recorded-but-not-counted rather than silently ignored.
 */
export type EvidenceSufficiency = 'absent' | 'attached-unverified' | 'verified-sufficient';

/** One provenance field a recognized kind must carry. */
export interface EvidenceProvenanceRequirement {
  /** Accepted literal values; omitted means "any non-empty string". */
  oneOf?: readonly string[];
}

/** What a recognized kind asserts, and what a confirmation must carry to claim it. */
export interface EvidenceKindContract {
  /** The observation the kind stands for — never a free-text opinion. */
  asserts: string;
  /** Provenance without which the claim is not checkable. */
  requires: Readonly<Record<string, EvidenceProvenanceRequirement>>;
}

/**
 * The evidence rung's sufficiency contract (ADR 0046, Clarification 2026-11-11).
 *
 * WHY AN ALLOWLIST AND NOT "ANY KEY OTHER THAN note"
 * The rung used to fire on any object carrying a key other than `note`, so one
 * caller-shaped dictionary could decide a proposal before a single vote was read. Only
 * two kinds are producible by something other than the claimant — the deterministic
 * detector (`adapter-evolution-hooks.ts`) and a recorded reward failure
 * (`reward-evolution.ts`) — so only those are accepted, and only with the provenance
 * that makes the observation checkable. Every other payload stays attached and never
 * decides.
 */
export const EVIDENCE_SUFFICIENCY_ALLOWLIST: Readonly<Record<EvidenceSufficiencyKind, EvidenceKindContract>> = {
  'deterministic-contradiction': {
    asserts: 'a primitive domain property or an opposing rule statement differs from the stored parent',
    requires: {
      detected_from: {},
      contradiction_kind: { oneOf: ['property', 'rule'] },
      target_adapter_version: {}
    }
  },
  'reward-failure': {
    asserts: 'a reward proof recorded a failure for the target adapter',
    requires: {
      uri: {},
      outcome: { oneOf: ['failure'] },
      target_adapter_version: {}
    }
  }
};

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
  /**
   * Confirmations that attached evidence the allowlist does not verify. They are
   * recorded and echoed, never counted: a proposal cannot be decided by a payload
   * whose provenance nothing checked.
   */
  attached_unverified_evidence: string[];
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Classify a confirmation's evidence against `EVIDENCE_SUFFICIENCY_ALLOWLIST`.
 *
 * Three outcomes, because they mean three different things to a reader: nothing was
 * attached, something was attached that is not checkable (a note, an arbitrary
 * dictionary, a recognized kind missing or abusing its provenance), or something was
 * attached that the framework can verify. A feedback-only note therefore remains a
 * claim, and an arbitrary structured claim is no longer mistaken for an observation.
 */
export function classifyEvidence(evidence: Record<string, unknown> | undefined): EvidenceSufficiency {
  if (!evidence || Object.keys(evidence).length === 0) return 'absent';
  const kind = evidence['kind'];
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(EVIDENCE_SUFFICIENCY_ALLOWLIST, kind)) {
    return 'attached-unverified';
  }
  const { requires } = EVIDENCE_SUFFICIENCY_ALLOWLIST[kind as EvidenceSufficiencyKind];
  for (const [field, requirement] of Object.entries(requires)) {
    const value = evidence[field];
    if (!isNonEmptyString(value)) return 'attached-unverified';
    if (requirement.oneOf && !requirement.oneOf.includes(value.trim().toLowerCase())) return 'attached-unverified';
  }
  return 'verified-sufficient';
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

  const evidenceConfirm = confirming.filter((row) => classifyEvidence(row.evidence) === 'verified-sufficient');
  const evidenceReject = rejecting.filter((row) => classifyEvidence(row.evidence) === 'verified-sufficient');
  const attached = uniqueActors(relevant.filter((row) => classifyEvidence(row.evidence) === 'attached-unverified'));
  const expertConfirm = confirming.filter(isAuthorizedExpert);
  const expertReject = rejecting.filter(isAuthorizedExpert);

  const base = {
    required_confirmations: required,
    confirming_actors: confirmingActors,
    rejecting_actors: rejectingActors,
    distinct_children: children,
    attached_unverified_evidence: attached
  };

  // Attached-but-unverified evidence is echoed with the outcome it did not decide, so a
  // caller who sent an unrecognized payload learns why the ladder ignored it instead of
  // reading a "no evidence" verdict about evidence they can see in their own request.
  const noted = (reason: string): string =>
    attached.length === 0
      ? reason
      : `${reason}; evidence from ${attached.join(', ')} is attached but not verified-sufficient, so it did not decide`;

  if (evidenceConfirm.length > 0 && evidenceReject.length > 0) {
    return {
      ...base,
      decision: 'branch',
      evidence_class: 'evidence',
      decided_by: 'conflicting verified evidence',
      reason:
        'confirming and rejecting confirmations both carry evidence that meets the sufficiency allowlist — keep the parent unchanged and split the competing claims into a branch'
    };
  }
  if (evidenceConfirm.length > 0) {
    return {
      ...base,
      decision: 'accept',
      evidence_class: 'evidence',
      decided_by: `verified evidence from ${uniqueActors(evidenceConfirm).join(', ')}`,
      reason: 'evidence that meets the sufficiency allowlist outranks opinion and authority'
    };
  }
  if (evidenceReject.length > 0) {
    return {
      ...base,
      decision: 'reject',
      evidence_class: 'evidence',
      decided_by: `verified evidence from ${uniqueActors(evidenceReject).join(', ')}`,
      reason: 'evidence that meets the sufficiency allowlist contradicts the proposal — the parent stays unchanged'
    };
  }
  if (expertConfirm.length > 0) {
    return {
      ...base,
      decision: 'accept',
      evidence_class: 'human_authority',
      decided_by: `human expert ${uniqueActors(expertConfirm).join(', ')}`,
      reason: noted('an authenticated human expert authorized the change')
    };
  }
  if (expertReject.length > 0) {
    return {
      ...base,
      decision: 'reject',
      evidence_class: 'human_authority',
      decided_by: `human expert ${uniqueActors(expertReject).join(', ')}`,
      reason: noted('an authenticated human expert rejected the change')
    };
  }

  if (required <= 1) {
    if (confirmingActors.length >= 1) {
      return {
        ...base,
        decision: 'accept',
        evidence_class: 'agent_vote',
        decided_by: `core contradiction confirmed by ${confirmingActors.join(', ')}`,
        reason: noted('a core contradiction needs one confirming observation')
      };
    }
    return {
      ...base,
      decision: rejectingActors.length > 0 ? 'reject' : 'pending',
      evidence_class: 'none',
      decided_by: rejectingActors.length > 0 ? 'rejection without evidence' : 'no confirmation yet',
      reason: noted(
        rejectingActors.length > 0
          ? 'the only recorded observation rejects the proposal'
          : 'the proposal is recorded; no confirmation has been observed yet'
      )
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
      reason: noted('at least two thirds of the required distinct agents confirmed')
    };
  }
  if (rejectingActors.length >= confirmingActors.length && rejectingActors.length > 0) {
    return {
      ...base,
      decision: 'branch',
      evidence_class: 'none',
      decided_by: `${rejectingActors.length} rejecting vs ${confirmingActors.length} confirming`,
      reason: noted('participants disagree without deciding evidence — create a sub-category branch instead of changing the parent')
    };
  }
  return {
    ...base,
    decision: 'pending',
    evidence_class: 'none',
    decided_by: 'quorum not reached',
    reason: noted(
      childrenSatisfied
        ? `needs ${threshold} distinct agent confirmations; ${confirmingActors.length} recorded`
        : `needs 3 distinct children reporting the anomaly; ${children} recorded`
    )
  };
}
