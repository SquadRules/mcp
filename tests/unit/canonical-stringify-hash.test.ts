/**
 * Regression test for issue #71 section 2: recursive evidence hashing.
 *
 * The old `hashProofRecord` used `JSON.stringify(record, Object.keys(record).sort())`
 * whose replacer array is re-evaluated at every nesting level, silently dropping
 * nested keys not present at the top level. This caused distinct evidence bodies
 * (different comment text, different forward targets) to produce identical hashes.
 *
 * The fix replaces the replacer-array approach with `canonicalStringify`, a
 * recursive serializer that sorts keys at every depth and includes all leaves.
 */
import crypto from 'node:crypto';
import { describe, expect, test } from '@jest/globals';
import { canonicalStringify } from '../../src/utils/canonical-stringify.js';

describe('canonicalStringify', () => {
  describe('primitives and edge cases', () => {
    test('serialises primitives identically to JSON.stringify', () => {
      expect(canonicalStringify(null)).toBe('null');
      expect(canonicalStringify(undefined)).toBe('undefined');
      expect(canonicalStringify(42)).toBe('42');
      expect(canonicalStringify('hello')).toBe('"hello"');
      expect(canonicalStringify(true)).toBe('true');
      expect(canonicalStringify(false)).toBe('false');
    });

    test('serialises arrays with preserved order', () => {
      expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
      expect(canonicalStringify(['a', 'b'])).toBe('["a","b"]');
    });

    test('sorts object keys alphabetically', () => {
      const result = canonicalStringify({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    test('sorts keys at every nesting depth', () => {
      const result = canonicalStringify({ b: { d: 1, c: 2 }, a: 3 });
      expect(result).toBe('{"a":3,"b":{"c":2,"d":1}}');
    });

    test('handles nested arrays of objects', () => {
      const result = canonicalStringify({ items: [{ b: 2, a: 1 }] });
      expect(result).toBe('{"items":[{"a":1,"b":2}]}');
    });
  });

  describe('nested evidence bodies are included in canonical form', () => {
    test('comment evidence text appears in canonical output', () => {
      const record = {
        result_id: 'pow_test',
        type: 'comment',
        status: 'success',
        executed_at: '2026-10-23T00:00:00Z',
        comment: { text: 'ALPHA evidence' }
      };
      const canonical = canonicalStringify(record);
      // The old buggy code produced: {"comment":{},"executed_at":"...","result_id":"pow_test","status":"success","type":"comment"}
      // The fix must include the text field inside comment
      expect(canonical).toContain('"comment":{"text":"ALPHA evidence"}');
      expect(canonical).not.toContain('"comment":{}');
    });

    test('forward evidence target and success appear in canonical output', () => {
      const record = {
        result_id: 'pow_test',
        type: 'forward',
        status: 'success',
        executed_at: '2026-10-23T00:00:00Z',
        forward: { target: 'squadrules://adapter/alpha', success: true }
      };
      const canonical = canonicalStringify(record);
      expect(canonical).toContain('"forward":{"success":true,"target":"squadrules://adapter/alpha"}');
      expect(canonical).not.toContain('"forward":{}');
    });

    test('user_input evidence confirmation appears in canonical output', () => {
      const record = {
        result_id: 'pow_test',
        type: 'user_input',
        status: 'success',
        executed_at: '2026-10-23T00:00:00Z',
        user_input: { confirmation: 'yes-i-confirm', timestamp: '2026-10-23T00:00:00Z' }
      };
      const canonical = canonicalStringify(record);
      expect(canonical).toContain('"user_input":{"confirmation":"yes-i-confirm"');
      expect(canonical).not.toContain('"user_input":{}');
    });

    test('shell nested evidence preserves stdout and stderr', () => {
      const record = {
        result_id: 'pow_test',
        type: 'shell',
        status: 'success',
        executed_at: '2026-10-23T00:00:00Z',
        exit_code: 0,
        stdout: 'OK',
        shell: { exit_code: 0, stdout: 'DETAILED_OUTPUT', stderr: '' }
      };
      const canonical = canonicalStringify(record);
      expect(canonical).toContain('"stdout":"DETAILED_OUTPUT"');
      expect(canonical).toContain('"stderr":""');
    });
  });

  describe('distinct evidence produces distinct canonical forms', () => {
    test('two comment records differing only in text produce different canonical strings', () => {
      const base = { result_id: 'x', type: 'comment', status: 'success', executed_at: '2026-10-23T00:00:00Z' };
      const a = canonicalStringify({ ...base, comment: { text: 'ALPHA' } });
      const b = canonicalStringify({ ...base, comment: { text: 'BEE' } });
      expect(a).not.toBe(b);
    });

    test('two forward records differing only in target produce different canonical strings', () => {
      const base = { result_id: 'x', type: 'forward', status: 'success', executed_at: '2026-10-23T00:00:00Z' };
      const a = canonicalStringify({ ...base, forward: { target: 'squadrules://adapter/alpha', success: true } });
      const b = canonicalStringify({ ...base, forward: { target: 'squadrules://adapter/beta', success: true } });
      expect(a).not.toBe(b);
    });

    test('two user_input records differing only in confirmation produce different canonical strings', () => {
      const base = { result_id: 'x', type: 'user_input', status: 'success', executed_at: '2026-10-23T00:00:00Z' };
      const a = canonicalStringify({ ...base, user_input: { confirmation: 'yes', timestamp: 't' } });
      const b = canonicalStringify({ ...base, user_input: { confirmation: 'no', timestamp: 't' } });
      expect(a).not.toBe(b);
    });

    test('two shell records differing only in nested stdout produce different canonical strings', () => {
      const base = { result_id: 'x', type: 'shell', status: 'success', executed_at: '2026-10-23T00:00:00Z', exit_code: 0 };
      const a = canonicalStringify({ ...base, shell: { exit_code: 0, stdout: 'ALPHA_OUTPUT' } });
      const b = canonicalStringify({ ...base, shell: { exit_code: 0, stdout: 'BETA_OUTPUT' } });
      expect(a).not.toBe(b);
    });
  });

  describe('regression: old JSON.stringify replacer bug', () => {
    test('old replacer approach drops nested comment.text (proves the bug existed)', () => {
      const record = {
        result_id: 'x', type: 'comment', status: 'success',
        executed_at: '2026-10-23T00:00:00Z',
        comment: { text: 'important evidence' }
      };
      // Simulate the old buggy code
      const oldCanonical = JSON.stringify(record, Object.keys(record).sort());
      expect(oldCanonical).toContain('"comment":{}');
      expect(oldCanonical).not.toContain('important evidence');
    });

    test('new canonicalStringify includes nested comment.text (proves the fix works)', () => {
      const record = {
        result_id: 'x', type: 'comment', status: 'success',
        executed_at: '2026-10-23T00:00:00Z',
        comment: { text: 'important evidence' }
      };
      const newCanonical = canonicalStringify(record);
      expect(newCanonical).toContain('"text":"important evidence"');
    });

    test('old replacer produces identical hashes for distinct comment evidence', () => {
      const hash = (record: Record<string, unknown>) =>
        crypto.createHash('sha256')
          .update(JSON.stringify(record, Object.keys(record).sort()))
          .digest('hex');

      const base = { result_id: 'x', type: 'comment', status: 'success', executed_at: '2026-10-23T00:00:00Z' };
      // The old bug: these two records with DIFFERENT evidence produce the SAME hash
      expect(hash({ ...base, comment: { text: 'ALPHA' } }))
        .toBe(hash({ ...base, comment: { text: 'BETA' } }));
    });

    test('new canonicalStringify produces distinct hashes for distinct comment evidence', () => {
      const hash = (record: Record<string, unknown>) =>
        crypto.createHash('sha256')
          .update(canonicalStringify(record))
          .digest('hex');

      const base = { result_id: 'x', type: 'comment', status: 'success', executed_at: '2026-10-23T00:00:00Z' };
      expect(hash({ ...base, comment: { text: 'ALPHA' } }))
        .not.toBe(hash({ ...base, comment: { text: 'BETA' } }));
    });
  });
});
