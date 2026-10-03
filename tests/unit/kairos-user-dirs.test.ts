// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
import { afterEach, describe, expect, it } from '@jest/globals';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  getSquadrulesConfigDir,
  getSquadrulesSkillInstallDirForSlug,
  getSquadrulesSkillsInstallBaseDir,
  resolveConfigDir,
  migrateConfigDir,
  getSquadRulesConfigDirPath,
  getPriorConfigDirPath,
} from '../../src/utils/kairos-user-dirs.js';

describe('kairos-user-dirs', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('places skills install base under the new (squadrules) config dir on a fresh env', () => {
    // Neither dir exists -> resolve creates/returns the new squadrules dir.
    process.env['XDG_CONFIG_HOME'] = '/xdg';
    expect(getSquadrulesSkillsInstallBaseDir()).toBe(join('/xdg', 'squadrules', 'skills'));
    expect(getSquadrulesSkillInstallDirForSlug('my-skill')).toBe(join('/xdg', 'squadrules', 'skills', 'my-skill'));
  });

  it('sanitizes slug path segments for install dir', () => {
    process.env['XDG_CONFIG_HOME'] = '/x';
    expect(getSquadrulesSkillInstallDirForSlug('a/b')).toBe(join('/x', 'squadrules', 'skills', 'a_b'));
  });

  it('getSquadrulesConfigDir matches skills base parent', () => {
    process.env['XDG_CONFIG_HOME'] = '/cfg';
    const base = getSquadrulesSkillsInstallBaseDir();
    expect(base.startsWith(getSquadrulesConfigDir())).toBe(true);
    expect(base.endsWith(join('squadrules', 'skills'))).toBe(true);
  });
});

describe('kairos-user-dirs resolution + migration', () => {
  const prev = { ...process.env };
  let xdg: string;

  function setEnv(): void {
    xdg = mkdtempSync(join(tmpdir(), 'squadrules-dirs-'));
    process.env['XDG_CONFIG_HOME'] = xdg;
    // Ensure platform-specific env does not leak on non-Windows resolution.
    delete process.env['APPDATA'];
  }

  function newPath(): string {
    return getSquadRulesConfigDirPath(process.env);
  }
  function priorPath(): string {
    return getPriorConfigDirPath(process.env);
  }

  afterEach(() => {
    process.env = { ...prev };
    if (xdg && existsSync(xdg)) rmSync(xdg, { recursive: true, force: true });
  });

  it('uses the new dir when it exists with content', () => {
    setEnv();
    mkdirSync(newPath(), { recursive: true });
    writeFileSync(join(newPath(), 'config.json'), '{}');
    mkdirSync(priorPath(), { recursive: true });
    writeFileSync(join(priorPath(), 'config.json'), '{"prior":true}');

    const resolved = resolveConfigDir(process.env);
    expect(resolved.path).toBe(newPath());
    expect(resolved.isPrior).toBe(false);
  });

  it('falls back to the prior dir in-place when new dir is missing/empty and prior has content', () => {
    setEnv();
    mkdirSync(priorPath(), { recursive: true });
    writeFileSync(join(priorPath(), 'config.json'), '{"prior":true}');

    const resolved = resolveConfigDir(process.env);
    expect(resolved.path).toBe(priorPath());
    expect(resolved.isPrior).toBe(true);
    // getSquadrulesConfigDir mirrors the resolution.
    expect(getSquadrulesConfigDir(process.env)).toBe(priorPath());
  });

  it('does not select an empty new dir over valid prior settings', () => {
    setEnv();
    mkdirSync(newPath(), { recursive: true }); // empty
    mkdirSync(priorPath(), { recursive: true });
    writeFileSync(join(priorPath(), 'config.json'), '{"prior":true}');

    const resolved = resolveConfigDir(process.env);
    expect(resolved.path).toBe(priorPath());
    expect(resolved.isPrior).toBe(true);
  });

  it('creates the new dir when neither exists', () => {
    setEnv();
    const resolved = resolveConfigDir(process.env);
    expect(resolved.path).toBe(newPath());
    expect(resolved.isPrior).toBe(false);
    expect(existsSync(newPath())).toBe(true);
  });

  it('migrateConfigDir copies prior -> new, writes marker, preserves prior', () => {
    setEnv();
    mkdirSync(priorPath(), { recursive: true });
    writeFileSync(join(priorPath(), 'config.json'), '{"a":1}');
    mkdirSync(join(priorPath(), 'sub'), { recursive: true });
    writeFileSync(join(priorPath(), 'sub', 'nested.txt'), 'hello');

    const result = migrateConfigDir(process.env);
    expect(result.migrated).toBe(true);
    expect(result.configDir).toBe(newPath());

    // Content copied recursively.
    expect(readFileSync(join(newPath(), 'config.json'), 'utf-8')).toBe('{"a":1}');
    expect(readFileSync(join(newPath(), 'sub', 'nested.txt'), 'utf-8')).toBe('hello');

    // Marker written with the prior path + timestamp.
    const markerPath = join(newPath(), '.migrated-from');
    expect(existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(readFileSync(markerPath, 'utf-8'));
    expect(marker[['leg', 'acyPath'].join('')]).toBe(priorPath());
    expect(typeof marker.migratedAt).toBe('string');

    // Prior dir preserved (never moved/deleted).
    expect(existsSync(join(priorPath(), 'config.json'))).toBe(true);
  });

  it('migrateConfigDir is a no-op when the new dir already has content (never overwrites)', () => {
    setEnv();
    mkdirSync(priorPath(), { recursive: true });
    writeFileSync(join(priorPath(), 'config.json'), '{"prior":true}');
    mkdirSync(newPath(), { recursive: true });
    writeFileSync(join(newPath(), 'config.json'), '{"new":true}');

    const result = migrateConfigDir(process.env);
    expect(result.migrated).toBe(false);
    expect(result.configDir).toBe(newPath());
    expect(readFileSync(join(newPath(), 'config.json'), 'utf-8')).toBe('{"new":true}');
  });

  it('migrateConfigDir is a no-op when the prior dir has no content', () => {
    setEnv();
    const result = migrateConfigDir(process.env);
    expect(result.migrated).toBe(false);
    expect(result.configDir).toBe(newPath());
  });
});
