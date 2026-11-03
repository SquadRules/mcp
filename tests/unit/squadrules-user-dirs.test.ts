import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getSquadrulesConfigDir,
  getSquadrulesSkillInstallDirForSlug,
  getSquadrulesSkillsInstallBaseDir,
  getSquadRulesConfigDirPath,
  migrateOldSquadrulesConfigDir,
} from '../../src/utils/squadrules-user-dirs.js';

describe('squadrules-user-dirs', () => {
  let root: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'squadrules-user-dirs-test-'));
    home = join(root, 'home');
    mkdirSync(home);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function testEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      XDG_CONFIG_HOME: join(root, 'custom-xdg'),
      SQUADRULES_HOME: undefined,
      ...extra,
    };
  }

  function previousDir(env: NodeJS.ProcessEnv): string {
    return platform() === 'win32'
      ? join(env['APPDATA']!, 'squadrules')
      : join(env['XDG_CONFIG_HOME']!, 'squadrules');
  }

  it('uses ~/.squadrules for config and installed skills regardless of XDG_CONFIG_HOME', () => {
    const env = testEnv();
    expect(getSquadRulesConfigDirPath(env)).toBe(join(home, '.squadrules'));
    expect(getSquadrulesSkillsInstallBaseDir(env)).toBe(join(home, '.squadrules', 'skills'));
    expect(getSquadrulesSkillInstallDirForSlug('my-skill', env)).toBe(
      join(home, '.squadrules', 'skills', 'my-skill')
    );
  });

  it('sanitizes skill slug path segments', () => {
    const env = testEnv();
    expect(getSquadrulesSkillInstallDirForSlug('a/b', env))
      .toBe(join(home, '.squadrules', 'skills', 'a_b'));
  });

  it('moves the complete previous directory on first access and does not repeat the move', () => {
    const env = testEnv();
    const source = previousDir(env);
    const target = join(home, '.squadrules');
    mkdirSync(join(source, 'skills', 'example'), { recursive: true });
    mkdirSync(join(source, 'lancedb'), { recursive: true });
    writeFileSync(join(source, 'config.json'), '{"defaultUrl":"https://example.invalid"}');
    writeFileSync(join(source, 'skills', 'example', 'SKILL.md'), 'skill data');
    writeFileSync(join(source, 'lancedb', 'records.txt'), 'embedded data');

    expect(getSquadrulesConfigDir(env)).toBe(target);
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(target, 'config.json'), 'utf8')).toContain('defaultUrl');
    expect(readFileSync(join(target, 'skills', 'example', 'SKILL.md'), 'utf8')).toBe('skill data');
    expect(readFileSync(join(target, 'lancedb', 'records.txt'), 'utf8')).toBe('embedded data');
    expect(() => migrateOldSquadrulesConfigDir(env)).not.toThrow();
  });

  it('moves ~/.config/squadrules when XDG_CONFIG_HOME is not set', () => {
    const env = testEnv({ XDG_CONFIG_HOME: undefined });
    const source = platform() === 'win32'
      ? join(env['APPDATA']!, 'squadrules')
      : join(home, '.config', 'squadrules');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'config.json'), 'old config');

    migrateOldSquadrulesConfigDir(env);
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(home, '.squadrules', 'config.json'), 'utf8')).toBe('old config');
  });

  it('finds ~/.config/squadrules even when a custom XDG home is empty', () => {
    const env = testEnv();
    if (platform() === 'win32') return;
    const source = join(home, '.config', 'squadrules');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'config.json'), 'default old config');

    migrateOldSquadrulesConfigDir(env);
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(home, '.squadrules', 'config.json'), 'utf8')).toBe('default old config');
  });

  it('never overwrites or merges when ~/.squadrules already exists', () => {
    const env = testEnv();
    const source = previousDir(env);
    const target = join(home, '.squadrules');
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(source, 'config.json'), 'previous');
    writeFileSync(join(target, 'config.json'), 'current');

    migrateOldSquadrulesConfigDir(env);
    expect(readFileSync(join(source, 'config.json'), 'utf8')).toBe('previous');
    expect(readFileSync(join(target, 'config.json'), 'utf8')).toBe('current');
  });

  it('creates a fresh directory when there is nothing to move', () => {
    const env = testEnv();
    expect(getSquadrulesConfigDir(env)).toBe(join(home, '.squadrules'));
    expect(existsSync(join(home, '.squadrules'))).toBe(true);
  });

  it('honors an explicit SQUADRULES_HOME without migrating other directories', () => {
    const override = join(root, 'custom-squadrules');
    const env = testEnv({ SQUADRULES_HOME: override });
    const source = previousDir(env);
    mkdirSync(source, { recursive: true });
    expect(getSquadrulesConfigDir(env)).toBe(override);
    expect(existsSync(source)).toBe(true);
    expect(getSquadrulesSkillsInstallBaseDir(env)).toBe(join(override, 'skills'));
  });

  it('requires SQUADRULES_HOME to be absolute', () => {
    expect(() => getSquadRulesConfigDirPath(testEnv({ SQUADRULES_HOME: 'relative/path' })))
      .toThrow(/absolute path/);
  });
});
