// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { forwardInputSchema } from '../../src/tools/forward_schema.js';

const ADAPTER_URI = 'kairos://adapter/sample-adapter';
const ADAPTER_SLUG_URI = 'kairos://adapter/create-merge-request';
const LAYER_URI = 'kairos://layer/00000000-0000-0000-0000-000000000002';
const LAYER_WITH_EXEC = `${LAYER_URI}?execution_id=00000000-0000-0000-0000-000000000003`;

describe('forward input schema (entry pass without solution)', () => {
  test('requires uri', () => {
    const r = forwardInputSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  test('accepts adapter uri without solution', () => {
    const r = forwardInputSchema.safeParse({ uri: ADAPTER_URI });
    expect(r.success).toBe(true);
  });

  test('accepts adapter slug uri without solution', () => {
    const r = forwardInputSchema.safeParse({ uri: ADAPTER_SLUG_URI });
    expect(r.success).toBe(true);
  });

  test('accepts layer uri without solution', () => {
    const r = forwardInputSchema.safeParse({ uri: LAYER_URI });
    expect(r.success).toBe(true);
  });

  test('requires solution for layer uri with execution_id query', () => {
    const r = forwardInputSchema.safeParse({ uri: LAYER_WITH_EXEC });
    expect(r.success).toBe(false);
  });

  const commentText = 'Continuing the same run with a valid comment solution.';

  test('accepts comment solution as object { text } and normalizes to v2 evidence envelope', () => {
    const r = forwardInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      solution: {
        type: 'comment',
        comment: { text: commentText }
      }
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // v1 comment field is normalized into the v2 evidence envelope
      expect(r.data.solution?.evidence).toEqual({ text: commentText });
      expect(r.data.solution?.outcome).toBe('success');
    }
  });

  test('accepts comment solution as a plain string (normalized to v2 evidence envelope)', () => {
    const r = forwardInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      solution: {
        type: 'comment',
        comment: commentText
      }
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.solution?.evidence).toEqual({ text: commentText });
      expect(r.data.solution?.outcome).toBe('success');
    }
  });

  test('rejects comment solution when comment is a number', () => {
    const r = forwardInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      solution: {
        type: 'comment',
        comment: 42 as unknown as string
      }
    });
    expect(r.success).toBe(false);
  });

  test('accepts comment solution with empty object (normalized to v2 evidence envelope)', () => {
    const r = forwardInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      solution: {
        type: 'comment',
        comment: {} as { text: string }
      }
    });
    // v2 evidence is a open record; empty object is accepted after normalization
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.solution?.evidence).toEqual({});
    }
  });

  test('accepts comment solution when comment object omits text (normalized to v2 evidence)', () => {
    const r = forwardInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      solution: {
        type: 'comment',
        comment: { other: 'x' } as unknown as { text: string }
      }
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.solution?.evidence).toEqual({ other: 'x' });
    }
  });

  test('accepts comment solution when comment.text is not a string (normalized to v2 evidence)', () => {
    const r = forwardInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      solution: {
        type: 'comment',
        comment: { text: 99 as unknown as string }
      }
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.solution?.evidence).toEqual({ text: 99 });
    }
  });

  test('rejects continuation solution without solution.type', () => {
    const r = forwardInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      solution: {
        comment: { text: 'Missing solution.type but has a payload.' }
      }
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((issue) => issue.path.join('.') === 'solution.type')).toBe(true);
    }
  });

  test('rejects continuation solution with mismatched type and payload', () => {
    const r = forwardInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      solution: {
        type: 'shell',
        comment: { text: 'Payload does not match solution.type.' }
      }
    });
    expect(r.success).toBe(false);
  });

  test('rejects solution when starting from adapter uri', () => {
    const r = forwardInputSchema.safeParse({
      uri: ADAPTER_URI,
      solution: {
        type: 'comment',
        comment: { text: 'should not be allowed on start' }
      }
    });
    expect(r.success).toBe(false);
  });

  test('rejects solution when starting from layer uri without execution_id', () => {
    const r = forwardInputSchema.safeParse({
      uri: LAYER_URI,
      solution: {
        type: 'comment',
        comment: { text: 'should not be allowed on start' }
      }
    });
    expect(r.success).toBe(false);
  });
});
