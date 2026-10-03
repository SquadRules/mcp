import { randomBytes } from 'crypto';

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

export const SQUADRULES_EXPORT_DOWNLOAD_SECRET = envString(
  'SQUADRULES_EXPORT_DOWNLOAD_SECRET',
  envString('SESSION_SECRET', PROCESS_LOCAL_EXPORT_DOWNLOAD_SECRET)
);

export const SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC = envInt('SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC', 600);

export function resolvePublicExportBaseUrl(): string {
  const explicit = envString('SQUADRULES_PUBLIC_BASE_URL', '');
  if (explicit) return explicit.replace(/\/$/, '');
  const authCallback = envString('AUTH_CALLBACK_BASE_URL', '');
  if (authCallback) return authCallback.replace(/\/$/, '');
  return `http://localhost:${envInt('PORT', 3000)}`;
}
