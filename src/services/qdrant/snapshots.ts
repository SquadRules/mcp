import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { structuredLogger } from '../../utils/structured-logger.js';
import type { QdrantService } from './service.js';

type SnapshotReason = 'startup' | 'api';

export interface SnapshotOptions {
  enabled: boolean;
  directory: string;
  reason: SnapshotReason;
}

export interface SnapshotResult {
  success: boolean;
  skipped?: boolean;
  snapshotName?: string;
  filePath?: string;
  bytesWritten?: number;
  durationMs?: number;
  message?: string;
}

function sanitizeTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function ensureDirectory(targetDir: string): Promise<string> {
  const resolved = path.isAbsolute(targetDir) ? targetDir : path.resolve(targetDir);
  await mkdir(resolved, { recursive: true });
  const stats = await stat(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`Snapshot path is not a directory: ${resolved}`);
  }
  return resolved;
}

async function removePartialFile(filePath: string | undefined) {
  if (!filePath) return;
  try {
    await rm(filePath);
  } catch {
    // Intentionally ignore cleanup errors.
  }
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (apiKey) {
    headers['api-key'] = apiKey;
  }
  return headers;
}

function createSnapshotFilename(reason: SnapshotReason, collection: string): string {
  return `squadrules-${reason}-${collection}-${sanitizeTimestamp()}.snapshot`;
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export async function triggerQdrantSnapshot(
  qdrantService: QdrantService,
  options: SnapshotOptions
): Promise<SnapshotResult> {
  if (!options.enabled) {
    structuredLogger.info(`[snapshot:${options.reason}] Disabled via configuration`);
    return { success: false, skipped: true, message: 'disabled' };
  }

  if (!options.directory || options.directory.trim() === '') {
    structuredLogger.info(`[snapshot:${options.reason}] Backup directory not configured`);
    return { success: false, skipped: true, message: 'Backup directory is not defined in server settings.' };
  }

  const start = Date.now();
  const collection = qdrantService.collectionName;
  const baseUrl = normalizeBaseUrl(qdrantService.qdrantUrl);
  const headers = buildHeaders(qdrantService.apiKey);

  const snapshotCreateUrl = `${baseUrl}/collections/${encodeURIComponent(collection)}/snapshots`;
  let snapshotName: string | undefined;
  let filePath: string | undefined;

  try {
    const resolvedDir = await ensureDirectory(options.directory);
    const createResponse = await fetch(snapshotCreateUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ wait: true }),
    });

    if (!createResponse.ok) {
      const body = await createResponse.text().catch(() => '');
      structuredLogger.error(`[snapshot:${options.reason}] Qdrant snapshot create failed: HTTP ${createResponse.status} - ${body}`);
      return {
        success: false,
        message: `Failed to create snapshot: HTTP ${createResponse.status}`,
      };
    }

    const responseJson = await createResponse.json().catch(() => ({})) as Record<string, any>;
    snapshotName =
      responseJson?.['result']?.['name'] ||
      responseJson?.['snapshot']?.['name'] ||
      responseJson?.['name'] ||
      responseJson?.['result'];

    if (!snapshotName || typeof snapshotName !== 'string') {
      structuredLogger.error(`[snapshot:${options.reason}] Snapshot create response missing name: ${JSON.stringify(responseJson)}`);
      return {
        success: false,
        message: 'Snapshot created but no name returned',
      };
    }

    const downloadUrl = `${snapshotCreateUrl}/${encodeURIComponent(snapshotName)}`;
    const downloadResponse = await fetch(downloadUrl, { method: 'GET', headers });

    if (!downloadResponse.ok || !downloadResponse.body) {
      const body = await downloadResponse.text().catch(() => '');
      structuredLogger.error(`[snapshot:${options.reason}] Snapshot download failed: HTTP ${downloadResponse.status} - ${body}`);
      return {
        success: false,
        snapshotName: snapshotName!,
        message: `Failed to download snapshot: HTTP ${downloadResponse.status}`,
      };
    }

    filePath = path.join(resolvedDir, createSnapshotFilename(options.reason, collection));
    const writeStream = createWriteStream(filePath);
    let bytesWritten = 0;
    const readable = Readable.fromWeb(downloadResponse.body as any);
    readable.on('data', (chunk) => {
      bytesWritten += chunk.length;
    });

    await pipeline(readable, writeStream);

    const durationMs = Date.now() - start;
    structuredLogger.info(`[snapshot:${options.reason}] Qdrant snapshot completed: ${snapshotName} -> ${filePath} (${bytesWritten} bytes, ${durationMs}ms)`);

    return {
      success: true,
      snapshotName,
      filePath,
      bytesWritten,
      durationMs,
    };
  } catch (error) {
    await removePartialFile(filePath);
    structuredLogger.error(`[snapshot:${options.reason}] Snapshot pipeline failed: ${error instanceof Error ? error.message : String(error)}`);
    const result: SnapshotResult = {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
    if (snapshotName) {
      result.snapshotName = snapshotName;
    }
    return result;
  }
}

