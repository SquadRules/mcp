/**
 * Unit tests for LanceDB vector-width binding (#94).
 *
 * Covers:
 * - Store metadata read/write/checkWidthConsistency (lance-store-metadata.ts)
 * - Schema inspection and vector width validation (lance-width-validation.ts)
 *
 * Uses real temp directories for metadata tests; schema inspection tests use
 * mock table objects matching the LanceTable shape.
 */

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getTestEmbeddingDimension } from '../utils/embedding-test-utils.js';
import {
  readStoreMetadata,
  writeStoreMetadata,
  checkWidthConsistency
} from '../../src/services/vector-store/lancedb/lance-store-metadata.js';
import {
  inspectSchema,
  validateVectorWidths,
  EmbeddingWidthMismatchError,
  EmbeddingSchemaInvalidError
} from '../../src/services/vector-store/lancedb/lance-width-validation.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lance-width-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// lance-store-metadata.ts
// ---------------------------------------------------------------------------

describe('readStoreMetadata', () => {
  test('returns null when no metadata file exists', () => {
    expect(readStoreMetadata(tmpDir)).toBeNull();
  });

  test('reads a valid metadata file', () => {
    writeStoreMetadata(tmpDir, { provider: 'fastembed', model: 'fast-bge-small-en-v1.5', dimension: 384 });
    const meta = readStoreMetadata(tmpDir);
    expect(meta).not.toBeNull();
    expect(meta!.provider).toBe('fastembed');
    expect(meta!.model).toBe('fast-bge-small-en-v1.5');
    expect(meta!.dimension).toBe(384);
    expect(meta!.created_at).toBeTruthy();
    expect(meta!.updated_at).toBeTruthy();
  });

  test('returns null for corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'store-metadata.json'), '{broken', 'utf8');
    expect(readStoreMetadata(tmpDir)).toBeNull();
  });

  test('returns null for metadata with wrong types', () => {
    fs.writeFileSync(path.join(tmpDir, 'store-metadata.json'), JSON.stringify({
      provider: 123, model: 'x', dimension: 'not-a-number'
    }), 'utf8');
    expect(readStoreMetadata(tmpDir)).toBeNull();
  });
});

describe('writeStoreMetadata', () => {
  test('preserves created_at on subsequent writes', async () => {
    const first = writeStoreMetadata(tmpDir, { provider: 'fastembed', model: 'm1', dimension: 384 });
    // Wait 1ms to ensure updated_at differs
    await new Promise(r => setTimeout(r, 2));
    const second = writeStoreMetadata(tmpDir, { provider: 'openai', model: 'm2', dimension: 1536 });
    expect(second.created_at).toBe(first.created_at);
    expect(second.provider).toBe('openai');
    expect(second.dimension).toBe(1536);
    // updated_at should be a valid ISO string (may equal first if clock resolution is coarse)
    expect(new Date(second.updated_at).toISOString()).toBe(second.updated_at);
  });

  test('creates the directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'sub', 'dir');
    writeStoreMetadata(nested, { provider: 'fastembed', model: 'm', dimension: 384 });
    expect(readStoreMetadata(nested)).not.toBeNull();
  });
});

describe('checkWidthConsistency', () => {
  test('returns consistent when no metadata exists (first boot)', () => {
    const result = checkWidthConsistency(tmpDir, 'fastembed', 'model', 384);
    expect(result).toEqual({ consistent: true });
  });

  test('returns consistent when dimensions match', () => {
    writeStoreMetadata(tmpDir, { provider: 'fastembed', model: 'fast-bge-small-en-v1.5', dimension: 384 });
    const result = checkWidthConsistency(tmpDir, 'fastembed', 'fast-bge-small-en-v1.5', 384);
    expect(result).toEqual({ consistent: true });
  });

  test('returns inconsistent with reason when dimensions differ', () => {
    writeStoreMetadata(tmpDir, { provider: 'fastembed', model: 'fast-bge-small-en-v1.5', dimension: 384 });
    const result = checkWidthConsistency(tmpDir, 'openai', 'text-embedding-3-small', 1536);
    expect(result.consistent).toBe(false);
    if (!result.consistent) {
      expect(result.stored.dimension).toBe(384);
      expect(result.reason).toContain('384d');
      expect(result.reason).toContain('1536d');
      expect(result.reason).toContain('fastembed');
      expect(result.reason).toContain('openai');
    }
  });
});

