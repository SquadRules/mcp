/**
 * Unit tests for forward-contract-match.ts (renamed from mcp-contract-match.ts).
 *
 * A `forward` contract names exactly one thing: the adapter it links to
 * (ADR 0025's forward-link-only rule, re-expressed by ADR 0028). With the
 * `tool_name` constant and the `arguments` wrapper gone, matching is a single
 * target comparison, and every failure mode reports one code:
 * FORWARD_TARGET_MISMATCH.
 */
import { describe, expect, test } from '@jest/globals';
import { validateForwardSubmissionAgainstContract } from '../../src/tools/forward-contract-match.js';
import type { ProofOfWorkDefinition } from '../../src/types/memory.js';
import { forwardContractSchema } from '../../src/tools/forward_schema.js';
import { challengeSchema } from '../../src/tools/next_schema.js';

const TARGET = 'squadrules://adapter/critic-loop';

function forwardProof(target: string): ProofOfWorkDefinition {
  return { required: true, type: 'forward', forward: { target } };
}

describe('forward-contract-match', () => {
  describe('validateForwardSubmissionAgainstContract', () => {
    test('accepts the exact contracted target', () => {
      const r = validateForwardSubmissionAgainstContract(forwardProof(TARGET), {
        target: TARGET,
        success: true
      });
      expect(r).toEqual({ ok: true });
    });

    test('rejects a different adapter slug with FORWARD_TARGET_MISMATCH', () => {
      const r = validateForwardSubmissionAgainstContract(forwardProof(TARGET), {
        target: 'squadrules://adapter/some-other-slug',
        success: true
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('FORWARD_TARGET_MISMATCH');
        expect(r.message).toContain(TARGET);
        expect(r.message).toContain('some-other-slug');
      }
    });

    test('rejects a non-adapter URI scheme with FORWARD_TARGET_MISMATCH', () => {
      const r = validateForwardSubmissionAgainstContract(forwardProof(TARGET), {
        target: 'https://example.com/adapter/critic-loop',
        success: true
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('FORWARD_TARGET_MISMATCH');
        expect(r.message).toMatch(/valid adapter URI/);
      }
    });

    test('rejects a bare tool name submitted as the target', () => {
      const r = validateForwardSubmissionAgainstContract(forwardProof(TARGET), {
        target: 'activate',
        success: true
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('FORWARD_TARGET_MISMATCH');
    });

    test('rejects a missing target with FORWARD_TARGET_MISMATCH', () => {
      const r = validateForwardSubmissionAgainstContract(forwardProof(TARGET), {
        success: true
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('FORWARD_TARGET_MISMATCH');
        expect(r.message).toContain('evidence.target');
      }
    });

    test('rejects an empty target with FORWARD_TARGET_MISMATCH', () => {
      const r = validateForwardSubmissionAgainstContract(forwardProof(TARGET), {
        target: '',
        success: true
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('FORWARD_TARGET_MISMATCH');
    });

    test('a failed forward to the contracted target still matches the contract', () => {
      // Success/failure is the proof's business, not the target comparison's.
      const r = validateForwardSubmissionAgainstContract(forwardProof(TARGET), {
        target: TARGET,
        success: false
      });
      expect(r).toEqual({ ok: true });
    });

    test('a non-forward proof is not this matcher’s business', () => {
      const r = validateForwardSubmissionAgainstContract(
        { required: true, type: 'comment', comment: { min_length: 10 } },
        { target: 'squadrules://adapter/anything' }
      );
      expect(r).toEqual({ ok: true });
    });

    test('a contract with no target enforces nothing here (train-time rule owns it)', () => {
      const r = validateForwardSubmissionAgainstContract(
        { required: true, type: 'forward' } as ProofOfWorkDefinition,
        { success: true }
      );
      expect(r).toEqual({ ok: true });
    });
  });

  describe('forwardContractSchema forward payload', () => {
    test('parses the flat forward.target shape', () => {
      const out = forwardContractSchema.parse({
        type: 'forward',
        required: true,
        forward: { target: TARGET }
      });
      expect(out.forward?.target).toBe(TARGET);
    });

    test('parses optional expected_result alongside target', () => {
      const out = forwardContractSchema.parse({
        type: 'forward',
        forward: { target: TARGET, expected_result: { ok: true } }
      });
      expect(out.forward?.expected_result).toEqual({ ok: true });
    });

    test('rejects the retired type "mcp"', () => {
      const result = forwardContractSchema.safeParse({
        type: 'mcp',
        mcp: { tool_name: 'forward', arguments: { uri: TARGET } }
      });
      expect(result.success).toBe(false);
    });

    test('parses the optional subagent.mcp delegation list', () => {
      const out = forwardContractSchema.parse({
        type: 'subagent',
        subagent: {
          context: 'Export every adapter and report the slugs.',
          mcp: [{ tool_name: 'export', arguments: { all_adapters: true } }]
        }
      });
      expect(out.subagent?.mcp).toEqual([{ tool_name: 'export', arguments: { all_adapters: true } }]);
    });
  });
});

describe('next_schema challenge forward payload', () => {
  test('parses a challenge carrying forward.target', () => {
    const out = challengeSchema.parse({
      type: 'forward',
      description: `Forward to adapter ${TARGET}.`,
      forward: { target: TARGET }
    });
    expect(out.forward?.target).toBe(TARGET);
  });

  test('parses a challenge carrying the subagent.mcp list', () => {
    const out = challengeSchema.parse({
      type: 'subagent',
      description: 'Delegate this task to a subagent and return its actual report.',
      subagent: { context: 'Export all adapters.', mcp: [{ tool_name: 'export' }] }
    });
    expect(out.subagent?.mcp).toEqual([{ tool_name: 'export' }]);
  });
});
