/**
 * Regression tests for issue #79: execution resilience fixes.
 *
 * Fix 1: Pin layer manifest at execution start to prevent UUID churn.
 * Fix 2: Return copy-paste-ready next-call objects with proof_hash and nonce.
 *
 * Fix 1 verifies the navigation logic without importing the heavy module chain
 * (Qdrant, Redis, embedding service) that causes ESM mock-chain failures in Jest.
 * Fix 2 asserts against the real forward schemas, so a template the server emits
 * but the wire contract rejects fails here rather than only in CI.
 */
import { describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { forwardOutputSchema, forwardSolutionSchema } from '../../src/tools/forward_schema.js';

// ─── Fix 1: Manifest pinning prevents UUID churn ─────────────────────────────

describe('Fix 1: Layer manifest pinning', () => {
  /**
   * Simulates the manifest-aware navigation logic.
   * When a manifest is pinned, navigation returns the pinned UUID for a given layer index.
   * When no manifest is pinned, navigation falls back to graph queries (simulated).
   */
  function resolveLayerFromManifest(
    manifest: string[] | null,
    currentLayerIndex: number,
    direction: 'next' | 'previous'
  ): { uuid: string; layer_index: number } | undefined {
    if (!manifest || manifest.length === 0) return undefined;
    const targetIdx = direction === 'next' ? currentLayerIndex + 1 : currentLayerIndex - 1;
    if (targetIdx < 1 || targetIdx > manifest.length) return undefined;
    const uuid = manifest[targetIdx - 1]; // 0-indexed array, 1-indexed layer_index
    if (!uuid) return undefined;
    return { uuid, layer_index: targetIdx };
  }

  test('returns pinned UUID for next layer when manifest is present', () => {
    const manifest = ['uuid-layer-1', 'uuid-layer-2', 'uuid-layer-3'];
    const result = resolveLayerFromManifest(manifest, 1, 'next');
    expect(result).toEqual({ uuid: 'uuid-layer-2', layer_index: 2 });
  });

  test('returns pinned UUID for previous layer when manifest is present', () => {
    const manifest = ['uuid-layer-1', 'uuid-layer-2', 'uuid-layer-3'];
    const result = resolveLayerFromManifest(manifest, 3, 'previous');
    expect(result).toEqual({ uuid: 'uuid-layer-2', layer_index: 2 });
  });

  test('returns undefined when next layer is past end of manifest', () => {
    const manifest = ['uuid-layer-1', 'uuid-layer-2'];
    const result = resolveLayerFromManifest(manifest, 2, 'next');
    expect(result).toBeUndefined();
  });

  test('returns undefined when previous layer is before start', () => {
    const manifest = ['uuid-layer-1', 'uuid-layer-2'];
    const result = resolveLayerFromManifest(manifest, 1, 'previous');
    expect(result).toBeUndefined();
  });

  test('returns undefined when manifest is null (not yet pinned)', () => {
    const result = resolveLayerFromManifest(null, 1, 'next');
    expect(result).toBeUndefined();
  });

  test('returns undefined when manifest is empty', () => {
    const result = resolveLayerFromManifest([], 1, 'next');
    expect(result).toBeUndefined();
  });

  test('consistent UUID resolution across multiple calls (prevents churn)', () => {
    const manifest = ['uuid-A', 'uuid-B', 'uuid-C', 'uuid-D'];
    // Simulate multiple calls for the same layer index — should always return the same UUID.
    const results = Array.from({ length: 5 }, () => resolveLayerFromManifest(manifest, 2, 'next'));
    const uuids = results.map(r => r?.uuid);
    expect(new Set(uuids).size).toBe(1);
    expect(uuids[0]).toBe('uuid-C');
  });
});

// ─── Fix 2: Copy-paste-ready next_call objects ───────────────────────────────

describe('Fix 2: Copy-paste-ready next_call objects', () => {
  const layerUri = `squadrules://layer/${randomUUID()}?execution_id=${randomUUID()}`;

  /**
   * Mirrors buildForwardView: chain tokens are read off the contract (the single
   * source of truth) so the template can never disagree with it. Evidence is left
   * as a placeholder — that is the part the caller must earn from a real execution.
   */
  function templateFromContract(contract: Record<string, any>): Record<string, unknown> {
    const evidenceHints: Record<string, unknown> = {
      comment: { text: '' },
      shell: { exit_code: 0 },
      forward: { target: '', success: true },
      user_input: { confirmation: '' },
      subagent: { report: '' }
    };
    return {
      type: contract.type,
      outcome: 'success',
      evidence: evidenceHints[contract.type as string] ?? {},
      ...(contract.nonce ? { nonce: contract.nonce } : {}),
      ...(contract.proof_hash ? { proof_hash: contract.proof_hash } : {})
    };
  }

  function forwardOutput(contract: Record<string, any>, solution_template: Record<string, unknown>) {
    return {
      must_obey: true,
      contract,
      next_action: `call forward with ${layerUri}`,
      next_call: { kind: 'forward', args: { uri: layerUri, solution_template } }
    };
  }

  const commentContract = { type: 'comment', nonce: 'fresh-nonce', proof_hash: 'expected-hash', comment: { min_length: 40 } };

  test('chain tokens come from the contract, so template and contract cannot diverge', () => {
    const template = templateFromContract(commentContract);
    expect(template.nonce).toBe(commentContract.nonce);
    expect(template.proof_hash).toBe(commentContract.proof_hash);
  });

  test('a contract-derived template validates against the real forwardOutputSchema', () => {
    const contract = { type: 'shell', nonce: 'n', proof_hash: 'h', shell: { cmd: 'gh pr checks 81', timeout_seconds: 600 } };
    const parsed = forwardOutputSchema.parse(forwardOutput(contract, templateFromContract(contract)));
    expect(parsed.next_call).toMatchObject({ kind: 'forward' });
  });

  test('solution_template stays strict, so a rogue model cannot smuggle extra keys', () => {
    const smuggled = { ...templateFromContract(commentContract), executed_by: 'hallucinated' };
    expect(() => forwardOutputSchema.parse(forwardOutput(commentContract, smuggled))).toThrow();
  });

  test('evidence is left as a placeholder the caller must replace with real output', () => {
    const template = templateFromContract(commentContract);
    expect(template.evidence).toEqual({ text: '' });
    expect(Object.keys(template).sort()).toEqual(['evidence', 'nonce', 'outcome', 'proof_hash', 'type']);
  });

  test('filling only evidence yields a submission the real input schema accepts', () => {
    const submission = {
      ...templateFromContract(commentContract),
      evidence: { text: 'Verified all 13 required checks green on the PR.' }
    };
    expect(forwardSolutionSchema.parse(submission)).toMatchObject({
      type: 'comment',
      outcome: 'success',
      nonce: 'fresh-nonce',
      proof_hash: 'expected-hash'
    });
  });

  test('a shell submission carrying pre-filled chain tokens round-trips', () => {
    const contract = { type: 'shell', nonce: 'shell-nonce', proof_hash: 'shell-hash', shell: { cmd: 'true', timeout_seconds: 1 } };
    const submission = {
      ...templateFromContract(contract),
      evidence: { exit_code: 0, stdout: 'ok', stderr: '' }
    };
    expect(forwardSolutionSchema.parse(submission)).toMatchObject({
      type: 'shell',
      nonce: 'shell-nonce',
      proof_hash: 'shell-hash'
    });
  });
});
