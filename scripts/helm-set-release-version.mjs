#!/usr/bin/env node
// NOTE: This script moves to SquadRules/charts repository. Kept temporarily for transition.
/**
 * Sets helm/kairos-mcp/Chart.yaml `version` + `appVersion` and
 * helm/kairos-mcp/values.yaml default `app.image.tag` to the exact release
 * version emitted by semantic-release (prereleases included).
 *
 * Used only by the Release workflow's publish-helm job: the chart's release
 * identity derives from the single semantic-release version instead of an
 * independently bumped chart version. For in-repo
 * baseline maintenance use scripts/helm-sync-app-version.mjs instead.
 *
 * Usage: node scripts/helm-set-release-version.mjs <version>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const chartPath = resolve(root, 'helm/kairos-mcp/Chart.yaml');
const valuesPath = resolve(root, 'helm/kairos-mcp/values.yaml');

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: helm-set-release-version.mjs <semver-version> (e.g. 4.9.0 or 4.9.0-beta.1)');
  process.exit(1);
}

const chartVersionRe = /^(version:\s*)(\S+)(\s*)$/m;
const appVersionRe = /^(appVersion:\s*")([^"]+)(")/m;
const imageTagRe = /(^app:\n(?:.*\n)*?\s*image:\n(?:.*\n)*?\s*tag:\s*")([^"]+)(")/m;

let chart = readFileSync(chartPath, 'utf8');
let values = readFileSync(valuesPath, 'utf8');

const chartVersionMatch = chart.match(chartVersionRe);
const appVersionMatch = chart.match(appVersionRe);
const valuesMatch = values.match(imageTagRe);

if (!chartVersionMatch) {
  console.error('helm-set-release-version: could not find version in Chart.yaml');
  process.exit(1);
}
if (!appVersionMatch) {
  console.error('helm-set-release-version: could not find appVersion in Chart.yaml');
  process.exit(1);
}
if (!valuesMatch) {
  console.error('helm-set-release-version: could not find app.image.tag in values.yaml');
  process.exit(1);
}

chart = chart.replace(chartVersionRe, `$1${version}$3`);
chart = chart.replace(appVersionRe, `$1${version}$3`);
values = values.replace(imageTagRe, `$1${version}$3`);

writeFileSync(chartPath, chart);
writeFileSync(valuesPath, values);

console.log(`helm-set-release-version: chart version/appVersion and image tag set to ${version}`);
