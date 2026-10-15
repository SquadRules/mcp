/**
 * Tests for #102 — directory parameter security validation.
 */
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('directory-access: resolveAndValidateDirectory', () => {
  const ORIGINAL_ENV = process.env;
  let tmpDir: string;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-dir-test-'));
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects directory in HTTP transport mode', async () => {
    process.env['TRANSPORT_TYPE'] = 'http';
    // Must import after setting env because TRANSPORT_TYPE is evaluated at module load
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    try {
      resolveAndValidateDirectory(tmpDir, 'export');
      fail('expected error');
    } catch (error) {
      expect((error as Error).message).toMatch(/SIMPLE\/stdio|not within the allowed/);
    }
  });

  it('rejects relative paths', async () => {
    process.env['TRANSPORT_TYPE'] = 'stdio';
    process.env['SQUADRULES_ALLOWED_EXPORT_DIRS'] = tmpDir;
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    expect(() => resolveAndValidateDirectory('relative/path', 'export')).toThrow(/absolute path/);
  });

  it('rejects paths with .. segments', async () => {
    process.env['TRANSPORT_TYPE'] = 'stdio';
    process.env['SQUADRULES_ALLOWED_EXPORT_DIRS'] = tmpDir;
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    // Use a literal string with .. to avoid path.join resolving it
    expect(() => resolveAndValidateDirectory(`${tmpDir}/../escape`, 'export')).toThrow(/\.\.|not within the allowed/);
  });

  it('rejects paths outside allowlist', async () => {
    process.env['TRANSPORT_TYPE'] = 'stdio';
    process.env['SQUADRULES_ALLOWED_EXPORT_DIRS'] = '/opt/allowed';
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    expect(() => resolveAndValidateDirectory(tmpDir, 'export')).toThrow(/not within the allowed/);
  });

  it('accepts valid directory within allowlist', async () => {
    process.env['TRANSPORT_TYPE'] = 'stdio';
    process.env['SQUADRULES_ALLOWED_EXPORT_DIRS'] = tmpDir;
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    const resolved = resolveAndValidateDirectory(tmpDir, 'export');
    expect(resolved).toBeTruthy();
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  it('rejects symlink escape attempts', async () => {
    process.env['TRANSPORT_TYPE'] = 'stdio';
    const allowedDir = path.join(tmpDir, 'allowed');
    fs.mkdirSync(allowedDir);
    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir);
    const symlinkPath = path.join(allowedDir, 'escape-link');
    fs.symlinkSync(targetDir, symlinkPath);

    process.env['SQUADRULES_ALLOWED_EXPORT_DIRS'] = allowedDir;
    const { resolveAndValidateDirectory } = await import('../../src/utils/directory-access.js');
    // The symlink resolves to targetDir which is outside allowedDir
    expect(() => resolveAndValidateDirectory(symlinkPath, 'export')).toThrow(/not within the allowed/);
  });
});

describe('directory-access: scanMarkdownFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-scan-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds .md files in a flat directory', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), '# A');
    fs.writeFileSync(path.join(tmpDir, 'b.md'), '# B');
    fs.writeFileSync(path.join(tmpDir, 'c.txt'), 'not markdown');

    const { scanMarkdownFiles } = await import('../../src/utils/directory-access.js');
    const files = scanMarkdownFiles(tmpDir, false);
    expect(files).toHaveLength(2);
    expect(files.every(f => f.endsWith('.md'))).toBe(true);
  });

  it('finds .md files recursively when recursive=true', async () => {
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(tmpDir, 'root.md'), '# Root');
    fs.writeFileSync(path.join(subDir, 'nested.md'), '# Nested');

    const { scanMarkdownFiles } = await import('../../src/utils/directory-access.js');
    const flat = scanMarkdownFiles(tmpDir, false);
    expect(flat).toHaveLength(1);

    const recursive = scanMarkdownFiles(tmpDir, true);
    expect(recursive).toHaveLength(2);
  });

  it('skips hidden files and directories', async () => {
    fs.writeFileSync(path.join(tmpDir, '.hidden.md'), '# Hidden');
    const hiddenDir = path.join(tmpDir, '.hidden-dir');
    fs.mkdirSync(hiddenDir);
    fs.writeFileSync(path.join(hiddenDir, 'inside.md'), '# Inside');
    fs.writeFileSync(path.join(tmpDir, 'visible.md'), '# Visible');

    const { scanMarkdownFiles } = await import('../../src/utils/directory-access.js');
    const files = scanMarkdownFiles(tmpDir, true);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('visible.md');
  });
});

describe('export/train schema: directory field', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('export schema accepts directory parameter', async () => {
    const { exportInputSchema } = await import('../../src/tools/export_schema.js');
    const parsed = exportInputSchema.safeParse({
      all_adapters: true,
      space_name: 'personal',
      format: 'skill_tree',
      directory: '/tmp/exports'
    });
    expect(parsed.success).toBe(true);
  });

  it('train schema accepts directory parameter without content', async () => {
    const { trainInputSchema } = await import('../../src/tools/train_schema.js');
    const parsed = trainInputSchema.safeParse({
      llm_model_id: 'test-model',
      directory: '/tmp/adapters',
      recursive: true
    });
    expect(parsed.success).toBe(true);
  });

  it('train schema rejects when no content, source, or directory', async () => {
    const { trainInputSchema } = await import('../../src/tools/train_schema.js');
    const parsed = trainInputSchema.safeParse({
      llm_model_id: 'test-model'
    });
    expect(parsed.success).toBe(false);
  });
});
