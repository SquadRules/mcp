#!/usr/bin/env node
/**
 * Verify that the committed Release Please source tree is internally version
 * consistent before npm publication. The Release PR must already contain the
 * package/lock version and synchronized version-derived source.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const expected = process.argv[2];

function fail(message) {
  console.error(`Release version invariant failed: ${message}`);
  process.exit(1);
}

if (!expected || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expected)) {
  fail(`expected a SemVer argument, got ${JSON.stringify(expected)}`);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

if (pkg.version !== expected) {
  fail(`package.json is ${pkg.version}, expected ${expected}`);
}
if (lock.version !== expected) {
  fail(`package-lock.json root version is ${lock.version}, expected ${expected}`);
}
if (lock.packages?.['']?.version !== expected) {
  fail(`package-lock.json workspace version is ${lock.packages?.['']?.version}, expected ${expected}`);
}

const syncCheck = spawnSync(process.execPath, ['scripts/build-sync-skill-versions.mjs', '--check'], {
  stdio: 'inherit',
});
if (syncCheck.status !== 0) {
  fail('versioned skills or embedded source docs are not synchronized');
}

if (existsSync('compose.yaml')) {
  const compose = readFileSync('compose.yaml', 'utf8');
  const match = compose.match(/\n\s*app-prod:\s*[\s\S]*?\n\s*image:\s*quay\.io\/squadrules\/mcp:v([^\s#]+)/);
  if (match && match[1] !== expected) {
    fail(`compose.yaml app-prod image is v${match[1]}, expected v${expected}`);
  }
}

const embedded = readFileSync('src/resources/embedded-mcp-resources.ts', 'utf8');
if (!embedded.includes(`version: \\\"${expected}\\\"`)) {
  fail(`generated embedded resources do not contain version ${expected}`);
}

console.log(`Release source version invariant verified: ${expected}`);
