import { describe, expect, it } from '@jest/globals';
import path from 'node:path';
import { buildExportInput } from '../../src/cli/commands/export.js';

const ADAPTER_URI = 'squadrules://adapter/sample-adapter-a';
const ADAPTER_URI_2 = 'squadrules://adapter/sample-adapter-b';

describe('cli buildExportInput selection union', () => {
  it('builds single-uri selection from positional argument', () => {
    const input = buildExportInput(ADAPTER_URI, { as: 'markdown' });
    expect(input.uri).toBe(ADAPTER_URI);
    expect(input.adapters).toBeUndefined();
    expect(input.all_adapters).toBeUndefined();
    expect(input.format).toBe('markdown');
  });

  it('builds adapters[] selection from repeated --adapters', () => {
    const input = buildExportInput(undefined, {
      adapters: [ADAPTER_URI, 'my-slug', ADAPTER_URI_2],
      as: 'skill_zip'
    });
    expect(input.adapters).toEqual([ADAPTER_URI, 'my-slug', ADAPTER_URI_2]);
    expect(input.uri).toBeUndefined();
    expect(input.all_adapters).toBeUndefined();
    expect(input.format).toBe('skill_zip');
  });

  it('builds all_adapters selection with space_name', () => {
    const input = buildExportInput(undefined, {
      allAdapters: true,
      space: 'personal',
      as: 'skill_zip'
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
      buildExportInput(ADAPTER_URI, { allAdapters: true, space: 'personal' })
    ).toThrow(/exactly one selection/i);
  });

  it('rejects --adapters combined with --all-adapters', () => {
    expect(() =>
      buildExportInput(undefined, {
        adapters: [ADAPTER_URI],
        allAdapters: true,
        space: 'personal'
      })
    ).toThrow(/exactly one selection/i);
  });

  it('rejects --all-adapters without --space', () => {
    expect(() =>
      buildExportInput(undefined, { allAdapters: true })
    ).toThrow(/--space/i);
  });

  it('rejects --space without --all-adapters', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { space: 'personal' })
    ).toThrow(/--space is only valid with --all-adapters/);
  });

  it('whitespace-only positional uri counts as missing selection', () => {
    expect(() => buildExportInput('   ', {})).toThrow(/selection/i);
  });

  it('uses skill_zip as default format when not provided', () => {
    const input = buildExportInput(ADAPTER_URI, {});
    expect(input.format).toBe('skill_zip');
  });

  it('omits delivery when --delivery is not provided', () => {
    const input = buildExportInput(ADAPTER_URI, {});
    expect(input.delivery).toBeUndefined();
  });

  it('passes --delivery through for skill_zip', () => {
    expect(buildExportInput(ADAPTER_URI, { delivery: 'inline_base64' }).delivery).toBe('inline_base64');
    expect(buildExportInput(ADAPTER_URI, { delivery: 'download_ref' }).delivery).toBe('download_ref');
    expect(
      buildExportInput(undefined, { allAdapters: true, space: 'personal', delivery: 'inline_base64' }).delivery
    ).toBe('inline_base64');
  });

  it('rejects an unknown --delivery value', () => {
    expect(() => buildExportInput(ADAPTER_URI, { delivery: 'carrier-pigeon' })).toThrow(
      /--delivery must be one of: download_ref, inline_base64/
    );
  });

  it('rejects --delivery with a non-skill_zip format', () => {
    expect(() => buildExportInput(ADAPTER_URI, { as: 'skill_tree', delivery: 'inline_base64' })).toThrow(
      /--delivery is only valid with --as skill_zip/
    );
  });

  it('accepts --to with a single uri and a content format', () => {
    const input = buildExportInput(ADAPTER_URI, { as: 'source', to: '/tmp/artifacts/gates.py' });
    expect(input.uri).toBe(ADAPTER_URI);
    expect(input.format).toBe('source');
  });

  it('rejects --to without a positional uri', () => {
    expect(() =>
      buildExportInput(undefined, { adapters: [ADAPTER_URI], as: 'source', to: '/tmp/x.py' })
    ).toThrow(/--to <file> requires a single <uri> selection/);
  });

  it('rejects --to combined with skill_zip', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { to: '/tmp/x.zip' })
    ).toThrow(/cannot be combined with skill_zip/);
  });

  it('rejects --to combined with --zip-out', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { as: 'markdown', to: '/tmp/x.md', zipOut: '/tmp/x.zip' })
    ).toThrow(/cannot be combined with --zip-out/);
  });

  it('rejects --to combined with --out', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { as: 'markdown', to: '/tmp/x.md', out: '/tmp' })
    ).toThrow(/cannot be combined with --out/);
  });
});

describe('cli buildExportInput --directory (issue #201 gap 2)', () => {
  it('omits directory when --directory is not provided', () => {
    expect(buildExportInput(ADAPTER_URI, { as: 'markdown' }).directory).toBeUndefined();
  });

  it('passes an absolute --directory through for a single uri', () => {
    const input = buildExportInput(ADAPTER_URI, { as: 'markdown', directory: '/tmp/backup' });
    expect(input.directory).toBe('/tmp/backup');
    expect(input.format).toBe('markdown');
  });

  it('passes --directory through for --adapters and --all-adapters selections', () => {
    expect(
      buildExportInput(undefined, { adapters: [ADAPTER_URI, ADAPTER_URI_2], as: 'markdown', directory: '/tmp/backup' })
        .directory
    ).toBe('/tmp/backup');
    expect(
      buildExportInput(undefined, { allAdapters: true, space: 'personal', as: 'markdown', directory: '/tmp/backup' })
        .directory
    ).toBe('/tmp/backup');
  });

  it('resolves a relative --directory against the current directory', () => {
    const input = buildExportInput(ADAPTER_URI, { as: 'markdown', directory: './backup' });
    expect(input.directory).toBe(path.resolve(process.cwd(), './backup'));
    expect(path.isAbsolute(input.directory!)).toBe(true);
  });

  it('rejects --directory with the default skill_zip format', () => {
    expect(() => buildExportInput(ADAPTER_URI, { directory: '/tmp/backup' })).toThrow(
      /--directory is only valid with --as markdown/
    );
  });

  it('rejects --directory with other non-markdown formats', () => {
    expect(() => buildExportInput(ADAPTER_URI, { as: 'skill_tree', directory: '/tmp/backup' })).toThrow(
      /--directory is only valid with --as markdown/
    );
  });

  it('rejects --directory combined with --out', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { as: 'markdown', directory: '/tmp/backup', out: '/tmp/out' })
    ).toThrow(/--directory cannot be combined with --out/);
  });

  it('rejects --directory combined with --zip-out', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { as: 'markdown', directory: '/tmp/backup', zipOut: '/tmp/x.zip' })
    ).toThrow(/--directory cannot be combined with --zip-out/);
  });

  it('rejects --directory combined with --to', () => {
    expect(() =>
      buildExportInput(ADAPTER_URI, { as: 'markdown', directory: '/tmp/backup', to: '/tmp/x.md' })
    ).toThrow(/--to <file> cannot be combined with --directory/);
  });
});
