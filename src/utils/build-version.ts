/**
 * Simple build version helper for SQUADRULES MCP.
 *
 * Format (semantic build version):
 *   v1.0.0+20251129.204700
 *
 * Where:
 *   - v1.0.0 comes from package.json version
 *   - +20251129.204700 is build timestamp (YYYYMMDD.HHMMSS)
 *
 * Computed once at process startup so it is stable
 * for the lifetime of the running server.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const getPackageVersion = (): string => {
  try {
    // Get the directory of the current file
    const currentFileUrl = import.meta.url;
    const currentFilePath = fileURLToPath(currentFileUrl);
    const currentDir = dirname(currentFilePath);
    const packageJsonPath = join(currentDir, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
    return packageJson.version;
  } catch {
    // Fallback if package.json cannot be read
    return '1.0.0';
  }
};

const buildVersion: string = (() => {
  const version = getPackageVersion();
  
  const now = new Date();
  const dateStr = String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const timeStr = String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  return `v${version}+${dateStr}.${timeStr}`;
})();

export function getBuildVersion(): string {
  return buildVersion;
}

