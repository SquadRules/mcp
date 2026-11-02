/**
 * STDIO local artifact cache (ADR 0040).
 *
 * The stdio transport has no HTTP listener, so the running server writes the
 * verified artifact bytes it already holds (`AdapterArtifactMetadata.text`) to a
 * private per-process namespace under `os.tmpdir()` and returns a `file://` URL.
 * That gives linked-artifact materialization one transport-neutral URL contract
 * shared with the HTTP capability URL — no CLI, no second backend, and no
 * artifact bytes (raw or base64) through MCP context.
 *
 * Each server process owns exactly one `0700` namespace, publishes with digest
 * verification and atomic rename, leases each returned URL for
 * `SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC` after its last issuance, admits within
 * per-instance entry/byte quotas (failing the whole batch rather than evicting a
 * live lease), and scavenges only namespaces whose owner PID is dead. Helpers,
 * quotas, and error types live in `artifact-local-cache-support.ts`.
 */
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC } from '../config/export-download-settings.js';
import { sha256Hex } from './skill-export/sha256.js';
import {
  ArtifactCacheDigestError,
  ArtifactCacheError,
  ArtifactCacheQuotaError,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_ORPHAN_GRACE_SEC,
  LEASE_SUFFIX,
  MAINTENANCE_INTERVAL_MS,
  NAMESPACE_PREFIX,
  SHA256_RE,
  UUID_RE,
  defaultRootDir,
  envInt,
  extensionFor,
  ownerUid,
  processMayBeAlive,
  type ArtifactLocalCacheOptions,
  type CacheArtifactInput,
  type CachedArtifact,
  type LeaseRecord,
  type PreparedArtifact
} from './artifact-local-cache-support.js';

export { ArtifactCacheDigestError, ArtifactCacheError, ArtifactCacheQuotaError };
export type { ArtifactLocalCacheOptions, CacheArtifactInput, CachedArtifact };

export class ArtifactLocalCache {
  private readonly rootDir: string;
  private readonly ttlSec: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly orphanGraceSec: number;
  private readonly now: () => number;
  private namespace: string | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private maintenance: ReturnType<typeof setInterval> | null = null;

  constructor(options: ArtifactLocalCacheOptions = {}) {
    this.rootDir = options.rootDir ?? defaultRootDir();
    this.ttlSec = options.ttlSec ?? envInt('SQUADRULES_ARTIFACT_CACHE_TTL_SEC', SQUADRULES_EXPORT_DOWNLOAD_TTL_SEC);
    this.maxEntries = options.maxEntries ?? envInt('SQUADRULES_ARTIFACT_CACHE_MAX_ENTRIES', DEFAULT_MAX_ENTRIES);
    this.maxBytes = options.maxBytes ?? envInt('SQUADRULES_ARTIFACT_CACHE_MAX_BYTES', DEFAULT_MAX_BYTES);
    this.orphanGraceSec =
      options.orphanGraceSec ?? envInt('SQUADRULES_ARTIFACT_CACHE_ORPHAN_GRACE_SEC', DEFAULT_ORPHAN_GRACE_SEC);
    this.now = options.now ?? ((): number => Date.now());
  }

  /**
   * Verify and publish a whole activation batch, or fail it entirely. Digest
   * verification and quota preflight run before any write, so a bad artifact or
   * an over-quota batch never leaves a partially usable cache behind.
   */
  async publishBatch(entries: readonly CacheArtifactInput[]): Promise<Map<string, CachedArtifact>> {
    return this.withLock(async () => {
      const ns = await this.ensureNamespace();
      const nowSec = Math.floor(this.now() / 1000);
      const prepared = entries.map((entry) => this.prepare(entry));
      await this.pruneExpiredIn(ns, nowSec);
      this.preflightQuota(await this.listLeases(ns), prepared, nowSec);
      const out = new Map<string, CachedArtifact>();
      for (const item of prepared) {
        out.set(item.uuid, await this.publishOne(ns, item, nowSec));
      }
      return out;
    });
  }

  /** Remove entries whose lease has expired. Returns the number pruned. */
  async pruneExpired(): Promise<number> {
    return this.withLock(async () => {
      if (!this.namespace) return 0;
      return this.pruneExpiredIn(this.namespace, Math.floor(this.now() / 1000));
    });
  }

