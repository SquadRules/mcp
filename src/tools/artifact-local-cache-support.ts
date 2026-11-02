/**
 * Support for the STDIO local artifact cache (ADR 0040): identity and path
 * helpers, tunable quotas, lease records, and the fail-closed error types. Kept
 * separate from `artifact-local-cache.ts` so the cache class stays within the
 * file-size gate. Nothing here touches the filesystem.
 */
import os from 'node:os';
import path from 'node:path';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHA256_RE = /^[a-f0-9]{64}$/i;
export const NAMESPACE_PREFIX = 'sqns-';
export const LEASE_SUFFIX = '.lease';
export const DEFAULT_MAX_ENTRIES = 256;
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_ORPHAN_GRACE_SEC = 3600;
export const MAINTENANCE_INTERVAL_MS = 60_000;

export function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function ownerUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

export function defaultRootDir(): string {
  const uid = ownerUid();
  return path.join(os.tmpdir(), `squadrules-artifact-cache-${uid === undefined ? 'na' : String(uid)}`);
}

/** A shell-safe, path-safe file extension derived from the artifact path or type. */
export function extensionFor(relativePath: string | null, contentType: string): string {
  const fromPath = relativePath ? path.extname(relativePath).replace(/^\./, '') : '';
  const subtype = contentType.split('/')[1] ?? '';
  const candidate = fromPath || subtype.replace(/^x-/, '');
  const sanitized = candidate.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return sanitized.length > 0 ? sanitized : 'bin';
}

/** A PID is treated as live unless the OS reports it definitively gone (ESRCH). */
export function processMayBeAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export class ArtifactCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactCacheError';
  }
}

/** The stored bytes do not hash to the stored digest; the load must fail closed. */
export class ArtifactCacheDigestError extends ArtifactCacheError {}

/** The batch cannot be admitted without evicting a still-leased entry. */
export class ArtifactCacheQuotaError extends ArtifactCacheError {}

export interface CacheArtifactInput {
  artifactUuid: string;
  sha256: string;
  /** Authoritative UTF-8 bytes; `sha256` is the digest over exactly these. */
  text: string;
  relativePath: string | null;
  contentType: string;
}

export interface CachedArtifact {
  /** Absolute `file://` URL the materialize command curls. */
  url: string;
  /** Absolute path of the published file inside this process's namespace. */
  path: string;
  bytes: number;
}

export interface ArtifactLocalCacheOptions {
  rootDir?: string;
  ttlSec?: number;
  maxEntries?: number;
  maxBytes?: number;
  orphanGraceSec?: number;
  now?: () => number;
}

export interface PreparedArtifact {
  uuid: string;
  name: string;
  buf: Buffer;
  bytes: number;
}

export interface LeaseRecord {
  v: 1;
  name: string;
  bytes: number;
  createdSec: number;
  lastIssuedSec: number;
  expiresSec: number;
}
