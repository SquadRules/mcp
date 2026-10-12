/**
 * A3 backend-resolution unit tests: the local sentinel vs an http(s) target, and the
 * `isLocalTarget` alias matcher. Pure — `resolveBackendTarget` never loads the embedded
 * store (LocalBackend is imported lazily, only when a command actually runs), so this is
 * ONNX-safe inside a Jest worker.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { Command } from 'commander';
import { resolveBackendTarget } from '../../src/cli/backend/resolve-backend.js';
import { isLocalTarget, LOCAL_TARGET, LOCAL_TARGET_ALIASES } from '../../src/cli/local-target.js';

function fakeProgram(opts: Record<string, unknown>): Command {
  return { optsWithGlobals: () => opts } as unknown as Command;
}

describe('isLocalTarget', () => {
  it('matches every alias case-insensitively with trimming', () => {
    for (const alias of LOCAL_TARGET_ALIASES) {
      expect(isLocalTarget(alias)).toBe(true);
      expect(isLocalTarget(`  ${alias.toUpperCase()}  `)).toBe(true);
    }
  });

  it('rejects http(s) and empty values', () => {
    expect(isLocalTarget('http://localhost:3300')).toBe(false);
    expect(isLocalTarget('https://squadrules.example/api')).toBe(false);
    expect(isLocalTarget('')).toBe(false);
    expect(isLocalTarget(undefined)).toBe(false);
    expect(isLocalTarget(null)).toBe(false);
  });

  it('treats LOCAL_TARGET as one of the local aliases', () => {
    expect(LOCAL_TARGET_ALIASES).toContain(LOCAL_TARGET);
    expect(isLocalTarget(LOCAL_TARGET)).toBe(true);
  });
});

describe('resolveBackendTarget', () => {
  const originalUrl = process.env['SQUADRULES_API_URL'];
  const originalTrusted = process.env['SQUADRULES_TRUSTED_API_HOSTS'];

  beforeEach(() => {
    // Keep host validation out of the way so the http assertions are deterministic.
    delete process.env['SQUADRULES_TRUSTED_API_HOSTS'];
    delete process.env['SQUADRULES_API_URL'];
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env['SQUADRULES_API_URL'];
    else process.env['SQUADRULES_API_URL'] = originalUrl;
    if (originalTrusted === undefined) delete process.env['SQUADRULES_TRUSTED_API_HOSTS'];
    else process.env['SQUADRULES_TRUSTED_API_HOSTS'] = originalTrusted;
  });

  it('resolves the local sentinel to kind=local without URL validation', () => {
    expect(resolveBackendTarget(fakeProgram({ url: LOCAL_TARGET }))).toEqual({ kind: 'local' });
  });

  it('resolves the "local" and "stdio" aliases to kind=local', () => {
    expect(resolveBackendTarget(fakeProgram({ url: 'local' }))).toEqual({ kind: 'local' });
    expect(resolveBackendTarget(fakeProgram({ url: 'STDIO' }))).toEqual({ kind: 'local' });
  });

  it('resolves an http --url to kind=http with a normalized base URL', () => {
    const target = resolveBackendTarget(fakeProgram({ url: 'http://localhost:3300/' }));
    expect(target).toEqual({ kind: 'http', baseUrl: 'http://localhost:3300' });
  });

  it('resolves an https --url to kind=http', () => {
    const target = resolveBackendTarget(fakeProgram({ url: 'https://squadrules.example/api' }));
    expect(target).toEqual({ kind: 'http', baseUrl: 'https://squadrules.example/api' });
  });

  it('rejects a non-http, non-sentinel --url', () => {
    expect(() => resolveBackendTarget(fakeProgram({ url: 'ftp://example.com' }))).toThrow(
      /Unsupported API base URL protocol/i
    );
  });

  it('honours SQUADRULES_TRUSTED_API_HOSTS when set', () => {
    process.env['SQUADRULES_TRUSTED_API_HOSTS'] = 'allowed.example';
    expect(() => resolveBackendTarget(fakeProgram({ url: 'https://other.example/api' }))).toThrow(
      /not in SQUADRULES_TRUSTED_API_HOSTS/i
    );
    expect(resolveBackendTarget(fakeProgram({ url: 'https://allowed.example/api' }))).toEqual({
      kind: 'http',
      baseUrl: 'https://allowed.example/api'
    });
  });

  it('falls back to SQUADRULES_API_URL when --url is absent', () => {
    process.env['SQUADRULES_API_URL'] = LOCAL_TARGET;
    expect(resolveBackendTarget(fakeProgram({}))).toEqual({ kind: 'local' });

    process.env['SQUADRULES_API_URL'] = 'https://squadrules.example/api';
    expect(resolveBackendTarget(fakeProgram({}))).toEqual({
      kind: 'http',
      baseUrl: 'https://squadrules.example/api'
    });
  });
});
