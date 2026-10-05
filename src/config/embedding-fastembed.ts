/**
 * Local fastembed embedding defaults (issue #11) — kept out of `config.ts` to
 * satisfy the max-lines budget, following the `src/config/*` convention.
 *
 * Re-exported from `config.ts` so consumers keep importing `FASTEMBED_MODEL` /
 * `FASTEMBED_CACHE_DIR` from the central config module.
 */
import { getSquadrulesModelsDir } from '../utils/squadrules-user-dirs.js';

function getEnvString(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/** fastembed `EmbeddingModel` enum value (NOT a HuggingFace repo id; default is 768 dims). */
export const FASTEMBED_MODEL = getEnvString('FASTEMBED_MODEL', 'fast-bge-base-en-v1.5');
/**
 * Directory fastembed downloads/loads model weights from (its `cacheDir`). Defaults to the
 * shared per-user models dir (sibling of config/keyring/lancedb); the first-run download is
 * delegated to fastembed's own downloader.
 */
export const FASTEMBED_CACHE_DIR = getEnvString('FASTEMBED_CACHE_DIR', '') || getSquadrulesModelsDir();
