import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { load } from 'js-yaml';

const config = load(readFileSync('.github/dependabot.yml', 'utf8'));
const get = (ecosystem) => config.updates.find((update) => update['package-ecosystem'] === ecosystem);

test('Dependabot creates version update PRs for npm and GitHub Actions', () => {
  assert.equal(config.version, 2);
  for (const ecosystem of ['npm', 'github-actions']) {
    const update = get(ecosystem);
    assert.ok(update, `missing ${ecosystem} updates`);
    assert.equal(update.directory, '/');
    assert.equal(update.schedule.interval, 'daily');
    assert.ok(update['open-pull-requests-limit'] > 0, `${ecosystem} version updates disabled`);
    assert.equal(update['commit-message'].prefix, 'fix(deps)');
    assert.ok(!update.labels, 'missing GitHub labels must not block Dependabot updates');
  }
});

test('npm groups security separately from minor/patch version updates', () => {
  const groups = get('npm').groups;
  assert.equal(groups['npm-security']['applies-to'], 'security-updates');
  assert.deepEqual(groups['npm-security'].patterns, ['*']);
  for (const name of ['npm-production-minor-patch', 'npm-development-minor-patch']) {
    assert.equal(groups[name]['applies-to'], 'version-updates');
    assert.deepEqual(groups[name]['update-types'], ['minor', 'patch']);
    assert.deepEqual(groups[name].patterns, ['*']);
  }
  assert.equal(groups['npm-production-minor-patch']['dependency-type'], 'production');
  assert.equal(groups['npm-development-minor-patch']['dependency-type'], 'development');
});

test('CPU-only CI install skips optional ONNX Runtime CUDA download', () => {
  const npmrc = readFileSync('.npmrc', 'utf8');
  assert.match(npmrc, /^onnxruntime-node-install-cuda=skip$/m);
});