  /**
   * Scavenge namespaces whose owner PID is dead, whose newest lease has expired,
   * and whose grace period has passed. Never touches a live process's namespace,
   * including this one; ambiguous liveness is treated as live.
   */
  async scavengeOrphans(): Promise<number> {
    return this.withLock(async () => {
      await this.ensureRoot();
      const nowSec = Math.floor(this.now() / 1000);
      let removed = 0;
      for (const entry of await fsp.readdir(this.rootDir, { withFileTypes: true })) {
        if (!entry.name.startsWith(NAMESPACE_PREFIX) || !entry.isDirectory()) continue;
        const full = path.join(this.rootDir, entry.name);
        if (full === this.namespace) continue;
        const pid = Number.parseInt(entry.name.slice(NAMESPACE_PREFIX.length).split('-')[0] ?? '', 10);
        if (!Number.isFinite(pid) || pid === process.pid || processMayBeAlive(pid)) continue;
        const newest = await this.newestLeaseExpiry(full);
        const mtimeSec = Math.floor((await fsp.lstat(full)).mtimeMs / 1000);
        if (nowSec < Math.max(newest, mtimeSec) + this.orphanGraceSec) continue;
        await fsp.rm(full, { recursive: true, force: true });
        removed += 1;
      }
      return removed;
    });
  }

