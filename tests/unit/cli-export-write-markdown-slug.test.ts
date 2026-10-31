/**
 * Issue #201 gaps 2-3 (CLI write side): markdown artifacts written through --out are
 * named after the adapter slug (title fallback for URIs without a slug), and a
 * `directory` export reports the backend's directory_manifest instead of writing an
 * empty artifact. assertDirectorySupportedByBackend fails an http backend before the
 * round-trip. Pure CLI-layer test — no runtime boot, no network.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertDirectorySupportedByBackend,
  writeExport,
  type WrittenArtifact
} from '../../src/cli/commands/export.js';
import type { ActionBackend } from '../../src/cli/backend/action-backend.js';
import type { ExportOutput } from '../../src/tools/export_schema.js';

const ADAPTER_URI = 'squadrules://adapter/writing-for-humans';
const TITLE = 'Writing for Humans — documentation and status output standard';
const localBackend = { kind: 'local' } as unknown as ActionBackend;
const httpBackend = { kind: 'http' } as unknown as ActionBackend;

describe('cli writeExport markdown filename (issue #201 gap 3)', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(path.join(os.tmpdir(), 'cli-export-md-slug-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('names a markdown artifact after the adapter slug, not the title', async () => {
    const response: ExportOutput = {
      uri: ADAPTER_URI,
      format: 'markdown',
      content_type: 'text/markdown',
      content: `---\nslug: writing-for-humans\n---\n\n# ${TITLE}\n`,
      adapter_name: TITLE
    };

    const written: WrittenArtifact[] = await writeExport(localBackend, response, { out: outDir });

    expect(written).toHaveLength(1);
    expect(path.basename(written[0]!.path)).toBe('writing-for-humans.md');
    expect(readFileSync(written[0]!.path, 'utf8')).toContain(`# ${TITLE}`);
  });

  it('falls back to the sanitized title when the URI carries no slug', async () => {
    const response: ExportOutput = {
      uri: 'squadrules://layer/6f9d0f1a-2b3c-4d5e-8f90-a1b2c3d4e5f6',
      format: 'markdown',
      content_type: 'text/markdown',
      content: '# Doc\n',
      adapter_name: 'Writing for Humans'
    };

    const written = await writeExport(localBackend, response, { out: outDir });

    expect(path.basename(written[0]!.path)).toBe('Writing-for-Humans.md');
  });

  it('keeps title-based names for non-markdown formats (unchanged behaviour)', async () => {
    const response: ExportOutput = {
      uri: ADAPTER_URI,
      format: 'skill_tree',
      content_type: 'application/json',
      content: '{"format":"skill_tree"}',
      adapter_name: 'Writing for Humans'
    };

    const written = await writeExport(localBackend, response, { out: outDir });

    expect(path.basename(written[0]!.path)).toBe('Writing-for-Humans.json');
  });
});

describe('cli writeExport directory manifest (issue #201 gap 2)', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(path.join(os.tmpdir(), 'cli-export-dir-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('reports manifest entries and writes nothing itself', async () => {
    const response: ExportOutput = {
      uri: ADAPTER_URI,
      format: 'markdown',
      content_type: 'text/markdown',
      content: '',
      export_adapter_count: 2,
      directory_manifest: [
        { slug: 'writing-for-humans', path: '/tmp/backup/writing-for-humans.md', bytes: 12, status: 'written' },
        { slug: 'task-isolation', path: '/tmp/backup/task-isolation.md', bytes: 34, status: 'written' }
      ]
    };

    const written = await writeExport(localBackend, response, { out: outDir });

    expect(written).toEqual([
      { path: '/tmp/backup/writing-for-humans.md', bytes: 12, format: 'markdown' },
      { path: '/tmp/backup/task-isolation.md', bytes: 34, format: 'markdown' }
    ]);
    // No stray empty artifact next to the manifest-reported files.
    expect(existsSync(path.join(outDir, 'writing-for-humans.md'))).toBe(false);
  });

  it('fails with an actionable error when a manifest entry errored', async () => {
    const response: ExportOutput = {
      uri: ADAPTER_URI,
      format: 'markdown',
      content_type: 'text/markdown',
      content: '',
      directory_manifest: [
        { slug: 'writing-for-humans', path: '/tmp/backup/writing-for-humans.md', bytes: 12, status: 'written' },
        { slug: 'broken-adapter', path: '/tmp/backup/broken-adapter.md', bytes: 0, status: 'error', error: 'adapter not found' }
      ]
    };

    await expect(writeExport(localBackend, response, {})).rejects.toThrow(
      /1 of 2 adapter exports failed.*broken-adapter: adapter not found.*remain on disk/s
    );
  });
});

describe('cli assertDirectorySupportedByBackend (issue #201 gap 2)', () => {
  it('rejects --directory against an http backend with an actionable alternative', () => {
    expect(() =>
      assertDirectorySupportedByBackend(httpBackend, {
        uri: ADAPTER_URI,
        format: 'markdown',
        include_reward: true,
        directory: '/tmp/backup'
      })
    ).toThrow(/only supported in local mode.*--as skill_zip.*--out <dir>/s);
  });

  it('accepts --directory on the local backend', () => {
    expect(() =>
      assertDirectorySupportedByBackend(localBackend, {
        uri: ADAPTER_URI,
        format: 'markdown',
        include_reward: true,
        directory: '/tmp/backup'
      })
    ).not.toThrow();
  });

  it('is a no-op when no directory was requested', () => {
    expect(() =>
      assertDirectorySupportedByBackend(httpBackend, {
        uri: ADAPTER_URI,
        format: 'markdown',
        include_reward: true
      })
    ).not.toThrow();
  });
});
