#!/usr/bin/env node
/** Exercise the packed consumer install outside the repository's dependency tree. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tgzPath = join(root, 'artifacts', `squadrules-mcp-${pkg.version}.tgz`);
assert.ok(existsSync(tgzPath), "Run 'npm run build:tgz' first.");
const testDir = mkdtempSync(join(tmpdir(), 'squadrules-tgz-install-'));

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
} finally {
  rmSync(testDir, { recursive: true, force: true });
}
console.log('Packed consumer install, resources, CLI versions and help passed.');
