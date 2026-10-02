// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Env-driven limits for adapter Markdown / artifact size (train, tune, update).
 * Kept out of `config.ts` to satisfy max-lines.
 *
 * Each `KAIROS_ADAPTER_MARKDOWN_*` variable has a `SQUADRULES_ADAPTER_MARKDOWN_*`
 * alias. Precedence and empty-string semantics live in `./env-alias.js` (the new
 * key wins when defined, even as `''`; otherwise the KAIROS_* key; otherwise the
 * default). Values are re-read on each call so tests / env overrides apply
 * without a restart.
 */

import {
  getEnvIntAliased,
  getEnvFloatAliased,
  logDeprecations
} from './env-alias.js';

export interface AdapterMarkdownSizeLimits {
  maxLines: number;
  maxLineBytes: number;
  safetyFactor: number;
  /** `ceil(max_lines × max_line_bytes × safety_factor)` — total UTF-8 document ceiling. */
  maxTotalBytes: number;
}

/** Read on each call so tests and env overrides apply without restart. */
export function getAdapterMarkdownSizeLimits(): AdapterMarkdownSizeLimits {
  const maxLines = getEnvIntAliased(
    'SQUADRULES_ADAPTER_MARKDOWN_MAX_LINES',
    'KAIROS_ADAPTER_MARKDOWN_MAX_LINES',
    350
  );
  const maxLineBytes = getEnvIntAliased(
    'SQUADRULES_ADAPTER_MARKDOWN_MAX_LINE_BYTES',
    'KAIROS_ADAPTER_MARKDOWN_MAX_LINE_BYTES',
    8192
  );
  const raw = getEnvFloatAliased(
    'SQUADRULES_ADAPTER_MARKDOWN_SIZE_SAFETY_FACTOR',
    'KAIROS_ADAPTER_MARKDOWN_SIZE_SAFETY_FACTOR',
    1.15
  );
  const safetyFactor = raw >= 1 && Number.isFinite(raw) ? raw : 1.15;
  logDeprecations();
  return {
    maxLines,
    maxLineBytes,
    safetyFactor,
    maxTotalBytes: Math.ceil(maxLines * maxLineBytes * safetyFactor)
  };
}
