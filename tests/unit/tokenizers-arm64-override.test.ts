/**
 * Regression guard for issue #173 — @anush008/tokenizers arm64 override.
 *
 * fastembed pins `@anush008/tokenizers: ^0.0.0`, which resolves to exactly
 * 0.0.0 and ships optional native binaries only for win32-x64, linux-x64-gnu
 * and darwin-universal — there is no linux-arm64 build. That breaks arm64
 * Linux environments (notably this repo's devcontainer on an Apple Silicon
 * host, and any arm64 CI), where ONNX inference cannot load the tokenizer.
 * Version 0.6.0 ships linux-arm64-gnu (and -musl) alongside the others, so the
 * root `overrides` entry forces the working version.
 *
 * The test asserts BOTH the declared override in package.json AND the resolved
 * outcome in package-lock.json, so a stale lockfile (override present but not
 * regenerated) fails the gate instead of silently shipping 0.0.0.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PackageJson {
  overrides?: Record<string, unknown>;
}

interface LockPackage {
  version?: string;
  optional?: boolean;
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

const TOKENIZERS = '@anush008/tokenizers';
const TOKENIZERS_ARM64 = '@anush008/tokenizers-linux-arm64-gnu';

describe('issue #173 — @anush008/tokenizers arm64 override', () => {
  it('declares the ^0.6.0 override in package.json', () => {
    const pkg = readJson<PackageJson>('package.json');
    expect(pkg.overrides?.[TOKENIZERS]).toBe('^0.6.0');
  });

  it('resolves @anush008/tokenizers to >=0.6.0 in the lockfile (not 0.0.0)', () => {
    const lock = readJson<LockFile>('package-lock.json');
    const entry = lock.packages?.[`node_modules/${TOKENIZERS}`];
    expect(entry?.version).toBeDefined();
    expect(compareCore(entry?.version ?? '0.0.0', '0.6.0')).toBeGreaterThanOrEqual(0);
  });

  it('includes the linux-arm64 native tokenizer binary in the lockfile', () => {
    const lock = readJson<LockFile>('package-lock.json');
    expect(lock.packages?.[`node_modules/${TOKENIZERS_ARM64}`]).toBeDefined();
  });
});
