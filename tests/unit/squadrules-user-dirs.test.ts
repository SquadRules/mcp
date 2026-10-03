import { describe, expect, it } from '@jest/globals';
import { join } from 'node:path';
import {
  getSquadrulesConfigDir,
  getSquadrulesSkillInstallDirForSlug,
  getSquadrulesSkillsInstallBaseDir,
  getSquadRulesConfigDirPath,
} from '../../src/utils/squadrules-user-dirs.js';

describe('squadrules-user-dirs', () => {
  const prev = { ...process.env };

  it('resolves the config dir to the squadrules directory under XDG_CONFIG_HOME', () => {
    process.env = { ...prev, XDG_CONFIG_HOME: '/xdg' };
    expect(getSquadRulesConfigDirPath(process.env)).toBe(join('/xdg', 'squadrules'));
    expect(getSquadrulesSkillsInstallBaseDir(process.env)).toBe(join('/xdg', 'squadrules', 'skills'));
    expect(getSquadrulesSkillInstallDirForSlug('my-skill', process.env)).toBe(
      join('/xdg', 'squadrules', 'skills', 'my-skill')
    );
  });

  it('sanitizes slug path segments for the install dir', () => {
    process.env = { ...prev, XDG_CONFIG_HOME: '/x' };
    expect(getSquadrulesSkillInstallDirForSlug('a/b', process.env)).toBe(join('/x', 'squadrules', 'skills', 'a_b'));
  });

  it('getSquadrulesConfigDir is the parent of the skills base', () => {
    process.env = { ...prev, XDG_CONFIG_HOME: '/cfg' };
    const configDir = getSquadrulesConfigDir(process.env);
    expect(configDir).toBe(join('/cfg', 'squadrules'));
    expect(getSquadrulesSkillsInstallBaseDir(process.env).startsWith(configDir)).toBe(true);
  });
});
