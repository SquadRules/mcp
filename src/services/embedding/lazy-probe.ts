/**
 * Lazy, memoized embedding-dimension probe.
 *
 * `probeEmbeddingDimension()` loads the embedding model (fastembed ONNX or a
 * remote provider round-trip) and caches the resolved dimension. Server boot
 * calls it eagerly; the CLI local backend defers it until a command actually
 * needs embeddings (activate / train / a fresh seed) so read-only commands stay
 * fast. Memoized here so eager and lazy callers share one model load per process.
 */
import { probeEmbeddingDimension } from './service.js';

let inflight: Promise<number> | null = null;

/**
 * Resolve and cache the embedding dimension, loading the model on first use.
 * Idempotent: concurrent and repeat callers share a single probe. A failed probe
 * is not cached, so a later call can retry (for example once a provider is up).
 */
export function ensureEmbeddingDimension(): Promise<number> {
  if (!inflight) {
    inflight = probeEmbeddingDimension().catch((err) => {
      inflight = null;
      throw err;
    });
  }
  return inflight;
}
