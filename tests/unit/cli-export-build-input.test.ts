import { describe, expect, it } from '@jest/globals';
import { buildExportInput } from '../../src/cli/commands/export.js';

const ADAPTER_URI = 'squadrules://adapter/sample-adapter-a';
const ADAPTER_URI_2 = 'squadrules://adapter/sample-adapter-b';

describe('cli buildExportInput selection union', () => {
  it('builds single-uri selection from positional argument', () => {
    const input = buildExportInput(ADAPTER_URI, { format: 'markdown' });
    expect(input.uri).toBe(ADAPTER_URI);
    expect(input.adapters).toBeUndefined();
    expect(input.all_adapters).toBeUndefined();
    expect(input.format).toBe('markdown');
  });

  it('builds adapters[] selection from repeated --adapters', () => {
    const input = buildExportInput(undefined, {
      adapters: [ADAPTER_URI, 'my-slug', ADAPTER_URI_2],
      format: 'skill_zip'
    });
    expect(input.adapters).toEqual([ADAPTER_URI, 'my-slug', ADAPTER_URI_2]);
    expect(input.uri).toBeUndefined();
    expect(input.all_adapters).toBeUndefined();
    expect(input.format).toBe('skill_zip');
  });

  it('builds all_adapters selection with space_name', () => {
    const input = buildExportInput(undefined, {
      allAdapters: true,
      spaceName: 'personal',
      format: 'skill_zip'
    });
    expect(input.all_adapters).toBe(true);
    expect(input.space_name).toBe('personal');
    expect(input.uri).toBeUndefined();
    expect(input.adapters).toBeUndefined();
  });

  it('rejects no selection at all', () => {
    expect(() => buildExportInput(undefined, {})).toThrow(/selection/i);
  });

  it('rejects positional uri combined with --adapters', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { adapters: [ADAPTER_URI_2] })
    ).toThrow(/exactly one selection/i);
  });

  it('rejects positional uri combined with --all-adapters', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { allAdapters: true, spaceName: 'personal' })
    ).toThrow(/exactly one selection/i);
  });

  it('rejects --adapters combined with --all-adapters', () => {
    expect(() =>
      buildExportInput(undefined, {
        adapters: [ADAPTER_URI],
        allAdapters: true,
        spaceName: 'personal'
      })
    ).toThrow(/exactly one selection/i);
  });

  it('rejects --all-adapters without --space-name', () => {
    expect(() =>
      buildExportInput(undefined, { allAdapters: true })
    ).toThrow(/space-name/i);
  });

  it('rejects --space-name without --all-adapters', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { spaceName: 'personal' })
    ).toThrow(/--space-name is only valid with --all-adapters/);
  });

  it('whitespace-only positional uri counts as missing selection', () => {
    expect(() => buildExportInput('   ', {})).toThrow(/selection/i);
  });

  it('uses markdown as default format when not provided', () => {
    const input = buildExportInput(ADAPTER_URI, {});
    expect(input.format).toBe('markdown');
  });
});
