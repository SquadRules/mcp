#!/usr/bin/env node
// NOTE: This script moves to SquadRules/charts repository. Kept temporarily for transition.
/**
 * Syncs helm/kairos-mcp/Chart.yaml `appVersion` and
 * helm/kairos-mcp/values.yaml default `app.image.tag` from package.json.
 *
 * Only applies when the package.json version is a stable release (no prerelease
 * suffix). Pre-releases (rc, beta, pre) are intentionally skipped so the chart
 * defaults always point to a known-stable image.
 *
 * Usage: node scripts/helm-sync-app-version.mjs [--check]
 *   --check  exits non-zero if files are out of sync (CI mode)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const pkgPath = resolve(root, 'package.json');
const chartPath = resolve(root, 'helm/kairos-mcp/Chart.yaml');
const valuesPath = resolve(root, 'helm/kairos-mcp/values.yaml');

const checkMode = process.argv.includes('--check');

function normalizeVersion(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
}

function isStableVersion(v) {
  return !!v && !/[-]/.test(v);
}

function getLatestStableGitTagVersion() {
  try {
    const tag = execSync("git tag --sort=-v:refname | head -n 50 | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$' | head -n 1", {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return normalizeVersion(tag);
  } catch {
    return null;
  }
}

const explicitVersionIndex = process.argv.indexOf('--version');
const explicitVersion = explicitVersionIndex >= 0 ? normalizeVersion(process.argv[explicitVersionIndex + 1]) : null;

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const pkgVersion = normalizeVersion(pkg.version);

const version = explicitVersion || (isStableVersion(pkgVersion) ? pkgVersion : getLatestStableGitTagVersion());

if (!version) {
  console.log('helm-sync-app-version: skipping (no stable version found)');
  process.exit(0);
}

if (!isStableVersion(version)) {
  console.log(`helm-sync-app-version: skipping (non-stable ${version})`);
  process.exit(0);
}

let chart = readFileSync(chartPath, 'utf8');
let values = readFileSync(valuesPath, 'utf8');

const appVersionRe = /^(appVersion:\s*")([^"]+)(")/m;
const imageTagRe = /(^app:\n(?:.*\n)*?\s*image:\n(?:.*\n)*?\s*tag:\s*")([^"]+)(")/m;

const chartMatch = chart.match(appVersionRe);
const valuesMatch = values.match(imageTagRe);

if (!chartMatch) {
  console.error('helm-sync-app-version: could not find appVersion in Chart.yaml');
  process.exit(1);
}
if (!valuesMatch) {
  console.error('helm-sync-app-version: could not find app.image.tag in values.yaml');
  process.exit(1);
}

const currentAppVersion = chartMatch[2];
const currentTag = valuesMatch[2];

if (currentAppVersion === version && currentTag === version) {
  console.log(`helm-sync-app-version: already at ${version}`);
  process.exit(0);
}

if (checkMode) {
  const mismatches = [];
  if (currentAppVersion !== version) mismatches.push(`Chart.yaml appVersion=${currentAppVersion}`);
  if (currentTag !== version) mismatches.push(`values.yaml tag=${currentTag}`);
  console.error(`helm-sync-app-version --check: out of sync (package.json=${version}, ${mismatches.join(', ')})`);
  process.exit(1);
}

chart = chart.replace(appVersionRe, `$1${version}$3`);
values = values.replace(imageTagRe, `$1${version}$3`);

writeFileSync(chartPath, chart);
writeFileSync(valuesPath, values);

console.log(`helm-sync-app-version: synced to ${version}`);
