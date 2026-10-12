import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { load } from 'js-yaml';

const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
const workflow = load(readFileSync('.github/workflows/release.yml', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('Release Please owns committed versions through a protected-main PR', () => {
  assert.equal(config['release-type'], 'node');
  assert.equal(config['include-component-in-tag'], false);
  assert.equal(config['always-update'], true);
  assert.equal(config.packages['.']['release-type'], 'node');
  assert.equal(config.packages['.']['package-name'], '@squadrules/mcp');
  assert.equal(manifest['.'], pkg.version);
});

test('release workflow never mutates protected main directly', () => {
  const text = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.doesNotMatch(text, /semantic-release/);
  assert.doesNotMatch(text, /git push[^\n]*(HEAD:main|refs\/heads\/main|\bmain\b)/);
  assert.match(text, /googleapis\/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071/);
  assert.match(text, /token:\s*\$\{\{ steps\.app-token\.outputs\.token \}\}/);
  assert.doesNotMatch(text, /secrets\.GH_PAT/);
});

test('Release Please PR is synchronized before normal PR checks gate its merge', () => {
  const sync = workflow.jobs['sync-release-pr'];
  assert.equal(sync.needs, 'release-please');
  const checkout = sync.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.token, '${{ steps.app-token.outputs.token }}');
  assert.equal(sync.permissions.contents, 'read');
  const step = sync.steps.find(step => step.name === 'Synchronize version-derived source on the Release PR');
  assert.match(step.run, /npm run version:sync/);
  assert.match(step.run, /build-embed-docs\.ts/);
  assert.match(step.run, /release:verify-version/);
  assert.match(step.run, /git add --force \.agents\/skills src\/embed-docs\/mem src\/resources\/embedded-mcp-resources\.ts/);
  assert.match(step.run, /git push origin "HEAD:\$RELEASE_BRANCH"/);
});

test('release producer and merger use scoped short-lived App tokens, never dispatch substitutes', () => {
  assert.equal(workflow.jobs['validate-release-pr'], undefined);
  for (const name of ['release-please', 'sync-release-pr', 'auto-merge-release-pr']) {
    const job = workflow.jobs[name];
    const token = job.steps.find(step => step.id === 'app-token');
    assert.equal(token.uses, 'actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349');
    assert.equal(token.with['app-id'], '${{ vars.RELEASE_APP_ID }}');
    assert.equal(token.with['private-key'], '${{ secrets.RELEASE_APP_PRIVATE_KEY }}');
    assert.equal(token.with.repositories, '${{ github.event.repository.name }}');
    assert.equal(token.with['permission-contents'], 'write');
    assert.equal(token.with['permission-pull-requests'], name === 'sync-release-pr' ? undefined : 'write');
    assert.equal(token.with['permission-administration'], undefined);
    assert.equal(token.with['skip-token-revoke'], undefined);
    assert.equal(job.permissions.contents, 'read');
  }
  assert.doesNotMatch(JSON.stringify(workflow), /gh workflow run|--admin/);
  assert.deepEqual(workflow.jobs['auto-merge-release-pr'].needs, ['release-please', 'sync-release-pr']);
  assert.equal(workflow.jobs['sync-release-pr'].outputs.head_sha, '${{ steps.sync.outputs.head_sha }}');
});

test('unattended release fails early when App credentials are missing', () => {
  const step = workflow.jobs['release-please'].steps[0];
  for (const [id, key, expected] of [['', '', 1], ['123', '', 1], ['', 'test-key', 1], ['123', 'test-key', 0]]) {
    const result = spawnSync('bash', ['-e', '-c', step.run], {
      encoding: 'utf8', env: { ...process.env, RELEASE_APP_ID: id, RELEASE_APP_PRIVATE_KEY: key },
    });
    assert.equal(result.status, expected);
    assert.doesNotMatch(result.stdout + result.stderr, /test-key/);
  }
});

test('auto-merge is enabled only for the synchronized same-repository release head', () => {
  const step = workflow.jobs['auto-merge-release-pr'].steps.find(step => step.run);
  const dir = mkdtempSync(join(tmpdir(), 'release-automerge-'));
  const sha = 'a'.repeat(40);
  const branch = 'release-please--branches--main--components--mcp';
  const repo = { full_name: 'SquadRules/mcp' };
  const pr = { state: 'open', draft: false, base: { ref: 'main', repo },
    head: { ref: branch, sha, repo }, labels: [{ name: 'autorelease: pending' }] };
  try {
    writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'api') console.log(process.env.PR_JSON);
else require('node:fs').appendFileSync(process.env.MERGE_LOG, JSON.stringify(args) + '\\n');
`, { mode: 0o755 });
    const log = join(dir, 'merge.jsonl');
    for (const [candidate, expected] of [
      [pr, 0],
      [{ ...pr, state: 'closed' }, 1],
      [{ ...pr, draft: true }, 1],
      [{ ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } }, 1],
      [{ ...pr, head: { ...pr.head, repo: { full_name: 'other/mcp' } } }, 1],
      [{ ...pr, base: { ...pr.base, ref: 'other' } }, 1],
      [{ ...pr, labels: [] }, 1],
    ]) {
      rmSync(log, { force: true });
      const result = spawnSync('bash', ['-e', '-c', step.run], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
          GITHUB_REPOSITORY: repo.full_name, RELEASE_PR: '42', RELEASE_BRANCH: branch,
          RELEASE_HEAD: sha, PR_JSON: JSON.stringify(candidate), MERGE_LOG: log },
      });
      assert.equal(result.status, expected, result.stderr);
      if (expected === 0) {
        assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), [
          'pr', 'merge', '42', '--repo', repo.full_name, '--auto', '--squash', '--match-head-commit', sha,
        ]);
      } else {
        assert.throws(() => readFileSync(log), { code: 'ENOENT' });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('npm publication happens only from a Release Please GitHub Release', () => {
  const publish = workflow.jobs.publish;
  assert.equal(publish.environment, 'release');
  assert.equal(publish.permissions['id-token'], 'write');
  assert.match(publish.if, /release_created/);

  const checkout = publish.steps.find(step => step.name === 'Checkout released source');
  assert.equal(checkout.with['persist-credentials'], false);
  const setup = publish.steps.find(step => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(setup.with['node-version'], '26');

  const identity = publish.steps.find(step => step.name === 'Verify released source identity');
  assert.match(identity.run, /gh release view/);
  assert.match(identity.run, /git rev-list -n 1/);
  assert.match(identity.run, /git merge-base --is-ancestor/);

  const npmPublish = publish.steps.find(step => step.name === 'Publish npm package with Trusted Publishing');
  assert.match(npmPublish.run, /npm publish "\.\/artifacts\/squadrules-mcp-\$VERSION\.tgz"/);
  assert.match(npmPublish.run, /--provenance/);

  assert.doesNotMatch(JSON.stringify(publish), /NPM_TOKEN|NODE_AUTH_TOKEN/);
});

test('semantic-release is no longer an application dependency or script', () => {
  assert.equal(pkg.scripts.release, undefined);
  for (const name of [
    'semantic-release',
    '@semantic-release/commit-analyzer',
    '@semantic-release/exec',
    '@semantic-release/release-notes-generator',
    'conventional-changelog-conventionalcommits',
  ]) {
    assert.equal(pkg.devDependencies[name], undefined);
  }
});


test('every shipped built-in adapter is release-versioned', () => {
  const builtinDir = 'src/embed-docs/mem';
  const files = readdirSync(builtinDir)
    .filter(name => name.endsWith('.md') && name.toLowerCase() !== 'readme.md');

  assert.ok(files.length > 0, 'expected at least one shipped built-in adapter');
  for (const name of files) {
    const content = readFileSync(`${builtinDir}/${name}`, 'utf8');
    const match = content.match(/^version:\s*["']?([^"'\s]+)["']?\s*$/m);
    assert.ok(match, `${name} must carry frontmatter version`);
    assert.equal(match[1], pkg.version, `${name} version must equal package.json`);
  }
});
