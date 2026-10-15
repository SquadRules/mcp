/**
 * Security-hardened directory access for MCP `directory` parameter.
 *
 * Only accepted in SIMPLE/stdio mode. Rejects symlink escapes, path traversal,
 * and paths outside the configured allowlist. Every access is audit-logged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TRANSPORT_TYPE, AUTH_ENABLED } from '../config/runtime-mode.js';
import { structuredLogger } from './structured-logger.js';

/** Maximum directory depth for batch operations. */
export const MAX_DIRECTORY_DEPTH = 8;

/** Maximum adapter count per batch directory operation. */
export const MAX_BATCH_ADAPTERS = 256;

/**
 * Resolve and validate a directory path for MCP batch operations.
 *
 * Security checks (in order):
 * 1. SIMPLE/stdio-only gate — rejects when transport is HTTP or auth is enabled.
 * 2. Absolute path required.
 * 3. No `..` segments after splitting.
 * 4. Symlink resolution via `fs.realpathSync`.
 * 5. Allowlist prefix check (env-configured or default fallback).
 * 6. Must be an existing directory.
 * 7. Depth cap.
 *
 * @throws Error with a clear message when any check fails.
 * @returns The resolved absolute real path.
 */
export function resolveAndValidateDirectory(
  directory: string,
  operation: 'export' | 'train'
): string {
  // 1. SIMPLE/stdio-only gate
  if (TRANSPORT_TYPE !== 'stdio' || AUTH_ENABLED) {
    throw new Error(
      `The "directory" parameter is only available in SIMPLE/stdio mode. ` +
      `Current transport: ${TRANSPORT_TYPE}, auth: ${AUTH_ENABLED ? 'enabled' : 'disabled'}. ` +
      `Remove the "directory" parameter and use inline content/URI arguments instead.`
    );
  }

  const trimmed = directory.trim();
  if (!trimmed) {
    throw new Error('"directory" must be a non-empty absolute path.');
  }

  // 2. Absolute path required
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`"directory" must be an absolute path (got: "${trimmed}").`);
  }

  // 3. No .. segments
  const segments = trimmed.split(path.sep).filter(Boolean);
  if (segments.includes('..')) {
    throw new Error(`"directory" must not contain ".." path segments.`);
  }

  // 4. Symlink resolution (only if path exists)
  let resolved: string;
  try {
    resolved = fs.realpathSync(trimmed);
  } catch {
    // Path doesn't exist yet — for export, the directory may need to be created.
    // Resolve the parent to check for symlink escapes on the existing portion.
    const parent = path.dirname(trimmed);
    try {
      const realParent = fs.realpathSync(parent);
      resolved = path.join(realParent, path.basename(trimmed));
    } catch {
      throw new Error(`"directory" parent path does not exist: "${parent}".`);
    }
  }

  // 5. Allowlist prefix check
  const allowlistEnvKey = operation === 'export'
    ? 'SQUADRULES_ALLOWED_EXPORT_DIRS'
    : 'SQUADRULES_ALLOWED_TRAIN_DIRS';
  const allowlistRaw = process.env[allowlistEnvKey];
  const allowedPrefixes = allowlistRaw
    ? allowlistRaw.split(',').map((p) => p.trim()).filter(Boolean)
    : getDefaultAllowedPrefixes();

  const permitted = allowedPrefixes.some((prefix) => {
    const realPrefix = safeRealpath(prefix);
    const checkPrefix = realPrefix ?? prefix;
    return resolved === checkPrefix || resolved.startsWith(checkPrefix + path.sep);
  });

  if (!permitted) {
    throw new Error(
      `"directory" path "${resolved}" is not within the allowed directories. ` +
      `Set ${allowlistEnvKey} to a comma-separated list of allowed absolute prefixes, ` +
      `or use a path under the default locations.`
    );
  }

  // 6. Must be a directory (if it exists)
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`"directory" path is not a directory: "${resolved}".`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('"directory" path is not')) {
      throw error;
    }
    // Stat failed but realpath succeeded — directory may not exist yet (export case)
  }

  // 7. Depth cap
  const depth = resolved.split(path.sep).filter(Boolean).length;
  if (depth > MAX_DIRECTORY_DEPTH) {
    throw new Error(`"directory" depth ${depth} exceeds maximum ${MAX_DIRECTORY_DEPTH}.`);
  }

  // Audit log
  structuredLogger.getPinoLogger().info(
    { event: 'directory_access', operation, resolved_path: resolved, allowlist: allowedPrefixes },
    `directory access: ${operation} → ${resolved}`
  );

  return resolved;
}

/**
 * Scan a directory for `.md` files, optionally recursively.
 * Returns absolute paths sorted alphabetically.
 */
export function scanMarkdownFiles(
  directory: string,
  recursive: boolean
): string[] {
  const results: string[] = [];

  function walk(dir: string, currentDepth: number): void {
    if (currentDepth > MAX_DIRECTORY_DEPTH) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
        if (results.length > MAX_BATCH_ADAPTERS) {
          throw new Error(`Directory contains more than ${MAX_BATCH_ADAPTERS} .md files.`);
        }
      } else if (entry.isDirectory() && recursive) {
        walk(fullPath, currentDepth + 1);
      }
    }
  }

  walk(directory, 0);
  return results.sort();
}

function getDefaultAllowedPrefixes(): string[] {
  const prefixes: string[] = [];
  const xdgConfig = process.env['XDG_CONFIG_HOME'] || path.join(process.env['HOME'] || '', '.config');
  if (xdgConfig) {
    prefixes.push(path.join(xdgConfig, 'squadrules'));
  }
  // Allow CWD project tree
  prefixes.push(process.cwd());
  return prefixes;
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}
