/**
 * Env-driven limits for adapter Markdown / artifact size (train, tune, update).
 * Kept out of `config.ts` to satisfy max-lines.
 *
 * Values are read from the `SQUADRULES_ADAPTER_MARKDOWN_*` environment variables
 * on each call so tests / env overrides apply without a restart.
 */

function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? defaultValue : parsed;
}

export interface AdapterMarkdownSizeLimits {
  maxLines: number;
  maxLineBytes: number;
  safetyFactor: number;
  /** `ceil(max_lines × max_line_bytes × safety_factor)` — total UTF-8 document ceiling. */
  maxTotalBytes: number;
}

/** Read on each call so tests and env overrides apply without restart. */
export function getAdapterMarkdownSizeLimits(): AdapterMarkdownSizeLimits {
  const maxLines = getEnvInt('SQUADRULES_ADAPTER_MARKDOWN_MAX_LINES', 350);
  const maxLineBytes = getEnvInt('SQUADRULES_ADAPTER_MARKDOWN_MAX_LINE_BYTES', 8192);
  const raw = getEnvFloat('SQUADRULES_ADAPTER_MARKDOWN_SIZE_SAFETY_FACTOR', 1.15);
  const safetyFactor = raw >= 1 && Number.isFinite(raw) ? raw : 1.15;
  return {
    maxLines,
    maxLineBytes,
    safetyFactor,
    maxTotalBytes: Math.ceil(maxLines * maxLineBytes * safetyFactor)
  };
}
