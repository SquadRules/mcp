import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Tests for config-driven cache backend selection.
 *
 * Bug: When Redis IS configured, the OIDC state store and MemoryQdrantStoreMethods
 * could still use in-memory storage because they had independent REDIS_URL checks
 * or per-process Map caches that bypassed the shared keyValueStore.
 *
 * Fix: A single `isRedisConfigured` predicate from config drives ALL backend
 * selection. No replica-count logic, no redundant REDIS_URL checks.
 */

// Jest runs this project as ESM (ts-jest default-esm preset), so there is no __dirname; the
// repository root is derived from the module URL instead.
const _repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relativePath: string): string {
  return readFileSync(resolve(_repoRoot, relativePath), 'utf-8');
}

describe('Config-driven cache backend selection', () => {
  describe('isRedisConfigured predicate', () => {
    it('is exported from config as a boolean', async () => {
      const config = await import('../../src/config.js');
      expect(typeof config.isRedisConfigured).toBe('boolean');
    });

    it('matches whether REDIS_URL is non-empty', async () => {
      const config = await import('../../src/config.js');
      const expected = config.REDIS_URL.length > 0;
      expect(config.isRedisConfigured).toBe(expected);
    });
  });

  describe('OIDC state store uses keyValueStore (no independent backend decision)', () => {
    it('does not import REDIS_URL directly for backend selection', () => {
      const src = readSrc('src/services/oidc-state-store.ts');
      // After fix: should import isRedisConfigured, not REDIS_URL
      expect(src).not.toMatch(/import\s*\{[^}]*REDIS_URL[^}]*\}\s*from\s*['"]\.\.\/config/);
    });

    it('does not contain a separate MemoryOidcStateStore class', () => {
      const src = readSrc('src/services/oidc-state-store.ts');
      expect(src).not.toMatch(/class\s+MemoryOidcStateStore/);
    });

    it('does not contain a createOidcStateStore factory with independent REDIS_URL check', () => {
      const src = readSrc('src/services/oidc-state-store.ts');
      expect(src).not.toMatch(/function\s+createOidcStateStore/);
    });

    it('does not use "single-replica" or "replica" language in log messages', () => {
      const src = readSrc('src/services/oidc-state-store.ts');
      expect(src.toLowerCase()).not.toContain('single-replica');
      expect(src).not.toMatch(/replicas?\b/);
    });

    it('backend label is derived from isRedisConfigured', () => {
      const src = readSrc('src/services/oidc-state-store.ts');
      expect(src).toContain('isRedisConfigured');
    });
  });

  describe('MemoryQdrantStoreMethods does not bypass shared storage', () => {
    it('does not have a per-process Map cache field', () => {
      const src = readSrc('src/services/memory/store-methods.ts');
      // After fix: no "private cache = new Map" pattern
      expect(src).not.toMatch(/private\s+cache\s*=\s*new\s+Map/);
    });

    it('does not have a cacheLoaded flag', () => {
      const src = readSrc('src/services/memory/store-methods.ts');
      expect(src).not.toMatch(/private\s+cacheLoaded/);
    });

    it('does not expose invalidateLocalCache method', () => {
      const src = readSrc('src/services/memory/store-methods.ts');
      expect(src).not.toMatch(/invalidateLocalCache\s*\(/);
    });

    it('getMemory routes through redisCacheService', () => {
      const src = readSrc('src/services/memory/store-methods.ts');
      // After fix: getMemory should call redisCacheService.getMemoryResource
      expect(src).toMatch(/redisCacheService\.getMemoryResource/);
    });

    it('does not have deprecated ensureCache method', () => {
      const src = readSrc('src/services/memory/store-methods.ts');
      expect(src).not.toMatch(/ensureCache/);
    });
  });

  describe('key-value-store-factory uses isRedisConfigured', () => {
    it('imports isRedisConfigured instead of REDIS_URL', () => {
      const src = readSrc('src/services/key-value-store-factory.ts');
      expect(src).toContain('isRedisConfigured');
      expect(src).not.toMatch(/import\s*\{[^}]*REDIS_URL[^}]*\}\s*from/);
    });
  });

  describe('search.ts uses isRedisConfigured for cache_backend label', () => {
    it('does not reference REDIS_URL directly for backend selection', () => {
      const src = readSrc('src/tools/search.ts');
      expect(src).not.toMatch(/REDIS_URL\s*\?/);
    });
  });

  describe('invalidateLocalCache callers migrated to redisCacheService', () => {
    it('store-adapter-header-handler no longer calls invalidateLocalCache', () => {
      const src = readSrc('src/services/memory/store-adapter-header-handler.ts');
      expect(src).not.toContain('invalidateLocalCache');
    });

    it('store-adapter-default-handler no longer calls invalidateLocalCache', () => {
      const src = readSrc('src/services/memory/store-adapter-default-handler.ts');
      expect(src).not.toContain('invalidateLocalCache');
    });

    it('mem-resources-boot no longer calls invalidateLocalCache', () => {
      const src = readSrc('src/resources/mem-resources-boot.ts');
      expect(src).not.toContain('invalidateLocalCache');
    });

    it('tune-cache-invalidation no longer calls invalidateLocalCache', () => {
      const src = readSrc('src/tools/tune-cache-invalidation.ts');
      expect(src).not.toContain('invalidateLocalCache');
    });
  });
});
