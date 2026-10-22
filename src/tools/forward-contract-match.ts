import type { ProofOfWorkDefinition } from '../types/memory.js';

/** Forward-link target regex: squadrules://adapter/<slug>. */
const ADAPTER_FORWARD_LINK_URI = /^squadrules:\/\/adapter\/[^\s/]+$/;

export type ForwardContractValidation =
  | { ok: true }
  | { ok: false; code: 'FORWARD_TARGET_MISMATCH'; message: string };

/**
 * Validate a forward submission against the contract's forward.target.
 * Compares proof.forward.target against the submitted evidence.target,
 * requiring the adapter-URI scheme. A single code covers every way the
 * submitted target can fail to be the contracted one: absent, wrong scheme,
 * or a different slug (ADR 0028).
 */
export function validateForwardSubmissionAgainstContract(
  proof: ProofOfWorkDefinition,
  // The submitted forward evidence. `target` is optional here because an absent
  // target is one of the mismatch cases this function must report, and `success`
  // rides along on the caller's payload without affecting target matching.
  submitted: { target?: string; success?: boolean }
): ForwardContractValidation {
  if (proof.type !== 'forward' || !proof.forward) {
    return { ok: true };
  }
  const expectedTarget = proof.forward.target;
  if (!expectedTarget) {
    return { ok: true };
  }
  if (!submitted.target) {
    return {
      ok: false,
      code: 'FORWARD_TARGET_MISMATCH',
      message: `Forward target must match the contract (expected "${expectedTarget}", got no target). Submit evidence.target with the adapter URI you forwarded to.`
    };
  }
  if (!ADAPTER_FORWARD_LINK_URI.test(submitted.target)) {
    return {
      ok: false,
      code: 'FORWARD_TARGET_MISMATCH',
      message: `Forward target must be a valid adapter URI (squadrules://adapter/<slug>), got "${submitted.target}".`
    };
  }
  if (submitted.target !== expectedTarget) {
    return {
      ok: false,
      code: 'FORWARD_TARGET_MISMATCH',
      message: `Forward target must match the contract (expected "${expectedTarget}", got "${submitted.target}").`
    };
  }
  return { ok: true };
}
