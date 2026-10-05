import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import { commitOptions } from '../../release.config.mjs';

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
