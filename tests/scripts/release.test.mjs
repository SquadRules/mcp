import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import config, { commitOptions, releaseGitAssets } from '../../release.config.mjs';
import { prepare as retargetReleaseHead } from '../../scripts/semantic-release-source-head.mjs';

const analyze = messages => analyzeCommits(commitOptions, {
  cwd: process.cwd(), commits: messages.map(message => ({ message, hash: 'a'.repeat(40) })), logger: { log() {} },
});

for (const [name, messages, expected] of [
  ['dependency patch', ['fix(deps): bump react'], 'patch'],
  ['historical dependency patch', ['chore(deps): bump react', 'deps(actions): update action'], 'patch'],
  ['feature overrides dependency patch', ['feat: add a capability', 'fix(deps): bump react'], 'minor'],
  ['breaking header overrides dependency patch', ['fix(deps)!: upgrade major API', 'fix: patch'], 'major'],
  ['breaking footer overrides feature', ['feat: add feature\n\nBREAKING CHANGE: old format removed'], 'major'],
  ['housekeeping no-release', ['chore: clean workspace', 'docs: describe setup'], null],
]) {
  test(name, async () => assert.equal(await analyze(messages), expected));
}

test('release notes preserve the same breaking-header semantics as version analysis', async () => {
  const notes = await generateNotes({ preset: 'conventionalcommits' }, {
    cwd: process.cwd(), commits: [{ hash: 'a'.repeat(40), message: 'fix(deps)!: remove obsolete API' }],
    lastRelease: { gitTag: 'v4.0.0' }, nextRelease: { version: '5.0.0', gitTag: 'v5.0.0' },
    options: { repositoryUrl: 'https://github.com/owner/repo.git' },
  });
  assert.match(notes, /BREAKING CHANGES/);
  assert.match(notes, /remove obsolete API/);
});


test('release persists the versioned repository state before publishing', () => {
  const pluginName = plugin => Array.isArray(plugin) ? plugin[0] : plugin;
  const pluginNames = config.plugins.map(pluginName);
  assert.deepEqual(pluginNames, [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/npm',
    '@semantic-release/exec',
    '@semantic-release/git',
    './scripts/semantic-release-source-head.mjs',
    '@semantic-release/github',
  ]);

  const exec = config.plugins.find(plugin => pluginName(plugin) === '@semantic-release/exec')[1];
  assert.match(exec.prepareCmd, /npm run version:sync/);
  assert.match(exec.prepareCmd, /npm run release:verify-version/);

  for (const required of [
    'package.json',
    'package-lock.json',
    'compose.yaml',
    'src/embed-docs/mem/*.md',
    'src/resources/embedded-mcp-resources.ts',
  ]) {
    assert.ok(releaseGitAssets.includes(required));
  }

  const git = config.plugins.find(plugin => pluginName(plugin) === '@semantic-release/git')[1];
  assert.match(git.message, /\[skip ci\]/);
});

test('release tag is retargeted to the persisted source commit', async () => {
  const context = {
    cwd: process.cwd(),
    env: process.env,
    nextRelease: { gitHead: '0'.repeat(40) },
    logger: { log() {} },
  };
  await retargetReleaseHead({}, context);
  const expected = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(context.nextRelease.gitHead, expected);
});
