/**
 * Test utilities for embedding dimension.
 * 
 * The production code derives the embedding dimension from the provider's actual response
 * via `getEmbeddingDimension()` (set by first provider response). Tests that need a default
 * dimension should use `getTestEmbeddingDimension()` which returns the shipped default
 * fastembed dimension (384 for fast-bge-small-en-v1.5).
 * 
 * Exception: tests that verify the app created the correct dimension (like width-binding tests)
 * keep hardcoded values as the "expected" dimension to prove the app chose correctly.
 */

/**
 * Default embedding dimension for tests (384 for fast-bge-small-en-v1.5).
 * 
 * Use this in tests that need a default dimension but don't want to hardcode 384.
 * Tests that verify the app created the correct dimension should keep hardcoded values.
 */
export const DEFAULT_TEST_EMBEDDING_DIMENSION = 384;

/**
 * Returns the default embedding dimension for tests.
 * 
 * This is a convenience function that returns `DEFAULT_TEST_EMBEDDING_DIMENSION`.
 * Use this in tests that need to create mock embeddings or assert on dimension
 * without hardcoding the value.
 */
export function getTestEmbeddingDimension(): number {
  return DEFAULT_TEST_EMBEDDING_DIMENSION;
}
