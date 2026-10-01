import { randomBytes } from 'crypto';
import { resolveAliasedRaw, logDeprecations } from './env-alias.js';

const PROCESS_LOCAL_EXPORT_DOWNLOAD_SECRET = randomBytes(32).toString('hex');

function envString(key: string, defaultValue: string): string {
  const value = process.env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : defaultValue;
}

function envInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || String(value).trim() === '') return defaultValue;
  const parsed = parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * Alias-aware string read. Keeps the exact `envString` parsing semantics
 * (trim; whitespace-only → default) while adding `SQUADRULES_*` precedence over
 * the older `KAIROS_*` name. See `./env-alias.js`.
 */
function envStringAliased(newKey: string, oldKey: string, defaultValue: string): string {
  const value = resolveAliasedRaw(newKey, oldKey);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : defaultValue;
}

/** Alias-aware int read; keeps the exact `envInt` parsing semantics. */
function envIntAliased(newKey: string, oldKey: string, defaultValue: number): number {
  const value = resolveAliasedRaw(newKey, oldKey);
  if (value === undefined || String(value).trim() === '') return defaultValue;
  const parsed = parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export const KAIROS_EXPORT_DOWNLOAD_SECRET = envStringAliased(
  'SQUADRULES_EXPORT_DOWNLOAD_SECRET',
  'KAIROS_EXPORT_DOWNLOAD_SECRET',
  envString('SESSION_SECRET', PROCESS_LOCAL_EXPORT_DOWNLOAD_SECRET)
);

export const KAIROS_EXPORT_DOWNLOAD_TTL_SEC = envIntAliased(
  'SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC',
  'KAIROS_EXPORT_DOWNLOAD_TTL_SEC',
  600
);

export function resolvePublicExportBaseUrl(): string {
  const explicit = envStringAliased('SQUADRULES_PUBLIC_BASE_URL', 'KAIROS_PUBLIC_BASE_URL', '');
  logDeprecations();
  if (explicit) return explicit.replace(/\/$/, '');
  const authCallback = envString('AUTH_CALLBACK_BASE_URL', '');
  if (authCallback) return authCallback.replace(/\/$/, '');
  return `http://localhost:${envInt('PORT', 3000)}`;
}

logDeprecations();
