/**
 * Package hygiene guard for issue #252 — fastembed → @huggingface/transformers.
 *
 * The archived `fastembed` runtime (and its `@anush008/tokenizers` / `global-agent`
 * override chain, ADR 0030 / issue #173) is replaced by `@huggingface/transformers`
 * pinned EXACTLY for reproducibility (the model revision is pinned separately in
 * src/config/embedding-transformers.ts). This test asserts BOTH the declared
 * package.json state AND the resolved package-lock.json outcome, so a stale
 * lockfile fails the gate instead of silently shipping the old native chain.
 *
 * Reads the JSON files directly (like the retired tokenizers-arm64-override test
 * did) — no install is needed to run it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PackageJson {
  dependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

interface LockPackage {
  version?: string;
}

interface LockFile {
  packages?: Record<string, LockPackage>;
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8')) as T;
}

/** Compare dotted numeric semver cores; returns <0, 0, >0 for a<b, a==b, a>b. */
function compareCore(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Find a package entry at any hoisting depth (npm may nest e.g. onnxruntime-node
 * under node_modules/@huggingface/transformers/node_modules/ when versions conflict).
 */
function findPackage(lock: LockFile, name: string): LockPackage | undefined {
  const suffix = `node_modules/${name}`;
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === suffix || key.endsWith(`/${suffix}`)) return entry;
  }
  return undefined;
}

describe('issue #252 — embedding package hygiene', () => {
  it('pins @huggingface/transformers to exactly 4.3.2 in package.json', () => {
    const pkg = readJson<PackageJson>('package.json');
    expect(pkg.dependencies?.['@huggingface/transformers']).toBe('4.3.2');
  });

  it('declares no fastembed dependency', () => {
    const pkg = readJson<PackageJson>('package.json');
    expect(pkg.dependencies?.['fastembed']).toBeUndefined();
  });

  it('drops the fastembed-chain overrides (@anush008/tokenizers, global-agent)', () => {
    const pkg = readJson<PackageJson>('package.json');
    expect(pkg.overrides?.['@anush008/tokenizers']).toBeUndefined();
    expect(pkg.overrides?.['global-agent']).toBeUndefined();
  });

  it('lockfile contains no fastembed or @anush008/tokenizers entries', () => {
    const lock = readJson<LockFile>('package-lock.json');
    const keys = Object.keys(lock.packages ?? {});
    expect(keys.filter((k) => k === 'node_modules/fastembed' || k.endsWith('/node_modules/fastembed'))).toEqual([]);
    expect(keys.filter((k) => k.includes('node_modules/@anush008/'))).toEqual([]);
  });

  it('lockfile contains no boolean@3.2.0 entry (legacy global-agent 3.x chain)', () => {
    const lock = readJson<LockFile>('package-lock.json');
    const entry = findPackage(lock, 'boolean');
    expect(entry === undefined || entry.version !== '3.2.0').toBe(true);
  });

  it('resolves onnxruntime-node >= 1.30.0 in the lockfile', () => {
    const lock = readJson<LockFile>('package-lock.json');
    const entry = findPackage(lock, 'onnxruntime-node');
    expect(entry?.version).toBeDefined();
    expect(compareCore(entry?.version ?? '0.0.0', '1.30.0')).toBeGreaterThanOrEqual(0);
  });

  it('resolves global-agent >= 4.1.3 in the lockfile when present', () => {
    const lock = readJson<LockFile>('package-lock.json');
    const entry = findPackage(lock, 'global-agent');
    if (entry !== undefined) {
      expect(entry.version).toBeDefined();
      expect(compareCore(entry.version ?? '0.0.0', '4.1.3')).toBeGreaterThanOrEqual(0);
    }
  });

  it('lockfile pins @huggingface/transformers to 4.3.2', () => {
    const lock = readJson<LockFile>('package-lock.json');
    expect(findPackage(lock, '@huggingface/transformers')?.version).toBe('4.3.2');
  });
});