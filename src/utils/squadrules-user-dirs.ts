/**
 * Cross-OS SquadRules user directory layout (shared by CLI config and runtime defaults).
 *
 * The config directory is `squadrules` under the platform-appropriate base
 * (`$XDG_CONFIG_HOME` / `~/.config`, or `%APPDATA%` on Windows).
 */
import { homedir, platform } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

/** Config directory name. */
const CONFIG_DIR_NAME = 'squadrules';

// ---------------------------------------------------------------------------
// Path resolution helpers
// ---------------------------------------------------------------------------

function configBase(env: NodeJS.ProcessEnv): string {
  if (platform() === 'win32') {
    return env['APPDATA'] || join(homedir(), 'AppData', 'Roaming');
  }
  return env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
}

/** Absolute path to the config directory. */
export function getSquadRulesConfigDirPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configBase(env), CONFIG_DIR_NAME);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Directory for SquadRules CLI/MCP JSON config (`config.json`).
 * - Windows: `%APPDATA%\squadrules`
 * - Unix: `$XDG_CONFIG_HOME/squadrules` or `~/.config/squadrules`
 */
export function getSquadrulesConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const path = getSquadRulesConfigDirPath(env);
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    // If creation fails, still return the path (callers handle errors)
  }
  return path;
}

/**
 * Base directory for locally installed skill mirrors (flat Markdown or unzipped bundles),
 * under the same tree as CLI config (`config.json`). Not created automatically.
 */
export function getSquadrulesSkillsInstallBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getSquadrulesConfigDir(env), 'skills');
}

/** Suggested install path for one skill slug (e.g. after `export` + unzip). */
export function getSquadrulesSkillInstallDirForSlug(slug: string, env: NodeJS.ProcessEnv = process.env): string {
  const safe = slug.replace(/[/\\]/g, '_');
  return join(getSquadrulesSkillsInstallBaseDir(env), safe);
}

/**
 * Base directory for locally downloaded embedding-model artifacts (fastembed ONNX
 * weights), under the same tree as CLI config and the embedded LanceDB store.
 * Passed to `fastembed` as its `cacheDir`; fastembed owns fetching/verification
 * inside this directory. Created on demand by the downloader, so like the skills
 * base this helper does not `mkdir` eagerly.
 * - Windows: `%APPDATA%\squadrules\models`
 * - Unix: `$XDG_CONFIG_HOME/squadrules/models` or `~/.config/squadrules/models`
 */
export function getSquadrulesModelsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getSquadrulesConfigDir(env), 'models');
}

/**
 * User-shared cache directory for embedding model weights (XDG cache style).
 * Shared across all embedding libraries (fastembed, transformers.js, etc.) to
 * avoid duplicate downloads. Download once, reuse everywhere.
 * - Windows: `%LOCALAPPDATA%\embedding-models` or `~\AppData\Local\embedding-models`
 * - Unix: `$XDG_CACHE_HOME/embedding-models` or `~/.cache/embedding-models`
 */
export function getEmbeddingModelsCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = platform() === 'win32'
    ? (env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local'))
    : (env['XDG_CACHE_HOME'] || join(homedir(), '.cache'));
  return join(base, 'embedding-models');
}
