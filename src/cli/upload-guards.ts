// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { closeSync, fstatSync, openSync, readFileSync } from 'fs';
import { validateProtocolStructure } from '../services/memory/validate-protocol-structure.js';
import { normalizeMarkdownBlob } from '../utils/memory-store-utils.js';

export type SafeMarkdownUpload = string & { readonly __safeMarkdownUpload: unique symbol };

const DEFAULT_MAX_MARKDOWN_UPLOAD_BYTES = 512 * 1024;
const SENSITIVE_CONTENT_OVERRIDE_ENV = 'KAIROS_ALLOW_SENSITIVE_UPLOADS';
const TRUSTED_HOSTS_ENV = 'KAIROS_TRUSTED_API_HOSTS';

function markdownUploadByteLimit(): number {
  const raw = process.env['KAIROS_CLI_MAX_MARKDOWN_BYTES'];
  if (!raw) return DEFAULT_MAX_MARKDOWN_UPLOAD_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_MARKDOWN_UPLOAD_BYTES;
}

function isLikelyBinaryText(text: string): boolean {
  return text.includes('\u0000');
}

function detectSensitiveContent(text: string): string | null {
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) return 'private key material';
  if (/\bBearer\s+[A-Za-z0-9._-]{20,}\b/i.test(text)) return 'bearer token material';
  if (/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/.test(text)) return 'bot or service token material';
  if (/\bgh[opsu]_[A-Za-z0-9]{20,}\b/.test(text)) return 'GitHub token material';
  return null;
}

function sensitiveContentAllowed(allowSensitiveUpload = false): boolean {
  return allowSensitiveUpload || process.env[SENSITIVE_CONTENT_OVERRIDE_ENV] === 'true';
}

function prepareMarkdownUpload(
  markdown: string,
  mode: 'train' | 'tune',
  allowSensitiveUpload = false
): SafeMarkdownUpload {
  const normalized = normalizeMarkdownBlob(markdown).replace(/\r\n/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed) {
    throw new Error('Markdown upload is empty');
  }
  if (isLikelyBinaryText(normalized)) {
    throw new Error('Markdown upload contains binary content');
  }
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (bytes > markdownUploadByteLimit()) {
    throw new Error(`Markdown upload exceeds ${markdownUploadByteLimit()} bytes`);
  }
  const sensitiveFinding = detectSensitiveContent(normalized);
  if (sensitiveFinding && !sensitiveContentAllowed(allowSensitiveUpload)) {
    throw new Error(
      `Refusing to upload markdown containing ${sensitiveFinding}. Set ${SENSITIVE_CONTENT_OVERRIDE_ENV}=true or use the command override to continue.`
    );
  }
  if (mode === 'train') {
    const validation = validateProtocolStructure(normalized);
    if (!validation.valid) throw new Error(validation.message);
  }
  return normalized as SafeMarkdownUpload;
}

export function readMarkdownUploadFromFile(
  absPath: string,
  mode: 'train' | 'tune',
  allowSensitiveUpload = false
): SafeMarkdownUpload {
  const fd = openSync(absPath, 'r');
  try {
    if (!fstatSync(fd).isFile()) {
      throw Object.assign(new Error('Path is not a regular file'), { code: 'ENOTREG' });
    }
    return prepareMarkdownUpload(readFileSync(fd, 'utf-8') as string, mode, allowSensitiveUpload);
  } finally {
    closeSync(fd);
  }
}

export function prepareMarkdownUploadForMode(
  markdown: string,
  mode: 'train' | 'tune',
  allowSensitiveUpload = false
): SafeMarkdownUpload {
  return prepareMarkdownUpload(markdown, mode, allowSensitiveUpload);
}

export function normalizeAndValidateApiBaseUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid API base URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported API base URL protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('API base URL must not include credentials');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('API base URL must not include query or fragment');
  }
  const trustedHosts = (process.env[TRUSTED_HOSTS_ENV] || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (trustedHosts.length > 0 && !trustedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`API base URL host is not in ${TRUSTED_HOSTS_ENV}`);
  }
  return parsed.toString().replace(/\/$/, '');
}
