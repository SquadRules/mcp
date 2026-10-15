/**
 * Vector width validation for LanceDB stores.
 * 
 * The embedded LanceDB store names vector columns by width (vs{dim}, adapter_title_vs{dim},
 * activation_pattern_vs{dim}). A store's width is bound to the provider that created it.
 * This module validates width compatibility before writes to prevent silent corruption.
 */

import type { LanceTable } from '../lancedb-connection.js';

/** Result of schema inspection: absent, valid single width, or invalid/ambiguous. */
export type SchemaInspectionResult =
  | { status: 'absent' }
  | { status: 'valid'; primaryWidth: number; companionWidths: number[] }
  | { status: 'invalid'; reason: string };

/**
 * Inspect the table schema and extract vector widths.
 * Returns absent if table doesn't exist, valid if single primary width found,
 * invalid if multiple/missing/ambiguous widths.
 */
export async function inspectSchema(table: LanceTable | null): Promise<SchemaInspectionResult> {
  if (!table) return { status: 'absent' };
  
  try {
    const schema = await table.schema();
    const fields = schema.fields || [];
    
    const primaryWidths: number[] = [];
    const companionWidths: number[] = [];
    
    for (const field of fields) {
      const name = field.name as string;
      // Primary vector: vs{dim}
      const primaryMatch = name.match(/^vs(\d+)$/);
      if (primaryMatch) {
        primaryWidths.push(parseInt(primaryMatch[1]!, 10));
        continue;
      }
      // Companion vectors: adapter_title_vs{dim}, activation_pattern_vs{dim}
      const companionMatch = name.match(/^(?:adapter_title|activation_pattern)_vs(\d+)$/);
      if (companionMatch) {
        companionWidths.push(parseInt(companionMatch[1]!, 10));
      }
    }
    
    // No vector columns found - table exists but has no vectors (edge case)
    if (primaryWidths.length === 0 && companionWidths.length === 0) {
      return { status: 'absent' };
    }
    
    // Check for multiple primary widths (ambiguous)
    const uniquePrimary = [...new Set(primaryWidths)];
    if (uniquePrimary.length > 1) {
      return {
        status: 'invalid',
        reason: `Multiple primary vector widths found: ${uniquePrimary.join(', ')}`
      };
    }
    
    // Check for missing primary width
    if (uniquePrimary.length === 0) {
      return {
        status: 'invalid',
        reason: 'No primary vector column (vs{dim}) found'
      };
    }
    
    const primaryWidth = uniquePrimary[0]!;
    
    // Validate companion widths match primary
    const mismatchedCompanions = companionWidths.filter(w => w !== primaryWidth);
    if (mismatchedCompanions.length > 0) {
      return {
        status: 'invalid',
        reason: `Companion vector widths ${mismatchedCompanions.join(', ')} do not match primary width ${primaryWidth}`
      };
    }
    
    return {
      status: 'valid',
      primaryWidth,
      companionWidths: [...new Set(companionWidths)]
    };
  } catch (err) {
    return {
      status: 'invalid',
      reason: `Schema inspection failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/**
 * Validate that a batch of vectors matches the stored schema width.
 * Throws EMBEDDING_STORE_WIDTH_MISMATCH on mismatch.
 */
export function validateVectorWidths(
  vectors: number[][],
  expectedWidth: number,
  operation: string
): void {
  for (let i = 0; i < vectors.length; i++) {
    const vec = vectors[i];
    if (!Array.isArray(vec)) {
      throw new EmbeddingSchemaInvalidError(
        `Vector at index ${i} is not an array during ${operation}`
      );
    }
    if (vec.length !== expectedWidth) {
      throw new EmbeddingWidthMismatchError(expectedWidth, vec.length, operation);
    }
    // Check for non-finite values
    if (vec.some(v => !Number.isFinite(v))) {
      throw new EmbeddingSchemaInvalidError(
        `Vector at index ${i} contains non-finite values during ${operation}`
      );
    }
  }
}

/**
 * Error class for width mismatch with structured context.
 */
export class EmbeddingWidthMismatchError extends Error {
  readonly code = 'EMBEDDING_STORE_WIDTH_MISMATCH';
  readonly expectedWidth: number;
  readonly actualWidth: number;
  readonly operation: string;
  
  constructor(expectedWidth: number, actualWidth: number, operation: string) {
    super(
      `EMBEDDING_STORE_WIDTH_MISMATCH: Store expects ${expectedWidth}d vectors, ` +
      `but ${operation} produced ${actualWidth}d vectors. ` +
      `The store's width is bound to the provider that created it.`
    );
    this.name = 'EmbeddingWidthMismatchError';
    this.expectedWidth = expectedWidth;
    this.actualWidth = actualWidth;
    this.operation = operation;
  }
}

/**
 * Error class for schema validation failures.
 */
export class EmbeddingSchemaInvalidError extends Error {
  readonly code = 'EMBEDDING_STORE_SCHEMA_INVALID';
  readonly reason: string;
  
  constructor(reason: string) {
    super(`EMBEDDING_STORE_SCHEMA_INVALID: ${reason}`);
    this.name = 'EmbeddingSchemaInvalidError';
    this.reason = reason;
  }
}
