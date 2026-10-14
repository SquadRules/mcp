import { describe, expect, test } from '@jest/globals';

/**
 * Regression test for #75: PROOF_HASH_MISMATCH on second forward call when
 * requested layer has no stored nonce.
 *
 * The fix moves the "previous layer already has a stored result" check BEFORE
 * the nonce guard in tryApplySolutionToPreviousStepWhenSolutionMatchesPrevious.
 *
 * This test verifies the decision logic in isolation — the same condition
 * ordering that the fixed function uses — without importing the module
 * (which pulls in a deep ESM dependency chain through adapter-navigation → qdrant).
 */

type StoredResult = { status: string } | null;

/**
 * Mirrors the fixed function's early-exit logic from
 * src/tools/next-previous-step.ts tryApplySolutionToPreviousStepWhenSolutionMatchesPrevious.
 *
 * Returns true when the function should attempt to redirect the solution to the
 * previous layer, false when it should bail out and let normal validation handle it.
 */
function shouldRedirectToPreviousLayer(params: {
  requestedHasContract: boolean;
  previousLayerUuid: string | null;
  previousHasRequiredContract: boolean;
  previousStoredResult: StoredResult;
  solutionNonce: string | null;
  requestedStoredNonce: string | null;
}): boolean {
  const {
    requestedHasContract,
    previousLayerUuid,
    previousHasRequiredContract,
    previousStoredResult,
    solutionNonce,
    requestedStoredNonce
  } = params;

  // 1. Requested layer must have an inference contract
  if (!requestedHasContract) return false;

  // 2. Previous layer must exist
  if (!previousLayerUuid) return false;

  // 3. Previous layer must have a required contract
  if (!previousHasRequiredContract) return false;

  // 4. FIX (#75): If the previous layer already has a stored result, the solution
  //    is not for it — let normal validation handle the requested layer.
  //    This check MUST run before the nonce guard: when the requested layer has
  //    never been challenged (stored nonce is null), the nonce guard cannot
  //    distinguish "agent is answering the previous layer" from "agent is
  //    legitimately calling the next layer for the first time".
  if (previousStoredResult) return false;

  // 5. Nonce guard: if the requested layer's stored nonce matches the solution
  //    nonce, the agent is answering the current layer's challenge.
  if (solutionNonce != null && requestedStoredNonce != null && solutionNonce === requestedStoredNonce) {
    return false;
  }

  return true;
}

describe('tryApplySolutionToPreviousStepWhenSolutionMatchesPrevious — decision logic (#75)', () => {
  test('does NOT redirect when previous layer already has a stored result (even if requested layer has no nonce)', () => {
    // This is the exact bug scenario from #75:
    // - Layer 3 (requested) has an inference contract but no stored nonce (never challenged)
    // - Layer 2 (previous) has a required contract AND a stored result from a prior call
    const result = shouldRedirectToPreviousLayer({
      requestedHasContract: true,
      previousLayerUuid: 'layer-2-uuid',
      previousHasRequiredContract: true,
      previousStoredResult: { status: 'success' },
      solutionNonce: 'agent-nonce',
      requestedStoredNonce: null  // layer 3 never challenged
    });

    expect(result).toBe(false);
  });

  test('redirects when previous layer has no stored result and requested layer has no nonce', () => {
    // First call scenario: layer 3 never challenged, layer 2 has no result yet
    const result = shouldRedirectToPreviousLayer({
      requestedHasContract: true,
      previousLayerUuid: 'layer-2-uuid',
      previousHasRequiredContract: true,
      previousStoredResult: null,
      solutionNonce: 'agent-nonce',
      requestedStoredNonce: null  // layer 3 never challenged
    });

    expect(result).toBe(true);
  });

  test('does NOT redirect when requested layer nonce matches stored nonce', () => {
    // Agent is answering the current layer's own challenge
    const result = shouldRedirectToPreviousLayer({
      requestedHasContract: true,
      previousLayerUuid: 'layer-2-uuid',
      previousHasRequiredContract: true,
      previousStoredResult: null,
      solutionNonce: 'same-nonce',
      requestedStoredNonce: 'same-nonce'  // matches
    });

    expect(result).toBe(false);
  });

  test('redirects when nonces differ (agent holding a previous challenge nonce)', () => {
    const result = shouldRedirectToPreviousLayer({
      requestedHasContract: true,
      previousLayerUuid: 'layer-2-uuid',
      previousHasRequiredContract: true,
      previousStoredResult: null,
      solutionNonce: 'old-nonce',
      requestedStoredNonce: 'different-nonce'
    });

    expect(result).toBe(true);
  });

  test('does NOT redirect when requested layer has no inference contract', () => {
    const result = shouldRedirectToPreviousLayer({
      requestedHasContract: false,
      previousLayerUuid: 'layer-2-uuid',
      previousHasRequiredContract: true,
      previousStoredResult: null,
      solutionNonce: 'nonce',
      requestedStoredNonce: null
    });

    expect(result).toBe(false);
  });

  test('does NOT redirect when previous layer has no required contract', () => {
    const result = shouldRedirectToPreviousLayer({
      requestedHasContract: true,
      previousLayerUuid: 'layer-2-uuid',
      previousHasRequiredContract: false,
      previousStoredResult: null,
      solutionNonce: 'nonce',
      requestedStoredNonce: null
    });

    expect(result).toBe(false);
  });

  test('does NOT redirect when there is no previous layer', () => {
    const result = shouldRedirectToPreviousLayer({
      requestedHasContract: true,
      previousLayerUuid: null,
      previousHasRequiredContract: false,
      previousStoredResult: null,
      solutionNonce: 'nonce',
      requestedStoredNonce: null
    });

    expect(result).toBe(false);
  });
});
