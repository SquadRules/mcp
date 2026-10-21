import { describe, expect, test } from '@jest/globals';
import { forwardSolutionSchema } from '../../src/tools/forward_schema.js';
import { mapProofSolution } from '../../src/tools/forward-view.js';

describe('unified-solution-envelope', () => {
  test('v2 shell evidence maps to proof submission shell', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'shell',
      outcome: 'success',
      evidence: { exit_code: 0, stdout: 'ok', stderr: '', duration_seconds: 0.1 }
    });
    const submission = mapProofSolution(parsed);
    expect(submission.type).toBe('shell');
    expect(submission.shell?.exit_code).toBe(0);
    expect(submission.shell?.stdout).toBe('ok');
  });

  test('v1 shell payload is accepted and maps to proof submission shell', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'shell',
      shell: { exit_code: 0, stdout: 'older-format' }
    });
    const submission = mapProofSolution(parsed);
    expect(submission.type).toBe('shell');
    expect(submission.shell?.exit_code).toBe(0);
    expect(submission.shell?.stdout).toBe('older-format');
  });

  test('v2 mcp evidence maps response -> result and derives success from outcome', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'mcp',
      outcome: 'failure',
      evidence: { tool_name: 'search', arguments: { q: 'x' }, response: { results: [] } }
    });
    const submission = mapProofSolution(parsed);
    expect(submission.type).toBe('mcp');
    expect(submission.mcp?.tool_name).toBe('search');
    expect(submission.mcp?.arguments).toEqual({ q: 'x' });
    expect(submission.mcp?.result).toEqual({ results: [] });
    expect(submission.mcp?.success).toBe(false);
  });

  test('v1 mcp payload is accepted and preserves success while renaming result -> response internally', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'mcp',
      mcp: { tool_name: 'search', arguments: { q: 'x' }, result: { results: [] }, success: true }
    });
    const submission = mapProofSolution(parsed);
    expect(submission.type).toBe('mcp');
    expect(submission.mcp?.tool_name).toBe('search');
    expect(submission.mcp?.result).toEqual({ results: [] });
    expect(submission.mcp?.success).toBe(true);
  });

  test('v2 comment evidence maps to proof submission comment', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'comment',
      outcome: 'success',
      evidence: { text: 'done' }
    });
    const submission = mapProofSolution(parsed);
    expect(submission.type).toBe('comment');
    expect(submission.comment?.text).toBe('done');
  });

  test('nonce and proof_hash inside evidence are extracted when not at top level', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'comment',
      outcome: 'success',
      evidence: {
        text: 'verification comment',
        nonce: 'abc123',
        proof_hash: 'def456'
      }
    });
    const submission = mapProofSolution(parsed);
    expect(submission.nonce).toBe('abc123');
    expect(submission.proof_hash).toBe('def456');
  });

  test('top-level nonce and proof_hash take precedence over evidence values', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'shell',
      outcome: 'success',
      nonce: 'top-nonce',
      proof_hash: 'top-hash',
      evidence: {
        exit_code: 0,
        nonce: 'evidence-nonce',
        proof_hash: 'evidence-hash'
      }
    });
    const submission = mapProofSolution(parsed);
    expect(submission.nonce).toBe('top-nonce');
    expect(submission.proof_hash).toBe('top-hash');
  });

  test('evidence.comment as string is extracted as comment text', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'comment',
      outcome: 'success',
      evidence: {
        comment: 'this is my verification comment',
        nonce: 'abc',
        proof_hash: 'def'
      }
    });
    const submission = mapProofSolution(parsed);
    expect(submission.comment?.text).toBe('this is my verification comment');
    expect(submission.nonce).toBe('abc');
    expect(submission.proof_hash).toBe('def');
  });

  test('flat text field on comment solution is normalized into evidence.text', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'comment',
      outcome: 'success',
      text: 'my verification summary from flat field',
      nonce: 'n1',
      proof_hash: 'h1'
    });
    const submission = mapProofSolution(parsed);
    expect(submission.type).toBe('comment');
    expect(submission.comment?.text).toBe('my verification summary from flat field');
    expect(submission.nonce).toBe('n1');
    expect(submission.proof_hash).toBe('h1');
  });

  test('evidence.text takes precedence over flat text on comment solution', () => {
    const parsed = forwardSolutionSchema.parse({
      type: 'comment',
      outcome: 'success',
      evidence: { text: 'from evidence' },
      text: 'from flat field'
    });
    const submission = mapProofSolution(parsed);
    expect(submission.comment?.text).toBe('from evidence');
  });
});
