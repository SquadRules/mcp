/**
 * Regression guard for issue #199 (CLI side): writeExport must turn an inline
 * base64 skill_zip response into a real zip on disk, and must fail with an
 * actionable error when the server returns a download_ref the active backend
 * cannot fetch (LocalBackend has no downloadExportRef) or returns no bytes at
 * all. Pure CLI-layer test — no runtime boot, no network.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeExport,
  type ExportCliOptions,
  type WrittenArtifact
} from '../../src/cli/commands/export.js';
import type { ActionBackend } from '../../src/cli/backend/action-backend.js';
import type { ExportOutput } from '../../src/tools/export_schema.js';
import { zipSkillFiles } from '../../src/tools/skill-export/zip-bundle.js';

const ADAPTER_URI = 'squadrules://adapter/sample-adapter-a';

/** Mirrors LocalBackend: no downloadExportRef implementation. */
const backendWithoutDownloader = { kind: 'local' } as unknown as ActionBackend;

describe('cli writeExport skill_zip delivery paths (issue #199)', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(path.join(os.tmpdir(), 'cli-export-write-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('writes a real zip from an inline base64 response', async () => {
    const zip = await zipSkillFiles([
      { path: 'sample-adapter-a/SKILL.md', content: '# Sample Adapter A\n' },
      { path: 'sample-adapter-a/SHA256SUMS', content: 'deadbeef  SKILL.md\n' }
    ]);
    const response: ExportOutput = {
      uri: ADAPTER_URI,
      format: 'skill_zip',
      content_type: 'application/zip',
      content: zip.toString('base64'),
      content_encoding: 'base64',
      adapter_name: 'Sample Adapter A'
    };

    const options: ExportCliOptions = { out: outDir };
    const written: WrittenArtifact[] = await writeExport(backendWithoutDownloader, response, options);

    expect(written).toHaveLength(1);
    expect(written[0]!.format).toBe('skill_zip');
    expect(written[0]!.bytes).toBe(zip.length);
    expect(path.dirname(written[0]!.path)).toBe(outDir);
    expect(readFileSync(written[0]!.path)).toEqual(zip);
  });

  it('honours --zip-out for an inline base64 response', async () => {
    const zip = await zipSkillFiles([{ path: 'sample-adapter-a/SKILL.md', content: '# x\n' }]);
    const response: ExportOutput = {
      uri: ADAPTER_URI,
      format: 'skill_zip',
      content_type: 'application/zip',
      content: zip.toString('base64'),
      content_encoding: 'base64'
    };
    const zipOut = path.join(outDir, 'explicit', 'single.zip');

    const written = await writeExport(backendWithoutDownloader, response, { zipOut });

    expect(written[0]!.path).toBe(zipOut);
    expect(readFileSync(zipOut)).toEqual(zip);
  });

  it('fails with an actionable error for a download_ref the backend cannot fetch', async () => {
    const response: ExportOutput = {
      uri: ADAPTER_URI,
      format: 'skill_zip',
      content_type: 'application/zip',
      content: '',
      download_ref: {
        url: 'http://localhost:3000/export/skill-zip/opaque-token',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        filename: 'sample-export.zip'
      }
    };

    const error = await writeExport(backendWithoutDownloader, response, { out: outDir }).then(
      () => undefined,
      (thrown: unknown) => thrown as Error
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/download_ref this backend cannot fetch/);
    expect(error!.message).toMatch(/--delivery inline_base64/);
    expect(error!.message).toMatch(/--as skill_tree/);
  });

  it('fails with an actionable error when no bytes came back at all', async () => {
    const response: ExportOutput = {
      uri: ADAPTER_URI,
      format: 'skill_zip',
      content_type: 'application/zip',
      content: ''
    };

    await expect(writeExport(backendWithoutDownloader, response, { out: outDir })).rejects.toThrow(
      /no inline base64 content and no download_ref.*--as skill_tree/
    );
  });

  it('still downloads through a backend that implements downloadExportRef', async () => {
    const zip = await zipSkillFiles([{ path: 'sample-adapter-a/SKILL.md', content: '# x\n' }]);
    const response: ExportOutput = {
      uri: ADAPTER_URI,
      format: 'skill_zip',
      content_type: 'application/zip',
      content: '',
      download_ref: {
        url: 'http://localhost:3000/export/skill-zip/opaque-token',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        filename: 'sample-export.zip'
      }
    };
    const backendWithDownloader = {
      kind: 'http',
      downloadExportRef: async () => ({ data: zip, filename: 'sample-export.zip' })
    } as unknown as ActionBackend;

    const written = await writeExport(backendWithDownloader, response, { out: outDir });

    expect(written[0]!.path).toBe(path.join(outDir, 'sample-export.zip'));
    expect(readFileSync(written[0]!.path)).toEqual(zip);
  });
});
