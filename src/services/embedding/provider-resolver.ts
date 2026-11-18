/**
 * Embedding provider resolution: candidate selection and successful provider tracking.
 * Separates "what we'll try" (candidate) from "what worked" (successful descriptor).
 */

import { logger } from '../../utils/structured-logger.js';
import { EMBEDDING_PROVIDER, OPENAI_API_KEY, OPENAI_API_URL_EXPLICIT, TEI_BASE_URL, TEI_MODEL, OPENAI_EMBEDDING_MODEL, TRANSFORMERS_MODEL_ID } from '../../config.js';
import type { EmbeddingProviderName } from './provider-audit.js';

/**
 * Successful embedding provider descriptor.
 * Set only after a provider has successfully initialized and returned valid vectors.
 * 'fastembed' remains in the union because historical store metadata contains it.
 */
export interface SuccessfulProviderDescriptor {
  provider: EmbeddingProviderName;
  model: string;
  dimension: number;
}

let _successfulDescriptor: SuccessfulProviderDescriptor | null = null;

/** One-time (per process) deprecation notice for the 'fastembed' provider alias (issue #252). */
let fastEmbedAliasWarned = false;
export function warnFastEmbedAliasDeprecated(): void {
  if (fastEmbedAliasWarned) return;
  fastEmbedAliasWarned = true;
  logger.warn(
    { category: 'embedding.deprecated-provider', provider: 'fastembed' },
    "EMBEDDING_PROVIDER='fastembed' is a deprecated alias (issue #252); resolving to the local 'transformers' runtime (@huggingface/transformers). Set EMBEDDING_PROVIDER=transformers."
  );
}

/**
 * Pure candidate resolver: what provider we'll try based on preference and configuration.
 * This does NOT indicate what actually succeeded - only what we'll attempt.
 *
 * Resolution rule: explicit preference wins, else auto means:
 *   (OPENAI_API_KEY || OPENAI_API_URL explicitly overridden) ? openai : transformers
 * TEI is deprecated but still supported as a transitional fallback.
 * 'fastembed' is accepted as a deprecated alias resolving to 'transformers' (issue #252).
 */
export function resolveCandidateProvider(): 'openai' | 'tei' | 'transformers' {
  const pref = EMBEDDING_PROVIDER;

  // Explicit preference wins
  if (pref === 'openai') return 'openai';
  if (pref === 'tei') return 'tei';
  if (pref === 'transformers') return 'transformers';
  if (pref === 'fastembed') {
    warnFastEmbedAliasDeprecated();
    return 'transformers';
  }

  // auto: autodetection
  // OPENAI_API_KEY or explicitly overridden OPENAI_API_URL selects OpenAI-compatible
  if (OPENAI_API_KEY) return 'openai';
  if (isOpenAiUrlExplicitlyOverridden()) return 'openai';

  // Transitional TEI fallback (deprecated)
  if (TEI_BASE_URL && TEI_MODEL) return 'tei';

  // Zero-configuration default
  return 'transformers';
}

/**
 * Check if OPENAI_API_URL was explicitly overridden (not just the baked default).
 */
function isOpenAiUrlExplicitlyOverridden(): boolean {
  return OPENAI_API_URL_EXPLICIT;
}

/**
 * Get the model name for a given provider.
 */
export function getModelNameForProvider(provider: EmbeddingProviderName): string {
  if (provider === 'tei') return TEI_MODEL;
  if (provider === 'transformers' || provider === 'fastembed') return TRANSFORMERS_MODEL_ID;
  return OPENAI_EMBEDDING_MODEL;
}

/**
 * Record the successful provider after initialization.
 * Must be called only after a provider has successfully returned valid vectors.
 */
export function setSuccessfulProvider(
  provider: EmbeddingProviderName,
  model: string,
  dimension: number
): void {
  _successfulDescriptor = { provider, model, dimension };
}

/**
 * Get the successful provider descriptor, or null if not yet initialized.
 */
export function getSuccessfulProvider(): SuccessfulProviderDescriptor | null {
  return _successfulDescriptor;
}