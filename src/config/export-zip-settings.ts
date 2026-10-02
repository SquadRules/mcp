// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Skill ZIP (`skill_zip`) zlib settings. Read on each call so env overrides apply without restart.
 */

import { resolveAliasedRaw, logDeprecations } from './env-alias.js';

/** zlib default: good size vs CPU balance for text-heavy skill bundles (same family as many zip tools’ default). */
export const DEFAULT_EXPORT_ZIP_COMPRESSION_LEVEL = 6;

/** Stable default filename for skill ZIP HTTP downloads. */
export const DEFAULT_EXPORT_SKILL_ZIP_FILENAME = 'kairos-skills-export.zip';

/**
 * Zlib compression level for **`skill_zip`** archives: **0** = store only (fastest, larger files),
 * **9** = maximum compression (slowest). Default **{@link DEFAULT_EXPORT_ZIP_COMPRESSION_LEVEL}**.
 *
 * Env: **`KAIROS_EXPORT_ZIP_COMPRESSION_LEVEL`** (alias
 * **`SQUADRULES_EXPORT_ZIP_COMPRESSION_LEVEL`**) — integer **0–9**; invalid/missing → default.
 */
export function getExportZipCompressionLevel(): number {
  const raw = resolveAliasedRaw(
    'SQUADRULES_EXPORT_ZIP_COMPRESSION_LEVEL',
    'KAIROS_EXPORT_ZIP_COMPRESSION_LEVEL'
  );
  logDeprecations();
  if (raw === undefined || String(raw).trim() === '') {
    return DEFAULT_EXPORT_ZIP_COMPRESSION_LEVEL;
  }
  const parsed = parseInt(String(raw).trim(), 10);
  if (isNaN(parsed)) {
    return DEFAULT_EXPORT_ZIP_COMPRESSION_LEVEL;
  }
  return Math.min(9, Math.max(0, parsed));
}
