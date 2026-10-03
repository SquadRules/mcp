import crypto from 'crypto';
import {
  SQUADRULES_EXPORT_DOWNLOAD_SECRET,
  SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC,
  resolvePublicExportBaseUrl
} from '../config/export-download-settings.js';
import {
  exportArtifactDownloadCapabilityStore,
  type ExportArtifactDownloadCapabilityRecord
} from './export-artifact-download-capability-store.js';
import { getSpaceContextFromStorage } from '../utils/tenant-context.js';

interface ExportArtifactDownloadTokenPayload {
  id: string;
  exp: number;
}

export interface MintExportArtifactDownloadCapabilityInput {
  artifactUuid: string;
  filename: string;
  contentType: string;
  sha256: string;
  relativePath?: string | null;
  baseUrl?: string;
}

export interface MintedExportArtifactDownloadCapability {
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
    .createHmac('sha256', SQUADRULES_EXPORT_DOWNLOAD_SECRET)
    .update(payloadB64)
    .digest('base64url');
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function buildExportArtifactDownloadUrl(opaque: string, baseUrl = ''): string {
  baseUrl = baseUrl || resolvePublicExportBaseUrl();
  return `${baseUrl.replace(/\/$/, '')}/export/artifact/${encodeURIComponent(opaque)}`;
}

export async function mintExportArtifactDownloadCapability(
  input: MintExportArtifactDownloadCapabilityInput
): Promise<MintedExportArtifactDownloadCapability> {
  const id = crypto.randomUUID();
  const exp = Math.floor(Date.now() / 1000) + SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC;
  const expiresAt = new Date(exp * 1000).toISOString();
  const payload: ExportArtifactDownloadTokenPayload = { id, exp };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const opaque = `${payloadB64}.${sign(payloadB64)}`;
  const record: ExportArtifactDownloadCapabilityRecord = {
    id,
    artifact_uuid: input.artifactUuid,
    filename: input.filename,
    content_type: input.contentType,
    sha256: input.sha256,
    relative_path: input.relativePath ?? null,
    expires_at: expiresAt,
    space_context: getSpaceContextFromStorage()
  };
  await exportArtifactDownloadCapabilityStore.put(record, SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC);
  return {
    url: buildExportArtifactDownloadUrl(opaque, input.baseUrl),
    expires_at: expiresAt,
    filename: input.filename,
    content_type: input.contentType
  };
}

export async function verifyExportArtifactDownloadCapability(
  opaque: string
): Promise<ExportArtifactDownloadCapabilityRecord | null> {
  const [payloadB64, sig, extra] = opaque.split('.');
  if (!payloadB64 || !sig || extra !== undefined) return null;
  if (!timingSafeEqualString(sign(payloadB64), sig)) return null;
  let payload: ExportArtifactDownloadTokenPayload;
  try {
    payload = fromBase64UrlJson<ExportArtifactDownloadTokenPayload>(payloadB64);
  } catch {
    return null;
  }
  if (!payload.id || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  const record = await exportArtifactDownloadCapabilityStore.get(payload.id);
  if (!record) return null;
  if (record.id !== payload.id) return null;
  if (Date.parse(record.expires_at) < Date.now()) return null;
  return record;
}

