/**
 * Persisted metadata for the embedded LanceDB store.
 *
 * Records the provider, model, and vector dimension that created the store.
 * On boot, the runtime compares the stored values with the current provider
 * to detect width mismatches before any read or write touches the table.
 *
 * File: `<lancedb-dir>/store-metadata.json`
 */
import fs from 'node:fs';
import path from 'node:path';
import { structuredLogger } from '../../../utils/structured-logger.js';

export interface LanceStoreMetadata {
  provider: string;
  model: string;
  dimension: number;
  created_at: string;
  updated_at: string;
}

const METADATA_FILE = 'store-metadata.json';

function metadataPath(lancedbDir: string): string {
  return path.join(lancedbDir, METADATA_FILE);
}

export function readStoreMetadata(lancedbDir: string): LanceStoreMetadata | null {
  const fp = metadataPath(lancedbDir);
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LanceStoreMetadata>;
    if (typeof parsed.provider !== 'string' || typeof parsed.model !== 'string' || typeof parsed.dimension !== 'number') {
      structuredLogger.warn('[LanceStoreMetadata] Corrupt metadata file; ignoring');
      return null;
    }
    return parsed as LanceStoreMetadata;
  } catch (err) {
    structuredLogger.warn(`[LanceStoreMetadata] Failed to read metadata: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function writeStoreMetadata(lancedbDir: string, meta: Omit<LanceStoreMetadata, 'created_at' | 'updated_at'>): LanceStoreMetadata {
  const fp = metadataPath(lancedbDir);
  const existing = readStoreMetadata(lancedbDir);
  const record: LanceStoreMetadata = {
    ...meta,
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  try {
    fs.mkdirSync(lancedbDir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(record, null, 2), 'utf8');
  } catch (err) {
    structuredLogger.warn(`[LanceStoreMetadata] Failed to write metadata: ${err instanceof Error ? err.message : String(err)}`);
  }
  return record;
}

/**
 * Check stored width against current provider dimension.
 * Returns null if no metadata exists (first boot), or a comparison result.
 */
export function checkWidthConsistency(
  lancedbDir: string,
  currentProvider: string,
  currentModel: string,
  currentDimension: number
): { consistent: true } | { consistent: false; stored: LanceStoreMetadata; reason: string } {
  const stored = readStoreMetadata(lancedbDir);
  if (!stored) return { consistent: true };
  if (stored.dimension !== currentDimension) {
    return {
      consistent: false,
      stored,
      reason: `Store was created with ${stored.provider}/${stored.model} (${stored.dimension}d) but current provider is ${currentProvider}/${currentModel} (${currentDimension}d). Delete the store at ${lancedbDir} to recreate, or revert the embedding provider.`
    };
  }
  return { consistent: true };
}
