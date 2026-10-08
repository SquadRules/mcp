#!/usr/bin/env node
/**
 * Verify that the committed Release Please source tree is internally version
 * consistent before npm publication. The Release PR must already contain the
 * package/lock version and synchronized version-derived source.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
const builtinDir = 'src/embed-docs/mem';
for (const name of readdirSync(builtinDir).filter(name => name.endsWith('.md') && name.toLowerCase() !== 'readme.md')) {
  const source = readFileSync(`${builtinDir}/${name}`, 'utf8');
  const versionMatch = source.match(/^version:\s*["']?([^"'\s]+)["']?\s*$/m);
  if (!versionMatch) {
    fail(`${builtinDir}/${name} is a shipped built-in adapter without frontmatter version`);
  }
  if (versionMatch[1] !== expected) {
    fail(`${builtinDir}/${name} is v${versionMatch[1]}, expected ${expected}`);
  }

  // build-embed-docs.ts serializes each meta adapter as a JSON string value.
  // Verify the generated source contains the exact release-stamped markdown,
  // not merely one matching version string somewhere in the generated file.
  if (!embedded.includes(JSON.stringify(source))) {
    fail(`generated embedded resources do not contain exact built-in adapter ${name}`);
  }
}

console.log(`Release source version invariant verified: ${expected}`);
