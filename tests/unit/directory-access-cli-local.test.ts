/**
 * Issue #201 gap 2 (transport gate): the CLI local backend runs the export in-process
 * on the user's machine, so `resolveAndValidateDirectory` must accept it as
 * SIMPLE-mode equivalent — while every path check (absolute, allowlist, symlink,
 * depth) still applies. Without the option the gate must keep rejecting, because a
 * CLI data-command process resolves TRANSPORT_TYPE=http (see src/cli/log-sink-prelude.ts).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('directory-access: simpleModeEquivalent (CLI local backend)', () => {
  const ORIGINAL_ENV = process.env;
  let tmpDir: string;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    // A CLI data command resolves TRANSPORT_TYPE=http / AUTH_ENABLED=true by default.
    delete process.env['TRANSPORT_TYPE'];
    delete process.env['SQUADRULES_MCP_STDIO'];
    delete process.env['SQUADRULES_CLI_SERVE'];
    delete process.env['AUTH_ENABLED'];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-dir-cli-local-'));
    process.env['SQUADRULES_ALLOWED_EXPORT_DIRS'] = tmpDir;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects directory without the option in a CLI-like (http-default) process', async () => {
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    expect(() => resolveAndValidateDirectory(tmpDir, 'export')).toThrow(/SIMPLE\/stdio/);
  });

  it('accepts an allowlisted directory with simpleModeEquivalent', async () => {
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    const resolved = resolveAndValidateDirectory(tmpDir, 'export', { simpleModeEquivalent: true });
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  it('still rejects relative paths with simpleModeEquivalent', async () => {
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    expect(() => resolveAndValidateDirectory('relative/path', 'export', { simpleModeEquivalent: true })).toThrow(
      /absolute path/
    );
  });

  it('still rejects paths outside the allowlist with simpleModeEquivalent', async () => {
    process.env['SQUADRULES_ALLOWED_EXPORT_DIRS'] = '/opt/allowed';
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    expect(() => resolveAndValidateDirectory(tmpDir, 'export', { simpleModeEquivalent: true })).toThrow(
      /not within the allowed/
    );
  });

  it('still rejects .. segments with simpleModeEquivalent', async () => {
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    expect(() => resolveAndValidateDirectory(`${tmpDir}/../escape`, 'export', { simpleModeEquivalent: true })).toThrow(
      /\.\.|not within the allowed/
    );
  });
});
