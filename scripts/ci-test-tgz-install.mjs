#!/usr/bin/env node
/** Exercise the packed consumer install outside the repository's dependency tree. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tgzPath = join(root, 'artifacts', `squadrules-mcp-${pkg.version}.tgz`);
assert.ok(existsSync(tgzPath), "Run 'npm run build:tgz' first.");
const testDir = mkdtempSync(join(tmpdir(), 'squadrules-tgz-install-'));
const appDir = mkdtempSync(join(tmpdir(), 'squadrules-root-install-'));


function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: testDir, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.error ?? result.status}`);
  return result.stdout?.trim();
}

try {
  run('npm', ['init', '-y']);
  run('npm', ['install', '--no-audit', '--no-fund', tgzPath]);
  const installedRoot = join(testDir, 'node_modules', pkg.name);
  const installed = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(installed.version, pkg.version);
  assert.equal(installed.name, pkg.name);
  for (const file of [pkg.main, 'dist/ui/index.html', 'dist/embed-docs/mem', 'LICENSE', 'README.md']) {
    assert.ok(existsSync(join(installedRoot, file)), `Missing packaged resource: ${file}`);
  }
  for (const bin of Object.keys(pkg.bin)) {
    const executable = join(testDir, 'node_modules', '.bin', bin);
    assert.equal(run(executable, ['--version'], true), pkg.version, `${bin} version differs from package`);
    run(executable, ['serve', '--help']);
  }
  // The container extracts the published tarball as the application root.
  // Unlike a dependency install, that root honors the published overrides.
  const extract = spawnSync('tar', ['-xzf', tgzPath, '--strip-components=1', '-C', appDir], { stdio: 'inherit' });
  assert.equal(extract.status, 0, 'Could not extract published package');
  const publishedLock = join(appDir, 'dist', 'runtime-lock.json');
  assert.ok(existsSync(publishedLock), 'Published package lacks dist/runtime-lock.json');
  copyFileSync(publishedLock, join(appDir, 'package-lock.json'));
  function rootRun(args) {
    const result = spawnSync('npm', args, { cwd: appDir, stdio: 'inherit' });
    assert.equal(result.status, 0, `npm ${args.join(' ')} failed in package-root installation`);
  }
  rootRun(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  // This verifies production dependencies and does not build a Docker image.
  rootRun(['audit', '--omit=dev', '--audit-level=high']);
  assert.equal(JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).version, pkg.version);
} finally {
  rmSync(testDir, { recursive: true, force: true });
  rmSync(appDir, { recursive: true, force: true });
}
console.log('Packed dependency install and locked application-root install passed.');
