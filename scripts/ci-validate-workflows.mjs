import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

const directory = '.github/workflows';
const workflow = name => load(readFileSync(`${directory}/${name}.yml`, 'utf8'));
const integration = workflow('integration');
const security = workflow('security');
const policy = workflow('automation-policy');
const release = workflow('release');

for (const config of [integration, security, policy]) {
  assert.ok(Object.hasOwn(config.on, 'pull_request') && Object.hasOwn(config.on, 'workflow_call') && Object.hasOwn(config.on, 'merge_group'));
  assert.ok(!Object.hasOwn(config.on, 'push'), 'Main validation is called once by Release');
  for (const job of Object.values(config.jobs)) {
    assert.notEqual(job.permissions?.contents, 'write', 'Validation must not write repository contents');
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.equal(step.with?.ref, '${{ github.sha }}', 'Tests consume the immutable event revision');
        assert.equal(step.with?.['persist-credentials'], false);
      }
      assert.doesNotMatch(JSON.stringify(step), /secrets\.(GH_PAT|NPM_TOKEN|DOCKER_PASSWORD|QUAY_PASSWORD)/);
      assert.doesNotMatch(step.run ?? '', /git push|--force-with-lease|gh pr merge|npm audit fix/);
    }
  }
}
assert.ok(security.jobs['security-pass'].needs.includes('dependency-review'));
assert.notEqual(security.jobs['dependency-review']['continue-on-error'], true);
for (const script of ['lint', 'typecheck', 'knip', 'test:ui', 'build:tgz', 'test:tgz']) {
  assert.ok(integration.jobs.build.steps.some(s => s.run === `npm run ${script}`));
}
assert.deepEqual(integration.jobs.build.strategy.matrix.node, ['24', '26']);
assert.ok(integration.jobs['verify-integration-primary'].steps.some(s => s.run === 'npm run dev:test -- tests/unit'));
const embedded = integration.jobs['verify-integration-embedded-simple'];
assert.deepEqual(embedded.needs, ['build'], 'Service-free lane consumes the build matrix artifact');
assert.equal(embedded['continue-on-error'], true, 'Service-free lane is advisory until proven stable');
assert.ok(!integration.jobs['integration-pass'].needs.includes('verify-integration-embedded-simple'));
assert.ok(embedded.steps.some(s => /EMBEDDING_PROVIDER=fastembed/.test(s.run ?? '')), 'Service-free lane pins the key-free local embedding default');
assert.ok(policy.jobs.policy.steps.some(s => s.run === 'npm run test:automation'));
assert.ok(policy.jobs.policy.steps.some(s => s.run === 'npm run lint:renovate'));
assert.deepEqual(release.on.push.branches, ['main']);
assert.ok(!release.on.workflow_run && !release.on.schedule && !release.on.pull_request);
assert.equal(release.on.workflow_dispatch.inputs['dry-run'].default, true);
assert.deepEqual(release.jobs.publish.needs, ['integration', 'security', 'policy']);
for (const [job, file] of [['integration', 'integration'], ['security', 'security'], ['policy', 'automation-policy']]) {
  assert.equal(release.jobs[job].uses, `./.github/workflows/${file}.yml`);
}
assert.equal(release.jobs.publish.environment, 'release');
assert.equal(release.jobs.publish.permissions['id-token'], 'write');
// npm ci installs husky hooks into the runner workspace; without this the guarded
// pre-push hook rejects semantic-release's own `git push --tags` and the publish fails.
assert.equal(release.jobs.publish.env?.HUSKY, '0', 'Publisher must bypass husky hooks to push the release tag');
assert.match(release.jobs.publish.if, /github.ref == 'refs\/heads\/main'/);
assert.equal(release.jobs.publish.steps[0].with.ref, '${{ github.sha }}');
assert.equal(release.jobs.publish.steps[0].with['fetch-depth'], 0);
assert.equal(release.concurrency['cancel-in-progress'], false);
assert.doesNotMatch(JSON.stringify(release), /NPM_TOKEN|NODE_AUTH_TOKEN|GH_PAT|repository_dispatch/);
const { default: config } = await import('../release.config.mjs');
assert.deepEqual(config.branches, ['main']);
assert.deepEqual(config.plugins.map(p => p[0]), [
  '@semantic-release/commit-analyzer', '@semantic-release/release-notes-generator',
  '@semantic-release/npm', '@semantic-release/exec', '@semantic-release/github',
]);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(pkg.scripts.publish, undefined, 'Avoid npm publish lifecycle recursion');
assert.equal(pkg.scripts.prepack, 'npm run build');
assert.equal(pkg.publishConfig.provenance, true);
const dependabot = load(readFileSync('.github/dependabot.yml', 'utf8'));
assert.equal(dependabot.updates.length, 2);
assert.ok(dependabot.updates.every(u => u['open-pull-requests-limit'] === 0));
const renovate = JSON.parse(readFileSync('renovate.json', 'utf8'));
assert.equal(renovate.enabled, false, 'Hosted execution stays disabled');
assert.equal(renovate.automerge, false);
assert.equal(renovate.osvVulnerabilityAlerts, false);
assert.equal(renovate.vulnerabilityAlerts.enabled, false);

if (spawnSync('shellcheck', ['--version'], { stdio: 'ignore' }).status !== 0) {
  throw new Error('ShellCheck is required for complete workflow validation');
}
const files = readdirSync(directory).filter(file => /\.ya?ml$/.test(file)).map(file => `${directory}/${file}`);
const result = spawnSync('go', ['run', 'github.com/rhysd/actionlint/cmd/actionlint@v1.7.7', '-color', ...files], {
  stdio: 'inherit', env: { ...process.env, GO111MODULE: 'on' },
});
if (result.status !== 0) throw new Error('actionlint failed');
for (const file of ['scripts/npm-audit-fix.sh', 'tests/scripts/npm-audit-fix.test.sh']) {
  if (spawnSync('bash', ['-n', file], { stdio: 'inherit' }).status !== 0) throw new Error(`Shell syntax failed: ${file}`);
}
console.log('Workflow, privilege-boundary, release-order and producer policy validation passed.');
