/**
 * Local Transformers.js embedding defaults (issue #252) — kept out of `config.ts`
 * to satisfy the max-lines budget, following the `src/config/*` convention.
 *
 * Replaces the archived fastembed runtime with `@huggingface/transformers`.
 * Canonical env vars are `TRANSFORMERS_*`; legacy `FASTEMBED_*` vars are honored
 * as deprecated fallbacks (mapping below). Re-exported from `config.ts` so
 * consumers keep importing from the central config module.
 *
 * No logger import here: `config.ts` re-exports this module mid-evaluation and
 * the structured logger reads config constants at module scope (import cycle /
 * TDZ hazard). Deprecation notices are therefore collected as pure data and
 * emitted once via structuredLogger by the embedding runtime.
 */
import { getEmbeddingModelsCacheDir } from '../utils/squadrules-user-dirs.js';

function getEnvString(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/** Default HuggingFace repo id (bge-small-en-v1.5, 384 dims — same width as the shipped fastembed default). */
export const TRANSFORMERS_MODEL_DEFAULT = 'Xenova/bge-small-en-v1.5';
/** Pinned model revision (commit sha) so the artifact cannot drift under users; fastembed tracked `main`. */
export const TRANSFORMERS_MODEL_REVISION_DEFAULT = 'ea104dacec62c0de699686887e3f920caeb4f3e3';
/**
 * PROVISIONAL (issue #252): `fp16` is numerically closest to the artifact fastembed
 * actually shipped (Qdrant's "optimized" export is fp16, not int8). The manager may
 * change this after the CI equivalence verdict; this constant is its single home.
 */
export const TRANSFORMERS_DTYPE_DEFAULT = 'fp16';

const canonicalModelEnv = getEnvString('TRANSFORMERS_MODEL', '');
const legacyModelEnv = getEnvString('FASTEMBED_MODEL', '');

// Legacy FASTEMBED_MODEL is a fastembed enum value, NOT a HuggingFace repo id.
// Only the shipped default maps automatically; any other enum value must be
// re-expressed as a TRANSFORMERS_MODEL repo id by the operator (no silent guesses).
// An explicit TRANSFORMERS_MODEL wins and the legacy var is ignored (with a notice).
if (!canonicalModelEnv && legacyModelEnv && legacyModelEnv !== 'fast-bge-small-en-v1.5') {
  throw new Error(
    `FASTEMBED_MODEL="${legacyModelEnv}" is not supported by the Transformers.js embedding runtime (issue #252). ` +
    `Only the legacy default 'fast-bge-small-en-v1.5' maps automatically. ` +
    `Set TRANSFORMERS_MODEL to a HuggingFace repo id (default '${TRANSFORMERS_MODEL_DEFAULT}') and remove FASTEMBED_MODEL.`
  );
}

/** HuggingFace repo id loaded by the local feature-extraction pipeline. */
export const TRANSFORMERS_MODEL = canonicalModelEnv || TRANSFORMERS_MODEL_DEFAULT;
/** Model revision (commit sha, branch or tag) pinned for reproducible downloads. */
export const TRANSFORMERS_MODEL_REVISION = getEnvString('TRANSFORMERS_MODEL_REVISION', TRANSFORMERS_MODEL_REVISION_DEFAULT);
/** ONNX artifact precision (see TRANSFORMERS_DTYPE_DEFAULT — provisional). */
export const TRANSFORMERS_DTYPE = getEnvString('TRANSFORMERS_DTYPE', TRANSFORMERS_DTYPE_DEFAULT);

const legacyCacheDirEnv = getEnvString('FASTEMBED_CACHE_DIR', '');
/**
 * Directory Transformers.js downloads/loads model weights from (`env.cacheDir`).
 * Defaults to the user-shared embedding models cache (`~/.cache/embedding-models`
 * on Unix, XDG style), shared across embedding libraries. Legacy FASTEMBED_CACHE_DIR
 * is honored as a deprecated fallback when TRANSFORMERS_CACHE_DIR is unset. The
 * on-disk layout differs from fastembed's, so the first run re-downloads once.
 */
export const TRANSFORMERS_CACHE_DIR =
  getEnvString('TRANSFORMERS_CACHE_DIR', '') || legacyCacheDirEnv || getEmbeddingModelsCacheDir();

/**
 * Stable descriptive model id reported to provider metadata and audit logs:
 * HuggingFace repo id plus the short revision (e.g. `Xenova/bge-small-en-v1.5@ea104da`).
 */
export const TRANSFORMERS_MODEL_ID = `${TRANSFORMERS_MODEL}@${TRANSFORMERS_MODEL_REVISION.slice(0, 7)}`;

/**
 * Preprocessing parity with shipped fastembed (issue #252): CLS pooling and L2
 * normalization, no query/passage prefixes. Truncation (to model_max_length 512)
 * and padding (to longest-in-batch) are the feature-extraction pipeline's built-in
 * defaults. PROVISIONAL: the CI equivalence verdict may require fixed-512 padding;
 * that needs a tokenizer-level change because FeatureExtractionPipeline hardcodes
 * `{ padding: true, truncation: true }` — these constants are the single home for
 * the pooling/normalize decision until then.
 */
export const TRANSFORMERS_POOLING = 'cls' as const;
export const TRANSFORMERS_NORMALIZE = true;

/**
 * Deprecation notices for legacy FASTEMBED_* env usage, captured at config
 * resolution time. Emitted once via structuredLogger by the embedding runtime
 * (transformers-provider on first init); pure data here to avoid a config/logger
 * import cycle.
 */
export function getLegacyFastEmbedEnvWarnings(): string[] {
  const warnings: string[] = [];
  if (legacyModelEnv) {
    warnings.push(canonicalModelEnv
      ? 'FASTEMBED_MODEL is deprecated and ignored because TRANSFORMERS_MODEL is set (issue #252). Remove FASTEMBED_MODEL.'
      : `FASTEMBED_MODEL="${legacyModelEnv}" is deprecated (issue #252); mapped to the Transformers.js default ${TRANSFORMERS_MODEL_ID}. Use TRANSFORMERS_MODEL / TRANSFORMERS_MODEL_REVISION / TRANSFORMERS_DTYPE instead.`);
  }
  if (legacyCacheDirEnv && !getEnvString('TRANSFORMERS_CACHE_DIR', '')) {
    warnings.push('FASTEMBED_CACHE_DIR is deprecated (issue #252); honored as the model cache directory. Rename it to TRANSFORMERS_CACHE_DIR.');
  }
  return warnings;
}

/** @deprecated Use {@link TRANSFORMERS_MODEL} (issue #252). Resolves to the same runtime; kept for historical consumers. */
export const FASTEMBED_MODEL = TRANSFORMERS_MODEL;
/** @deprecated Use {@link TRANSFORMERS_CACHE_DIR} (issue #252). Resolves to the same directory. */
export const FASTEMBED_CACHE_DIR = TRANSFORMERS_CACHE_DIR;