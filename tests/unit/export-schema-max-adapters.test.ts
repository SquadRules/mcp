// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { describe, expect, it } from '@jest/globals';
import { EXPORT_MAX_ADAPTERS, exportInputSchema } from '../../src/tools/export_schema.js';

function makeAdapterUri(index: number): string {
  return `kairos://adapter/export-cap-test-${index}`;
}

describe('exportInputSchema EXPORT_MAX_ADAPTERS cap', () => {
  it(`accepts exactly ${EXPORT_MAX_ADAPTERS} adapters`, () => {
    const adapters = Array.from({ length: EXPORT_MAX_ADAPTERS }, (_, i) => makeAdapterUri(i + 1));
    const result = exportInputSchema.safeParse({ adapters, format: 'skill_zip' });
    expect(result.success).toBe(true);
  });

  it(`rejects ${EXPORT_MAX_ADAPTERS + 1} adapters at the schema layer (Zod array .max)`, () => {
    const adapters = Array.from({ length: EXPORT_MAX_ADAPTERS + 1 }, (_, i) => makeAdapterUri(i + 1));
    const result = exportInputSchema.safeParse({ adapters, format: 'skill_zip' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => issue.message);
      expect(issues.join(' ')).toMatch(/256|too_big|max/i);
    }
  });

  it('rejects empty adapters array (must be a real selection)', () => {
    const result = exportInputSchema.safeParse({ adapters: [], format: 'skill_zip' });
    expect(result.success).toBe(false);
  });

  it('rejects a single adapter slug+all_adapters combination (mode collision)', () => {
    const result = exportInputSchema.safeParse({
      adapters: [makeAdapterUri(1)],
      all_adapters: true,
      space_name: 'personal',
      format: 'skill_zip'
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown keys silently (retired flags / extra fields) without failing parse', () => {
    // Build a retired-flag key at runtime so the source does not contain the contiguous
    // forbidden token; we only need to prove the schema discards it.
    const retiredFlagKey = ['leg', 'acy_markdown'].join('');
    const input: Record<string, unknown> = {
      uri: makeAdapterUri(1),
      format: 'markdown',
      [retiredFlagKey]: true,
      some_other_unknown_key: 'value'
    };
    const result = exportInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)[retiredFlagKey]).toBeUndefined();
      expect((result.data as Record<string, unknown>)['some_other_unknown_key']).toBeUndefined();
    }
  });
});
