import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { prepare } from '../../scripts/semantic-release-persist-source.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'squadrules-release-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'source');
  const remote = join(root, 'remote.git');
  mkdirSync(cwd);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Release test', GIT_AUTHOR_EMAIL: 'release-test@example.com',
    GIT_COMMITTER_NAME: 'Release test', GIT_COMMITTER_EMAIL: 'release-test@example.com',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null',
  };
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  const write = (path, content) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  git('init', '-b', 'main');
  git('init', '--bare', remote);
  write('.agents/skills/squadrules/SKILL.md', 'version: 5.1.0\n');
  write('package.json', '{"version":"5.1.0"}\n');
  write('README.md', 'Unchanged documentation\n');
  git('add', '.');
  git('commit', '-m', 'Initial source');
  git('push', remote, 'HEAD:main');
  const initialHead = git('rev-parse', 'HEAD');
  const context = {
    cwd, env, branch: { name: 'main' },
    nextRelease: { version: '5.1.1', gitHead: initialHead },
    options: { repositoryUrl: remote }, logger: { log() {} },
  };
  return { git, write, context, initialHead, remote };
}

test('release prepare preserves an unstaged leading dot and pushes the versioned source', async t => {
  const { git, write, context, initialHead, remote } = fixture(t);
  write('.agents/skills/squadrules/SKILL.md', 'version: 5.1.1\n');
  write('package.json', '{"version":"5.1.1"}\n');
  assert.ok(git('status', '--porcelain=v1').startsWith(' M .agents/'));

  await prepare({}, context);

  const head = git('rev-parse', 'HEAD');
  assert.notEqual(head, initialHead);
  assert.equal(context.nextRelease.gitHead, head);
  assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/heads/main'), head);
  assert.equal(git('log', '-1', '--format=%s'), 'chore(release): 5.1.1 [skip ci]');
  assert.equal(git('show', 'HEAD:.agents/skills/squadrules/SKILL.md'), 'version: 5.1.1');
  assert.equal(git('show', 'HEAD:package.json'), '{"version":"5.1.1"}');
  assert.equal(git('status', '--porcelain=v1'), '');
});

test('release prepare rejects unexpected paths before committing or pushing', async t => {
  const { git, write, context, initialHead, remote } = fixture(t);
  write('README.md', 'Unexpected change\n');

  await assert.rejects(prepare({}, context), /unexpected tracked files: README\.md/);

  assert.equal(git('rev-parse', 'HEAD'), initialHead);
  assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/heads/main'), initialHead);
  assert.equal(context.nextRelease.gitHead, initialHead);
  assert.equal(git('diff', '--cached', '--name-only'), '');
});
