import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHub, verifyIdentity } from './ci-automation.mjs';

// Execution and strict validation deliberately share one pinned distribution.
const version = '44.109.1';
const validate = process.argv[2] === 'validate';
if (!validate) {
  if (process.env.DRY_RUN !== 'true' && process.env.AUTOMATION_ENABLED !== 'true') throw new Error('Automation is disabled');
  const api = new GitHub();
  await verifyIdentity(api);
}
const env = { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: 'true' };
const directory = mkdtempSync(join(tmpdir(), 'kairos-renovate-'));
if (!validate) {
  const config = JSON.parse(readFileSync('renovate.json', 'utf8'));
  writeFileSync(join(directory, 'config.json'), JSON.stringify({ ...config, enabled: true }));
  Object.assign(env, {
    RENOVATE_CONFIG_FILE: join(directory, 'config.json'),
    RENOVATE_TOKEN: process.env.GH_TOKEN,
    RENOVATE_PLATFORM: 'github',
    RENOVATE_AUTODISCOVER: 'false',
    RENOVATE_REPOSITORIES: process.env.GITHUB_REPOSITORY,
    RENOVATE_ONBOARDING: 'false',
    RENOVATE_REQUIRE_CONFIG: 'ignored',
    RENOVATE_INHERIT_CONFIG: 'false',
    RENOVATE_ALLOW_SCRIPTS: 'false',
    RENOVATE_ALLOW_PLUGINS: 'false',
    RENOVATE_ALLOWED_COMMANDS: '[]',
    RENOVATE_ALLOWED_ENV: '[]',
    RENOVATE_EXPOSE_ALL_ENV: 'false',
    RENOVATE_FORCE: JSON.stringify({ branchPrefix: 'automation/renovate/',
      baseBranchPatterns: ['main'], automerge: false, platformAutomerge: false, ignoreScripts: true }),
    RENOVATE_DRY_RUN: process.env.DRY_RUN === 'true' ? 'full' : '',
    LOG_LEVEL: 'debug',
  });
  delete env.GH_TOKEN;
}
const args = ['exec', '--yes', `--package=renovate@${version}`, '--',
  ...(validate ? ['renovate-config-validator', '--strict', '--no-global', 'renovate.json'] : ['renovate'])];
try {
  const result = spawnSync('npm', args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
