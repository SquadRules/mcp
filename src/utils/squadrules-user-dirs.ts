/**
 * Shared SquadRules user directory layout for CLI config, skills and embedded storage.
 *
 * Default: ~/.squadrules on all platforms. SQUADRULES_HOME can override the
 * complete path (primarily for isolated installations and tests).
 * The former XDG/APPDATA directory is moved on first startup if the target is absent.
 */
import { homedir, platform } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { existsSync, lstatSync, mkdirSync, renameSync } from 'node:fs';

function userHome(env: NodeJS.ProcessEnv): string {
  return (platform() === 'win32'
    ? env['USERPROFILE'] || env['HOME']
    : env['HOME'] || env['USERPROFILE']) || homedir();
}

/** Absolute path to the shared SquadRules directory. Does not touch the filesystem. */
export function getSquadRulesConfigDirPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['SQUADRULES_HOME'];
  if (override) {
    if (!isAbsolute(override)) throw new Error('SQUADRULES_HOME must be an absolute path.');
    return override;
  }
  return join(userHome(env), '.squadrules');
}

function getPreviousSquadrulesConfigDirPath(env: NodeJS.ProcessEnv): string {
  const home = userHome(env);
  return platform() === 'win32'
    ? join(env['APPDATA'] || join(home, 'AppData', 'Roaming'), 'squadrules')
    : join(env['XDG_CONFIG_HOME'] || join(home, '.config'), 'squadrules');
}

/**
 * Move the previous config tree, including config.json, skills and embedded data.
 * Do not merge or overwrite when the new directory already exists. An explicit
 * SQUADRULES_HOME is managed by the caller and is not migrated automatically.
 * A failed move must be visible rather than silently starting with empty data.
 */
export function migrateOldSquadrulesConfigDir(env: NodeJS.ProcessEnv = process.env): void {
  if (env['SQUADRULES_HOME']) return;

  const target = getSquadRulesConfigDirPath(env);
  const source = getPreviousSquadrulesConfigDirPath(env);
  if (source === target || existsSync(target) || !existsSync(source)) return;

  try {
    if (!lstatSync(source).isDirectory()) {
      throw new Error('Source is not a directory (or is a symbolic link).');
    }
    renameSync(source, target);
  } catch (error) {
    // A second process may have completed the move between the existence check and rename.
    if (existsSync(target)) return;
    throw new Error(
      `Could not move SquadRules data from "${source}" to "${target}". Resolve the filesystem issue or move it manually before restarting.`,
      { cause: error }
    );
  }
}

/** Create the config directory only after attempting the one-time move. */
export function getSquadrulesConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  migrateOldSquadrulesConfigDir(env);
  const dir = getSquadRulesConfigDirPath(env);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // If creation fails, still return the path (callers handle errors).
  }
  return dir;
}

/** Base directory for installed skill mirrors, under the same tree as config.json. */
export function getSquadrulesSkillsInstallBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getSquadrulesConfigDir(env), 'skills');
}

/** Suggested install path for one skill slug (e.g. after export + unzip). */
export function getSquadrulesSkillInstallDirForSlug(slug: string, env: NodeJS.ProcessEnv = process.env): string {
  const safe = slug.replace(/[/\\]/g, '_');
  return join(getSquadrulesSkillsInstallBaseDir(env), safe);
}

/**
 * User-shared embedding model weights cache: intentionally separate from ~/.squadrules.
 * - Windows: %LOCALAPPDATA%\\embedding-models or ~\\AppData\\Local\\embedding-models
 * - Unix: $XDG_CACHE_HOME/embedding-models or ~/.cache/embedding-models
 */
export function getEmbeddingModelsCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = platform() === 'win32'
    ? (env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local'))
    : (env['XDG_CACHE_HOME'] || join(homedir(), '.cache'));
  return join(base, 'embedding-models');
}
