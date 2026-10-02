// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Path and size checks for `skill_zip` CLI downloads. Same trust model as other `export` formats:
 * the CLI already emits API-returned markdown (and users redirect to files); ZIP is persisted via
 * `--zip-out` or a default basename under cwd after the same authenticated export flow.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_EXPORT_SKILL_ZIP_FILENAME } from '../config/export-zip-settings.js';

const DEFAULT_MAX_SKILL_ZIP_BYTES = 512 * 1024 * 1024;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function maxSkillZipDownloadBytes(): number {
  return parsePositiveInt(process.env['KAIROS_EXPORT_ZIP_MAX_DOWNLOAD_BYTES'], DEFAULT_MAX_SKILL_ZIP_BYTES);
}

/**
 * Accept only a single path segment like `my-export.zip` from server hints (Content-Disposition /
 * JSON). Rejects separators, odd characters, and long names.
 */
export function safeZipBasenameFromRemoteHint(name: string | undefined): string | null {
  if (name === undefined || name === null) return null;
  const s = String(name).trim();
  if (s.length === 0) return null;
  const base = path.basename(s.replace(/\\/g, '/'));
  if (!base || base === '.' || base === '..') return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/i.test(base)) return null;
  if (base.length > 200) return null;
  return base;
}

/**
 * Output path: explicit `--zip-out` (user-controlled), else `cwd/<sanitized remote basename or default>`.
 */
export function resolveSkillZipOutputPath(
  zipOut: string | undefined,
  hints: { downloadBasename?: string; refBasename?: string }
): string {
  if (zipOut !== undefined && zipOut.trim().length > 0) {
    return path.resolve(process.cwd(), zipOut.trim());
  }
  const remote =
    safeZipBasenameFromRemoteHint(hints.downloadBasename) ??
    safeZipBasenameFromRemoteHint(hints.refBasename);
  const base = remote ?? DEFAULT_EXPORT_SKILL_ZIP_FILENAME;
  return path.join(process.cwd(), base);
}

/** Reject non-ZIP payloads and oversized downloads before writing bytes from the network to disk. */
export function assertSkillZipBufferAllowedForDiskWrite(data: Buffer): void {
  const max = maxSkillZipDownloadBytes();
  if (data.length === 0) {
    throw new Error('Export ZIP download was empty.');
  }
  if (data.length > max) {
    throw new Error(
      `Export ZIP download exceeds configured maximum (${max} bytes); set KAIROS_EXPORT_ZIP_MAX_DOWNLOAD_BYTES to raise the cap.`
    );
  }
  const pk = data[0] === 0x50 && data[1] === 0x4b;
  if (!pk) {
    throw new Error('Export download did not look like a ZIP file (missing PK signature).');
  }
}

/** Write validated ZIP bytes after export (download_ref GET or inline base64 decode). */
export function writeExportedSkillZipToFile(outputPath: string, source: Buffer): void {
  assertSkillZipBufferAllowedForDiskWrite(source);
  writeFileSync(outputPath, source);
}
