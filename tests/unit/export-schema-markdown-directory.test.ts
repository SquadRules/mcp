/**
 * Issue #201 gap 1: `format: markdown` with a multi-adapter selection is valid when
 * `directory` is set — the export core writes `<directory>/<slug>.md` per adapter
 * (src/tools/export.ts). Without `directory` the rejection must stand, and its message
 * must name both `directory` and the single-`uri` markdown path (the CLI integration
 * test tests/integration/cli-export-selection.test.ts matches that wording).
 */
import { describe, expect, it } from '@jest/globals';
import { exportInputSchema } from '../../src/tools/export_schema.js';

const ADAPTER_URI = 'squadrules://adapter/sample-adapter-a';
const ADAPTER_URI_2 = 'squadrules://adapter/sample-adapter-b';
const DIR = '/tmp/squadrules-export-dir';

describe('exportInputSchema markdown + directory (issue #201 gap 1)', () => {
  it('accepts markdown with all_adapters when directory is set', () => {
    const result = exportInputSchema.safeParse({
      all_adapters: true,
      space_name: 'personal',
      format: 'markdown',
      directory: DIR
    });
    expect(result.success).toBe(true);
  });

  it('accepts markdown with an adapters list when directory is set', () => {
    const result = exportInputSchema.safeParse({
      adapters: [ADAPTER_URI, ADAPTER_URI_2],
      format: 'markdown',
      directory: DIR
    });
    expect(result.success).toBe(true);
  });

  it('accepts markdown with a single uri and directory (unchanged)', () => {
    const result = exportInputSchema.safeParse({
      uri: ADAPTER_URI,
      format: 'markdown',
      directory: DIR
    });
    expect(result.success).toBe(true);
  });

  it('still rejects markdown with all_adapters and no directory, naming directory and single-uri markdown', () => {
    const result = exportInputSchema.safeParse({
      all_adapters: true,
      space_name: 'personal',
      format: 'markdown'
    });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues.map((i) => i.message).join(' ');
    expect(message).toMatch(/markdown.*single.*uri|requires a single `uri`/i);
    expect(message).toMatch(/directory/);
    expect(message).toMatch(/skill_tree.*skill_zip|skill_zip.*skill_tree/);
  });

  it('still rejects markdown with an adapters list and no directory', () => {
    const result = exportInputSchema.safeParse({
      adapters: [ADAPTER_URI],
      format: 'markdown'
    });
    expect(result.success).toBe(false);
  });

  it('treats a whitespace-only directory as absent for markdown multi-selection', () => {
    const result = exportInputSchema.safeParse({
      adapters: [ADAPTER_URI],
      format: 'markdown',
      directory: '   '
    });
    expect(result.success).toBe(false);
  });

  it('still requires space_name with all_adapters even when directory is set', () => {
    const result = exportInputSchema.safeParse({
      all_adapters: true,
      format: 'markdown',
      directory: DIR
    });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues.map((i) => i.message).join(' ');
    expect(message).toMatch(/space_name/);
  });

  it('still rejects training formats with multi-adapter selection regardless of directory', () => {
    const result = exportInputSchema.safeParse({
      adapters: [ADAPTER_URI, ADAPTER_URI_2],
      format: 'trace_jsonl',
      directory: DIR
    });
    expect(result.success).toBe(false);
  });
});
