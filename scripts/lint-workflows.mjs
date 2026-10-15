#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (spawnSync('shellcheck', ['--version'], { stdio: 'ignore' }).status !== 0) {
  throw new Error('ShellCheck is required for workflow validation');
}

const directory = '.github/workflows';
const files = readdirSync(directory).filter(file => /\.ya?ml$/.test(file)).map(file => `${directory}/${file}`);
const result = spawnSync('go', ['run', 'github.com/rhysd/actionlint/cmd/actionlint@v1.7.7', '-color', ...files], {
  stdio: 'inherit', env: { ...process.env, GO111MODULE: 'on' },
});
if (result.status !== 0) throw new Error('actionlint failed');

for (const file of ['scripts/npm-audit-fix.sh', 'tests/scripts/npm-audit-fix.test.sh']) {
  if (spawnSync('bash', ['-n', file], { stdio: 'inherit' }).status !== 0) {
    throw new Error(`Shell syntax failed: ${file}`);
  }
}

console.log('Workflow syntax validation passed.');
