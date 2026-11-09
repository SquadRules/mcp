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
