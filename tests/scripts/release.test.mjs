import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
  assert.equal(manifest['.'], '5.1.0');
});

test('release workflow never mutates protected main directly', () => {
  const text = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.doesNotMatch(text, /semantic-release/);
  assert.doesNotMatch(text, /git push[^\n]*(HEAD:main|refs\/heads\/main|\bmain\b)/);
  assert.match(text, /googleapis\/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071/);
  assert.match(text, /token:\s*\$\{\{ secrets\.GH_PAT \}\}/);
});

test('Release Please PR is synchronized before normal PR checks gate its merge', () => {
  const sync = workflow.jobs['sync-release-pr'];
  assert.equal(sync.needs, 'release-please');
  const checkout = sync.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.token, '${{ secrets.GH_PAT }}');
  const step = sync.steps.find(step => step.name === 'Synchronize version-derived source on the Release PR');
  assert.match(step.run, /npm run version:sync/);
  assert.match(step.run, /build-embed-docs\.ts/);
  assert.match(step.run, /release:verify-version/);
  assert.match(step.run, /git push origin "HEAD:\$RELEASE_BRANCH"/);
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
  assert.match(npmPublish.run, /npm publish "artifacts\/squadrules-mcp-\$VERSION\.tgz"/);
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
