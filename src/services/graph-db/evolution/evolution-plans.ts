/**
 * The actionable apply plan an accepted evolution proposal hands back to its
 * caller (ADR 0046). Applying stays in the normal `tune` path; nothing here
 * writes to an Adapter node.
 *
 * Extracted from `evolution.service.ts` to keep per-file line counts within
 * the ESLint `max-lines` budget; behavior is unchanged.
 */
import type { EvolutionProposalNode } from '../graph-types.js';
import { adapterGraphKey } from '../adapter-scope.js';

/** What the caller must run to apply an accepted proposal — never a hidden write. */
export interface EvolutionApplyPlan {
  target_uri: string;
  target_key: string;
  target_space: string;
  expected_version: string;
  field: string;
  from_value: string | null;
  to_value: string;
  instructions: string;
}

/** Build the actionable apply plan an accepted proposal hands back to its caller. */
export function buildApplyPlan(proposal: EvolutionProposalNode): EvolutionApplyPlan | null {
  const expected = proposal.evidence['target_adapter_version'];
  const expectedVersion = typeof expected === 'string' && expected.trim().length > 0 ? expected.trim() : null;
  if (expectedVersion === null || !proposal.space.trim() || !proposal.target_slug.trim() ||
      proposal.target_key !== adapterGraphKey(proposal.space, proposal.target_slug)) return null;
  return {
    target_uri: `squadrules://adapter/${proposal.target_slug}`,
    target_key: proposal.target_key,
    target_space: proposal.space,
    expected_version: expectedVersion,
    field: proposal.field,
    from_value: proposal.from_value,
    to_value: proposal.to_value,
    instructions:
      `apply through normal tune of ${`squadrules://adapter/${proposal.target_slug}`}: change \`${proposal.field}\` ` +
      `from ${proposal.from_value === null ? '(absent)' : `\`${proposal.from_value}\``} to \`${proposal.to_value}\`; ` +
      `tune in space ${proposal.space} with expected_version ${expectedVersion} so a moved parent surfaces as a version conflict instead of a silent overwrite.`
  };
}