// ---------------------------------------------------------------------------
// lance-width-validation.ts
// ---------------------------------------------------------------------------

/** Build a mock LanceTable with a given schema field list. */
function mockTable(fields: Array<{ name: string; type?: string }>): any {
  return {
    schema: async () => ({ fields })
  };
}

describe('inspectSchema', () => {
  test('returns absent for null table', async () => {
    const result = await inspectSchema(null);
    expect(result).toEqual({ status: 'absent' });
  });

  test('returns absent for table with no vector columns', async () => {
    const table = mockTable([
      { name: 'id' }, { name: 'payload' }, { name: 'space_id' }
    ]);
    const result = await inspectSchema(table);
    expect(result).toEqual({ status: 'absent' });
  });

  test('returns valid with primary width for standard schema', async () => {
    const table = mockTable([
      { name: 'id' },
      { name: 'vs384', type: 'vector' },
      { name: 'adapter_title_vs384', type: 'vector' },
      { name: 'activation_pattern_vs384', type: 'vector' },
      { name: 'bm25', type: 'vector' }
    ]);
    const result = await inspectSchema(table);
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.primaryWidth).toBe(384);
      expect(result.companionWidths).toEqual([384]);
    }
  });

  test('returns invalid for multiple primary widths', async () => {
    const table = mockTable([
      { name: 'vs384', type: 'vector' },
      { name: 'vs768', type: 'vector' }
    ]);
    const result = await inspectSchema(table);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.reason).toContain('Multiple primary vector widths');
    }
  });

  test('returns invalid for companion width mismatch', async () => {
    const table = mockTable([
      { name: 'vs384', type: 'vector' },
      { name: 'adapter_title_vs768', type: 'vector' }
    ]);
    const result = await inspectSchema(table);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.reason).toContain('Companion vector widths');
    }
  });

  test('returns invalid for missing primary column', async () => {
    const table = mockTable([
      { name: 'adapter_title_vs384', type: 'vector' }
    ]);
    const result = await inspectSchema(table);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.reason).toContain('No primary vector column');
    }
  });
});

describe('validateVectorWidths', () => {
  test('passes for matching widths', () => {
    const vectors = [[1, 2, 3], [4, 5, 6]];
    expect(() => validateVectorWidths(vectors, 3, 'test')).not.toThrow();
  });

  test('throws EmbeddingWidthMismatchError on dimension mismatch', () => {
    const vectors = [[1, 2, 3], [4, 5]];
    expect(() => validateVectorWidths(vectors, 3, 'test')).toThrow(EmbeddingWidthMismatchError);
    try {
      validateVectorWidths(vectors, 3, 'test');
    } catch (err) {
      expect(err).toBeInstanceOf(EmbeddingWidthMismatchError);
      const e = err as EmbeddingWidthMismatchError;
      expect(e.expectedWidth).toBe(3);
      expect(e.actualWidth).toBe(2);
      expect(e.operation).toBe('test');
      expect(e.code).toBe('EMBEDDING_STORE_WIDTH_MISMATCH');
    }
  });

  test('throws EmbeddingSchemaInvalidError for non-array vectors', () => {
    const vectors = ['not-an-array' as any];
    expect(() => validateVectorWidths(vectors, 3, 'test')).toThrow(EmbeddingSchemaInvalidError);
  });

  test('throws EmbeddingSchemaInvalidError for non-finite values', () => {
    const vectors = [[1, NaN, 3]];
    expect(() => validateVectorWidths(vectors, 3, 'test')).toThrow(EmbeddingSchemaInvalidError);
  });

  test('passes for empty vectors array', () => {
    expect(() => validateVectorWidths([], getTestEmbeddingDimension(), 'test')).not.toThrow();
  });
});
