/**
 * Embedding provider resolution: candidate selection and successful provider tracking.
 * Separates "what we'll try" (candidate) from "what worked" (successful descriptor).
 */

import { EMBEDDING_PROVIDER, OPENAI_API_KEY, OPENAI_API_URL_EXPLICIT, TEI_BASE_URL, TEI_MODEL, OPENAI_EMBEDDING_MODEL } from '../../config.js';

/**
 * Successful embedding provider descriptor.
 * Set only after a provider has successfully initialized and returned valid vectors.
 */
export interface SuccessfulProviderDescriptor {
  provider: 'openai' | 'tei' | 'fastembed';
  model: string;
  dimension: number;
}

let _successfulDescriptor: SuccessfulProviderDescriptor | null = null;

/**
 * Pure candidate resolver: what provider we'll try based on preference and configuration.
 * This does NOT indicate what actually succeeded - only what we'll attempt.
 * 
 * Resolution rule: explicit preference wins, else auto means:
 *   (OPENAI_API_KEY || OPENAI_API_URL explicitly overridden) ? openai : fastembed
 * TEI is deprecated but still supported as a transitional fallback.
 */
export function resolveCandidateProvider(): 'openai' | 'tei' | 'fastembed' {
  const pref = EMBEDDING_PROVIDER;
  
  // Explicit preference wins
  if (pref === 'openai') return 'openai';
  if (pref === 'tei') return 'tei';
  if (pref === 'fastembed') return 'fastembed';
  
  // auto: autodetection
  // OPENAI_API_KEY or explicitly overridden OPENAI_API_URL selects OpenAI-compatible
  if (OPENAI_API_KEY) return 'openai';
  if (isOpenAiUrlExplicitlyOverridden()) return 'openai';
  
  // Transitional TEI fallback (deprecated)
  if (TEI_BASE_URL && TEI_MODEL) return 'tei';
  
  // Zero-configuration default
  return 'fastembed';
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
export function getModelNameForProvider(provider: 'openai' | 'tei' | 'fastembed'): string {
  if (provider === 'tei') return TEI_MODEL;
  if (provider === 'fastembed') {
    // Lazy import to avoid circular dependency
    const { FASTEMBED_MODEL } = require('../../config.js');
    return FASTEMBED_MODEL;
  }
  return OPENAI_EMBEDDING_MODEL;
}

/**
 * Record the successful provider after initialization.
 * Must be called only after a provider has successfully returned valid vectors.
 */
export function setSuccessfulProvider(
  provider: 'openai' | 'tei' | 'fastembed',
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
