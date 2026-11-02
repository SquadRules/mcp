/**
 * STDIO local artifact cache (ADR 0040).
 *
 * The cache gives the stdio transport the same transport-neutral URL contract the
 * HTTP capability URL provides: it writes the verified bytes it already holds to a
 * private per-process namespace under `os.tmpdir()` and hands back a `file://` URL.
 * These tests drive `ArtifactLocalCache` directly (no server) with an injected
 * clock and quotas, covering the fail-closed guarantees the materialize command
 * depends on: digest verification before any write, whole-batch failure with no
 * partial publish, no eviction of a live lease, symlink refusal, and orphan
 * scavenging that never touches a live process's namespace.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ArtifactCacheDigestError,
  ArtifactCacheError,
  ArtifactCacheQuotaError,
  ArtifactLocalCache,
  getArtifactLocalCache,
  type CacheArtifactInput
} from '../../src/tools/artifact-local-cache.js';
import { LEASE_SUFFIX, NAMESPACE_PREFIX } from '../../src/tools/artifact-local-cache-support.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const MB = 1024 * 1024;

function shaOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function makeEntry(
  uuid: string,
  text: string,
  relativePath: string | null = 'artifacts/gate.py',
  contentType = 'text/x-python'
): CacheArtifactInput {
  return { artifactUuid: uuid, sha256: shaOf(text), text, relativePath, contentType };
}

/** Every non-lease file under `dir` (i.e. published artifact data files). */
async function dataFilesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (!entry.name.endsWith(LEASE_SUFFIX)) found.push(full);
    }
  };
  if (fs.existsSync(dir)) await walk(dir);
  return found;
}

let rootDir: string;
let currentMs: number;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squadrules-cache-test-'));
  currentMs = 1_700_000_000_000;
});

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true });
});

function makeCache(ttlSec = 100, maxEntries = 256, maxBytes = 64 * MB): ArtifactLocalCache {
  return new ArtifactLocalCache({ rootDir, now: () => currentMs, ttlSec, maxEntries, maxBytes });
}

describe('ArtifactLocalCache.publishBatch', () => {
  it('publishes verified bytes to a private 0700 namespace and returns a file:// URL', async () => {
    const text = 'print("hello")\n';
    const published = await makeCache().publishBatch([makeEntry(UUID_A, text)]);
    const cached = published.get(UUID_A);
    expect(cached).toBeDefined();

    const filePath = fileURLToPath(cached!.url);
    expect(cached!.url.startsWith('file://')).toBe(true);
    expect(cached!.path).toBe(filePath);
    expect(cached!.bytes).toBe(Buffer.byteLength(text, 'utf8'));
    expect(fs.readFileSync(filePath, 'utf8')).toBe(text);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);

    const namespace = path.dirname(filePath);
    expect(path.dirname(namespace)).toBe(rootDir);
    expect(path.basename(namespace).startsWith(NAMESPACE_PREFIX)).toBe(true);
    expect(fs.statSync(namespace).mode & 0o777).toBe(0o700);
  });

  it('publishes a whole batch, one distinct file per artifact', async () => {
    const published = await makeCache().publishBatch([makeEntry(UUID_A, 'a\n'), makeEntry(UUID_B, 'b\n')]);
    expect(published.size).toBe(2);
    const fileA = fileURLToPath(published.get(UUID_A)!.url);
    const fileB = fileURLToPath(published.get(UUID_B)!.url);
    expect(fileA).not.toBe(fileB);
    expect(fs.readFileSync(fileA, 'utf8')).toBe('a\n');
    expect(fs.readFileSync(fileB, 'utf8')).toBe('b\n');
  });

  it('fails the whole batch on a digest mismatch and writes nothing', async () => {
    const bad: CacheArtifactInput = { ...makeEntry(UUID_A, 'real bytes'), sha256: 'b'.repeat(64) };
    await expect(makeCache().publishBatch([bad])).rejects.toBeInstanceOf(ArtifactCacheDigestError);
    expect(await dataFilesUnder(rootDir)).toEqual([]);
  });

  it('refuses an artifact identity that is not a UUID', async () => {
    await expect(makeCache().publishBatch([makeEntry('not-a-uuid', 'x')])).rejects.toThrow(/UUID/);
  });

  it('refuses an artifact without a valid sha256', async () => {
    const bad: CacheArtifactInput = { ...makeEntry(UUID_A, 'x'), sha256: 'nope' };
    await expect(makeCache().publishBatch([bad])).rejects.toThrow(/SHA-256/);
  });

  it('fails a batch over the entry quota without evicting or partially writing', async () => {
    const cache = makeCache(100, 1, 64 * MB);
    await expect(
      cache.publishBatch([makeEntry(UUID_A, 'a'), makeEntry(UUID_B, 'b')])
    ).rejects.toBeInstanceOf(ArtifactCacheQuotaError);
    expect(await dataFilesUnder(rootDir)).toEqual([]);
  });

  it('fails a batch over the byte quota', async () => {
    const cache = makeCache(100, 256, 4);
    await expect(
      cache.publishBatch([makeEntry(UUID_A, 'way more than four bytes')])
    ).rejects.toBeInstanceOf(ArtifactCacheQuotaError);
  });

  it('reuses the file when unchanged bytes are re-published', async () => {
    const cache = makeCache();
    const first = await cache.publishBatch([makeEntry(UUID_A, 'x')]);
    const firstPath = first.get(UUID_A)!.path;
    currentMs += 1_000;
    const second = await cache.publishBatch([makeEntry(UUID_A, 'x')]);
    expect(second.get(UUID_A)!.path).toBe(firstPath);
    expect(fs.readFileSync(firstPath, 'utf8')).toBe('x');
  });

  it('refuses to reuse or overwrite a cache entry that is a symlink', async () => {
    const cache = makeCache();
    const first = await cache.publishBatch([makeEntry(UUID_A, 'x')]);
    const filePath = first.get(UUID_A)!.path;
    await fsp.rm(filePath);
    await fsp.symlink(path.join(rootDir, 'elsewhere'), filePath);
    await expect(cache.publishBatch([makeEntry(UUID_A, 'x')])).rejects.toBeInstanceOf(ArtifactCacheError);
  });
});

