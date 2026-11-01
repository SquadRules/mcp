/**
 * `delivery` gates in the export input schema (issue #231): base64 is allowed for
 * `source` so an agent can materialize one artifact without retyping its bytes,
 * and still rejected for the formats that have no byte-exact delivery problem.
 */

import { describe, expect, it } from '@jest/globals';
import { exportInputSchema } from '../../src/tools/export_schema.js';

const ARTIFACT_URI = 'squadrules://artifact/11111111-2222-3333-4444-555555555555';

function check(input: Record<string, unknown>) {
  return exportInputSchema.safeParse(input);
}

describe('export input delivery gate', () => {
  it('accepts inline_base64 for a source artifact', () => {
    const r = check({ uri: ARTIFACT_URI, format: 'source', delivery: 'inline_base64' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.delivery).toBe('inline_base64');
  });

  it('accepts inline_base64 for a skill_zip bundle', () => {
    const r = check({ uri: ARTIFACT_URI, format: 'skill_zip', delivery: 'inline_base64' });
    expect(r.success).toBe(true);
  });

  it('rejects delivery for formats without a byte-exact payload', () => {
    for (const format of ['markdown', 'skill_tree', 'trace_jsonl']) {
      const r = check({ uri: ARTIFACT_URI, format, delivery: 'inline_base64' });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.message).toContain('skill_zip');
        expect(r.error.issues[0]?.message).toContain('source');
      }
    }
  });

  it('rejects an unknown delivery mode', () => {
    expect(check({ uri: ARTIFACT_URI, format: 'source', delivery: 'hex' }).success).toBe(false);
  });

  it('still requires a single uri for source', () => {
    expect(check({ adapters: ['a'], format: 'source', delivery: 'inline_base64' }).success).toBe(false);
  });
});
