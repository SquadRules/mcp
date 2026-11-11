/**
 * Proposal records for evidence-gated evolution (ADR 0046): the bounded
 * integrity diagnostic, proposal/confirmation input shapes, deterministic
 * proposal identity, and proposal-node construction.
 *
 * Extracted from `evolution.service.ts` to keep per-file line counts within
 * the ESLint `max-lines` budget; behavior is unchanged.
 */
import type { EvolutionProposalNode } from '../graph-types.js';
import { resolveGraphActor } from '../graph-actor.js';
import { sha256Hex } from '../../../utils/sha256.js';

export interface EvolutionIntegrityDiagnostic {
  code: string;
  recovery_action: string;
}

/** Bounded diagnostics, not backend exception text or proof of rollback. */
export class EvolutionIntegrityError extends Error {
  readonly diagnostic: EvolutionIntegrityDiagnostic;

  constructor(code: string, recoveryAction: string) {
    super(code);
    this.name = 'EvolutionIntegrityError';
    this.diagnostic = { code, recovery_action: recoveryAction };
  }
}

/**
 * Stable code for the deferred expert rung of the consensus ladder (ADR 0046 §5 and its
 * Clarification of 2026-11-11).
 *
 * WHY THIS IS A DEFERRAL AND NOT A VALIDATION FAILURE
 * Rung 2 needs a trusted runtime source of expert-role authority. The runtime resolves
 * an authenticated *subject*, never a role, and a `human_expert` label carried by the
 * caller is exactly the spoof the ladder exists to reject (ADR 0046, Alternatives). So
 * the rung fails closed with this code until a role mapping is trusted — instead of
 * silently downgrading an expert claim into an agent vote, which would let a caller
 * choose which rung reads their confirmation.
 */
export const EXPERT_AUTHORITY_DEFERRED = 'expert_authority_deferred' as const;

/**
 * Claim identity a failed reward reports.
 *
 * WHY A SHARED CONSTANT
 * One failed-reward row is three things at once: the anomaly's contested field, the
 * proposal's field, and the frequency target the consensus rung counts. If those three
 * spell the claim differently, a count about a different claim decides the proposal.
 * `reward-anomaly.ts` records it on the row and `reward-evolution.ts` proposes and
 * counts it, so the name lives with the proposal record both read.
 */
export const REWARD_FAILURE_CLAIM = 'reward_failure';

/** The authority the runtime does not have, and therefore cannot check. */
export type ExpertAuthorityDeferralReason = 'no-trusted-expert-role-source';

/** Structured deferral, so callers and tests assert a value rather than a message. */
export interface ExpertAuthorityDeferral {
  code: typeof EXPERT_AUTHORITY_DEFERRED;
  /** Why the rung is unreachable today. */
  reason: ExpertAuthorityDeferralReason;
  /** The rung that activates unchanged once a trusted role mapping exists. */
  consensus_rung: 'authorized-human-expert';
  /** The actionable half, surfaced through the diagnostic the caller already reads. */
  recovery_action: string;
}

/** The single recorded deferral. Kept as data so the rung is describable, not inferred. */
export const EXPERT_AUTHORITY_DEFERRAL: ExpertAuthorityDeferral = {
  code: EXPERT_AUTHORITY_DEFERRED,
  reason: 'no-trusted-expert-role-source',
  consensus_rung: 'authorized-human-expert',
  recovery_action:
    'Record this confirmation as an agent, or add a trusted runtime expert-role mapping before claiming expert authority.'
};

/**
 * Refusal of an expert-authority claim. Distinct type on purpose: callers can tell
 * "this rung is deferred" from "this record is invalid" without string matching.
 */
export class ExpertAuthorityDeferredError extends EvolutionIntegrityError {
  readonly deferral: ExpertAuthorityDeferral;

  constructor(deferral: ExpertAuthorityDeferral = EXPERT_AUTHORITY_DEFERRAL) {
    super(deferral.code, deferral.recovery_action);
    this.name = 'ExpertAuthorityDeferredError';
    this.deferral = deferral;
  }
}

/** Input for recording one proposal. */
export interface ProposeChangeInput {
  targetKey: string;
  targetSlug: string;
  space: string;
  changeType: EvolutionProposalNode['change_type'];
  field: string;
  fromValue: string | null;
  toValue: string;
  reason: string;
  /** Scoped child key that raised the proposal. One proposal per child/field/change. */
  sourceChild: string;
  sourceAnomaly?: string;
  evidence: Record<string, unknown>;
  requiredConfirmations: number;
}

/** Deterministic proposal identity: the same child raising the same change collapses. */
export function proposalKey(targetKey: string, field: string, sourceChild: string, toValue: string): string {
  const digest = sha256Hex([targetKey, field, sourceChild, toValue].join('\u0000')).slice(0, 32);
  return `proposal:${digest}`;
}

/** Build the stored proposal row from its input, stamping actor and evidence digest. */
export function proposalNode(key: string, input: ProposeChangeInput): EvolutionProposalNode {
  const actor = resolveGraphActor();
  const serialized = JSON.stringify(input.evidence);
  const node: EvolutionProposalNode = {
    key,
    type: 'proposal',
    target_key: input.targetKey,
    target_slug: input.targetSlug,
    space: input.space,
    change_type: input.changeType,
    field: input.field,
    from_value: input.fromValue,
    to_value: input.toValue,
    reason: input.reason,
    source_child: input.sourceChild,
    evidence: input.evidence,
    evidence_digest: sha256Hex(serialized),
    status: 'proposed',
    created_at: new Date().toISOString(),
    created_by: actor.actor,
    actor_source: actor.actor_source,
    required_confirmations: Math.max(input.requiredConfirmations, 1)
  };
  if (input.sourceAnomaly) node.source_anomaly = input.sourceAnomaly;
  return node;
}

/** One confirmation from an actor that is not the proposal's author. */
export interface ConfirmProposalInput {
  proposalKey: string;
  actorKind: 'agent' | 'human_expert';
  decision: 'confirm' | 'reject';
  /** Child that supplies the observation; drives frequency evidence. */
  distinctChild?: string;
  evidence?: Record<string, unknown>;
}
