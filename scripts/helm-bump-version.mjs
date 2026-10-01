#!/usr/bin/env node
// NOTE: This script moves to SquadRules/charts repository. Kept temporarily for transition.
/**
 * Bumps helm/kairos-mcp/Chart.yaml `version` field.
 *
 * Usage: node scripts/helm-bump-version.mjs <minor|patch> [--dry-run]
 *
 * The bump is idempotent: if the current chart version is already greater than
 * the base version on main (provided via CHART_VERSION_BASE env or read from
 * git), the script exits 0 without changes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const chartPath = resolve(root, 'helm/kairos-mcp/Chart.yaml');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');
const bumpType = args[0];

if (!bumpType || !['minor', 'patch'].includes(bumpType)) {
  console.error('Usage: helm-bump-version.mjs <minor|patch> [--dry-run]');
  process.exit(1);
}

function parseSemver(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function bump(ver, type) {
  if (type === 'minor') return { major: ver.major, minor: ver.minor + 1, patch: 0 };
  return { major: ver.major, minor: ver.minor, patch: ver.patch + 1 };
}

function toString(ver) {
  return `${ver.major}.${ver.minor}.${ver.patch}`;
}

const chart = readFileSync(chartPath, 'utf8');
const versionRe = /^(version:\s*)(\S+)/m;
const match = chart.match(versionRe);
if (!match) {
  console.error('helm-bump-version: cannot find version field in Chart.yaml');
  process.exit(1);
}

const currentStr = match[2];
const current = parseSemver(currentStr);
if (!current) {
  console.error(`helm-bump-version: cannot parse current version "${currentStr}"`);
  process.exit(1);
}

let baseStr = process.env.CHART_VERSION_BASE;
if (!baseStr) {
  try {
    baseStr = execSync('git show origin/main:helm/kairos-mcp/Chart.yaml', { encoding: 'utf8' })
      .match(versionRe)?.[2];
  } catch {
    baseStr = null;
  }
}
if (!baseStr) {
  console.log('helm-bump-version: no base version from main; treating current as base');
  baseStr = currentStr;
}

const base = parseSemver(baseStr);
if (!base) {
  console.error(`helm-bump-version: cannot parse base version "${baseStr}"`);
  process.exit(1);
}

const target = bump(base, bumpType);

if (compareSemver(current, target) >= 0) {
  console.log(`helm-bump-version: already at ${currentStr} (>= target ${toString(target)}), no change`);
  process.exit(0);
}

const newChart = chart.replace(versionRe, `$1${toString(target)}`);

if (dryRun) {
  console.log(`helm-bump-version: would bump ${currentStr} -> ${toString(target)} (${bumpType})`);
  process.exit(0);
}

writeFileSync(chartPath, newChart);
console.log(`helm-bump-version: ${currentStr} -> ${toString(target)} (${bumpType})`);