describe('ArtifactLocalCache leases and pruning', () => {
  it('prunes an entry once its lease expires', async () => {
    const cache = makeCache(100);
    const published = await cache.publishBatch([makeEntry(UUID_A, 'x')]);
    const filePath = fileURLToPath(published.get(UUID_A)!.url);
    expect(fs.existsSync(filePath)).toBe(true);

    currentMs += 101_000;
    expect(await cache.pruneExpired()).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(`${filePath}${LEASE_SUFFIX}`)).toBe(false);
  });

  it('keeps an entry whose lease is still live', async () => {
    const cache = makeCache(100);
    const published = await cache.publishBatch([makeEntry(UUID_A, 'x')]);
    const filePath = fileURLToPath(published.get(UUID_A)!.url);
    currentMs += 50_000;
    expect(await cache.pruneExpired()).toBe(0);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('re-publishes the same artifact after its lease expired', async () => {
    const cache = makeCache(100);
    await cache.publishBatch([makeEntry(UUID_A, 'x')]);
    currentMs += 101_000;
    await cache.pruneExpired();
    const again = await cache.publishBatch([makeEntry(UUID_A, 'x')]);
    expect(again.get(UUID_A)).toBeDefined();
    expect(fs.readFileSync(fileURLToPath(again.get(UUID_A)!.url), 'utf8')).toBe('x');
  });
});

describe('ArtifactLocalCache.scavengeOrphans', () => {
  it('never scavenges its own live namespace', async () => {
    const cache = makeCache();
    await cache.publishBatch([makeEntry(UUID_A, 'x')]);
    expect(await cache.scavengeOrphans()).toBe(0);
    expect(await dataFilesUnder(rootDir)).not.toEqual([]);
  });

  it('scavenges a dead orphan namespace past its grace period', async () => {
    const cache = new ArtifactLocalCache({ rootDir, now: () => currentMs, ttlSec: 100, orphanGraceSec: 0 });
    // A PID that has already exited and been reaped is definitively dead (ESRCH).
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid ?? 2147483000;
    const orphan = path.join(rootDir, `${NAMESPACE_PREFIX}${deadPid}-deadbeef-aaaaaa`);
    await fsp.mkdir(orphan, { recursive: true });
    await fsp.writeFile(path.join(orphan, 'stale.py'), 'x');
    const past = new Date(currentMs - 10_000_000);
    await fsp.utimes(orphan, past, past);

    expect(await cache.scavengeOrphans()).toBe(1);
    expect(fs.existsSync(orphan)).toBe(false);
  });

  it('keeps a dead orphan namespace still inside its grace period', async () => {
    const cache = new ArtifactLocalCache({ rootDir, now: () => currentMs, ttlSec: 100, orphanGraceSec: 3600 });
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid ?? 2147483000;
    const orphan = path.join(rootDir, `${NAMESPACE_PREFIX}${deadPid}-deadbeef-bbbbbb`);
    await fsp.mkdir(orphan, { recursive: true });
    await fsp.writeFile(path.join(orphan, 'stale.py'), 'x');
    const recent = new Date(currentMs - 1_000);
    await fsp.utimes(orphan, recent, recent);

    expect(await cache.scavengeOrphans()).toBe(0);
    expect(fs.existsSync(orphan)).toBe(true);
  });
});

describe('getArtifactLocalCache', () => {
  it('exposes one process-wide instance', () => {
    expect(getArtifactLocalCache()).toBe(getArtifactLocalCache());
  });
});