  startPeriodicMaintenance(intervalMs = MAINTENANCE_INTERVAL_MS): void {
    if (this.maintenance) return;
    const timer = setInterval(() => {
      void this.runMaintenance();
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.maintenance = timer;
  }

  stopPeriodicMaintenance(): void {
    if (this.maintenance) {
      clearInterval(this.maintenance);
      this.maintenance = null;
    }
  }

  private async runMaintenance(): Promise<void> {
    try {
      await this.pruneExpired();
      await this.scavengeOrphans();
    } catch {
      // Best-effort maintenance; a failure here must not crash the server.
    }
  }

  private prepare(entry: CacheArtifactInput): PreparedArtifact {
    if (!UUID_RE.test(entry.artifactUuid)) {
      throw new ArtifactCacheError('artifact identity is not a UUID; refusing to cache it');
    }
    if (!SHA256_RE.test(entry.sha256)) {
      throw new ArtifactCacheError(`artifact ${entry.artifactUuid} has no valid SHA-256; refusing to cache it`);
    }
    const sha256 = entry.sha256.toLowerCase();
    const buf = Buffer.from(entry.text, 'utf8');
    if (sha256Hex(buf) !== sha256) {
      throw new ArtifactCacheDigestError(
        `artifact ${entry.artifactUuid} bytes do not match their stored SHA-256; re-activate to refresh the source`
      );
    }
    const ext = extensionFor(entry.relativePath, entry.contentType);
    return { uuid: entry.artifactUuid, name: `${entry.artifactUuid}-${sha256}.${ext}`, buf, bytes: buf.length };
  }

  private preflightQuota(leases: readonly LeaseRecord[], prepared: readonly PreparedArtifact[], nowSec: number): void {
    const live = new Map<string, LeaseRecord>();
    for (const lease of leases) {
      if (lease.expiresSec > nowSec) live.set(lease.name, lease);
    }
    let entries = live.size;
    let bytes = 0;
    for (const lease of live.values()) bytes += lease.bytes;
    const counted = new Set<string>();
    for (const item of prepared) {
      if (live.has(item.name) || counted.has(item.name)) continue;
      counted.add(item.name);
      entries += 1;
      bytes += item.bytes;
    }
    if (entries > this.maxEntries || bytes > this.maxBytes) {
      throw new ArtifactCacheQuotaError(
        `linked-artifact batch does not fit the local cache quota (${entries} entries / ${bytes} bytes); ` +
          'no cached artifact is evicted while its lease is live — re-activate after cached entries expire'
      );
    }
  }

  private async publishOne(ns: string, item: PreparedArtifact, nowSec: number): Promise<CachedArtifact> {
    const finalPath = path.join(ns, item.name);
    const prior = await this.readLease(`${finalPath}${LEASE_SUFFIX}`);
    if (!(await this.matchesDigest(finalPath, sha256Hex(item.buf)))) {
      await this.writeFileAtomic(finalPath, item.buf, 0o600);
    }
    const lease: LeaseRecord = {
      v: 1,
      name: item.name,
      bytes: item.bytes,
      createdSec: prior?.createdSec ?? nowSec,
      lastIssuedSec: nowSec,
      expiresSec: nowSec + this.ttlSec
    };
    await this.writeFileAtomic(`${finalPath}${LEASE_SUFFIX}`, Buffer.from(JSON.stringify(lease), 'utf8'), 0o600);
    return { url: pathToFileURL(finalPath).href, path: finalPath, bytes: item.bytes };
  }

  /** True only when the file exists as a regular file whose bytes match the digest. */
  private async matchesDigest(finalPath: string, sha256: string): Promise<boolean> {
    let stat;
    try {
      stat = await fsp.lstat(finalPath);
    } catch {
      return false;
    }
    if (stat.isSymbolicLink()) {
      throw new ArtifactCacheError('a cache entry is a symlink; refusing to reuse or overwrite it');
    }
    if (!stat.isFile()) return false;
    return sha256Hex(await fsp.readFile(finalPath)) === sha256;
  }

  private async ensureNamespace(): Promise<string> {
    if (this.namespace) return this.namespace;
    await this.ensureRoot();
    const token = randomBytes(8).toString('hex');
    const ns = await fsp.mkdtemp(path.join(this.rootDir, `${NAMESPACE_PREFIX}${process.pid}-${token}-`));
    await fsp.chmod(ns, 0o700);
    this.namespace = ns;
    return ns;
  }

  private async ensureRoot(): Promise<void> {
    await fsp.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const stat = await fsp.lstat(this.rootDir);
    if (stat.isSymbolicLink()) throw new ArtifactCacheError('the artifact cache root is a symlink; refusing to use it');
    if (!stat.isDirectory()) throw new ArtifactCacheError('the artifact cache root is not a directory');
    const uid = ownerUid();
    if (uid !== undefined && stat.uid !== uid) {
      throw new ArtifactCacheError('the artifact cache root is owned by another user; refusing to use it');
    }
    if (stat.mode & 0o077) await fsp.chmod(this.rootDir, 0o700);
  }

  private async writeFileAtomic(target: string, data: Buffer, mode: number): Promise<void> {
    const tmp = `${target}.tmp-${randomBytes(6).toString('hex')}`;
    const handle = await fsp.open(tmp, 'w', mode);
    try {
      await handle.writeFile(data);
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(tmp, target);
  }

  private async readLease(leasePath: string): Promise<LeaseRecord | null> {
    try {
      const parsed = JSON.parse(await fsp.readFile(leasePath, 'utf8')) as LeaseRecord;
      return parsed && typeof parsed === 'object' && parsed.v === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  private async listLeases(ns: string): Promise<LeaseRecord[]> {
    const leases: LeaseRecord[] = [];
    let names: string[];
    try {
      names = await fsp.readdir(ns);
    } catch {
      return leases;
    }
    for (const name of names) {
      if (!name.endsWith(LEASE_SUFFIX)) continue;
      const lease = await this.readLease(path.join(ns, name));
      if (lease) leases.push(lease);
    }
    return leases;
  }

  private async pruneExpiredIn(ns: string, nowSec: number): Promise<number> {
    let removed = 0;
    for (const lease of await this.listLeases(ns)) {
      if (lease.expiresSec > nowSec) continue;
      const dataPath = path.join(ns, lease.name);
      await fsp.rm(dataPath, { force: true });
      await fsp.rm(`${dataPath}${LEASE_SUFFIX}`, { force: true });
      removed += 1;
    }
    return removed;
  }

  private async newestLeaseExpiry(ns: string): Promise<number> {
    let newest = 0;
    for (const lease of await this.listLeases(ns)) {
      if (lease.expiresSec > newest) newest = lease.expiresSec;
    }
    return newest;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

let singleton: ArtifactLocalCache | undefined;

/** The process-wide stdio cache; created on first use with periodic maintenance. */
export function getArtifactLocalCache(): ArtifactLocalCache {
  if (!singleton) {
    singleton = new ArtifactLocalCache();
    singleton.startPeriodicMaintenance();
  }
  return singleton;
}
