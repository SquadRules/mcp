// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import crypto from 'crypto';
import {
  KAIROS_EXPORT_DOWNLOAD_SECRET,
  KAIROS_EXPORT_DOWNLOAD_TTL_SEC,
  resolvePublicExportBaseUrl
} from '../config/export-download-settings.js';
import { DEFAULT_EXPORT_SKILL_ZIP_FILENAME } from '../config/export-zip-settings.js';
import {
  exportDownloadCapabilityStore,
  type ExportDownloadCapabilityRecord
} from './export-download-capability-store.js';
import { getSpaceContextFromStorage } from '../utils/tenant-context.js';

interface ExportDownloadTokenPayload {
  id: string;
  exp: number;
}

export interface MintExportDownloadCapabilityInput {
  adapterUris: string[];
  primaryUri: string;
  itemCount: number;
  adapterName: string | null;
  adapterVersion: string | null;
  skillBundleManifest: string;
  baseUrl?: string;
}

export interface MintedExportDownloadCapability {
  url: string;
  expires_at: string;
  filename: string;
  content_type: string;
}

function toBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function fromBase64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function sign(payloadB64: string): string {
  return crypto
    .createHmac('sha256', KAIROS_EXPORT_DOWNLOAD_SECRET)
    .update(payloadB64)
    .digest('base64url');
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function buildExportDownloadUrl(opaque: string, baseUrl = ''): string {
  baseUrl = baseUrl || resolvePublicExportBaseUrl();
  return `${baseUrl.replace(/\/$/, '')}/export/skill-zip/${encodeURIComponent(opaque)}`;
}

export async function mintExportDownloadCapability(
  input: MintExportDownloadCapabilityInput
): Promise<MintedExportDownloadCapability> {
  const id = crypto.randomUUID();
  const exp = Math.floor(Date.now() / 1000) + KAIROS_EXPORT_DOWNLOAD_TTL_SEC;
  const expiresAt = new Date(exp * 1000).toISOString();
  const payload: ExportDownloadTokenPayload = { id, exp };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const opaque = `${payloadB64}.${sign(payloadB64)}`;
  const record: ExportDownloadCapabilityRecord = {
    id,
    adapter_uris: input.adapterUris,
    primary_uri: input.primaryUri,
    item_count: input.itemCount,
    adapter_name: input.adapterName,
    adapter_version: input.adapterVersion,
    skill_bundle_manifest: input.skillBundleManifest,
    expires_at: expiresAt,
    space_context: getSpaceContextFromStorage()
  };
  await exportDownloadCapabilityStore.put(record, KAIROS_EXPORT_DOWNLOAD_TTL_SEC);
  return {
    url: buildExportDownloadUrl(opaque, input.baseUrl),
    expires_at: expiresAt,
    filename: DEFAULT_EXPORT_SKILL_ZIP_FILENAME,
    content_type: 'application/zip'
  };
}

export async function verifyExportDownloadCapability(
  opaque: string
): Promise<ExportDownloadCapabilityRecord | null> {
  const [payloadB64, sig, extra] = opaque.split('.');
  if (!payloadB64 || !sig || extra !== undefined) return null;
  if (!timingSafeEqualString(sign(payloadB64), sig)) return null;
  let payload: ExportDownloadTokenPayload;
  try {
    payload = fromBase64UrlJson<ExportDownloadTokenPayload>(payloadB64);
  } catch {
    return null;
  }
  if (!payload.id || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  const record = await exportDownloadCapabilityStore.get(payload.id);
  if (!record) return null;
  if (record.id !== payload.id) return null;
  if (Date.parse(record.expires_at) < Date.now()) return null;
  return record;
}
