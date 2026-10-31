#!/usr/bin/env node
/**
 * Package the tested root resolution for application-style installs (OCI images).
 *
 * npm does not publish package-lock.json, and dependency overrides are ignored
 * when @squadrules/mcp is installed beneath another npm root. The image extracts
 * this package as its root and restores the lock before running npm ci.
 *
 * Keep this in dist/ so npm's "files" allowlist includes it automatically.
 */
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
assert.equal(lock.name, manifest.name);
assert.equal(lock.version, manifest.version);
assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
const dest = join(root, 'dist', 'runtime-lock.json');
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(join(root, 'package-lock.json'), dest);
console.log('Staged npm runtime lock for published application-root installs.');
