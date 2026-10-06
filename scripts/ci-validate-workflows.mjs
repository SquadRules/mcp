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
// Two integration lanes and no more (docs/adr/0006): cluster mode (Docker fullstack, AUTH on) and
// single mode (service-free embedded LanceDB, AUTH off, HTTP + stdio). Both run the FULL suite and
// both gate the merge; neither may reach an external embedding provider (docs/adr/0004).
assert.ok(!Object.hasOwn(integration.on.workflow_call ?? {}, 'secrets'), 'Integration workflow takes no secrets');
assert.doesNotMatch(JSON.stringify(integration), /secrets\.OPENAI_API_KEY/);
const clusterLane = integration.jobs['verify-integration-cluster'];
const singleLane = integration.jobs['verify-integration-single'];
assert.ok(
  clusterLane.steps.some(step => step.run === 'npm run dev:test -- tests/unit'),
  'Cluster lane runs the unit suite against the deployed stack'
);
for (const [name, job] of [['verify-integration-cluster', clusterLane], ['verify-integration-single', singleLane]]) {
  assert.deepEqual(job.needs, ['build'], `${name} consumes the build matrix artifact`);
  assert.notEqual(job['continue-on-error'], true, `${name} is a merge gate, not an advisory lane`);
  assert.ok(
    job.steps.some(step => /EMBEDDING_PROVIDER=fastembed/.test(step.run ?? '')),
    `${name} pins the key-free local embedding default`
  );
}
assert.deepEqual(
  integration.jobs['integration-pass'].needs,
  ['build', 'verify-integration-cluster', 'verify-integration-single'],
  'Merge gate requires both integration lanes'
);
assert.ok(
  singleLane.steps.some(step => (step.run ?? '').includes("'s|^QDRANT_URL=.*|QDRANT_URL=|'")),
  'Single lane blanks QDRANT_URL so the server and the tests run the embedded backend'
);
for (const run of ['npm run dev_simple:test', 'npm run dev_stdio:test']) {
  assert.ok(
    singleLane.steps.some(step => step.run === run),
    `Single lane runs the full suite over both transports (${run})`
  );
}
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
// `prepare: husky` installs this repository's tag-blocking pre-push hook into the publisher's own
// checkout on `npm ci` and again on the `npm pack` inside semantic-release, so a pre-step
// `git config core.hooksPath` is rewritten before the tag push. Only command-line git config
// (GIT_CONFIG_*, which outranks the file) survives. HUSKY=0 is worse: husky then writes
// "HUSKY=0 skip install" to stdout and @semantic-release/npm reads npm pack stdout as the tarball
// name, so the release fails before the push.
const publishSteps = release.jobs.publish.steps;
assert.ok(!JSON.stringify(release.jobs.publish).includes('HUSKY'), 'Publisher must not use HUSKY: it leaks into npm pack stdout');
assert.ok(!publishSteps.some(s => /core\.hooksPath/.test(s.run ?? '')), 'A pre-step core.hooksPath change is undone by npm pack; override it on the release step env');
const releaseStep = publishSteps.find(s => /npm run release/.test(s.run ?? ''));
assert.ok(releaseStep, 'Publisher must run semantic-release');
assert.equal(releaseStep.env?.GIT_CONFIG_COUNT, '1', 'Release step must supply git config through the environment');
assert.equal(releaseStep.env?.GIT_CONFIG_KEY_0, 'core.hooksPath', 'Release step must override core.hooksPath so the tag push skips husky');
assert.match(String(releaseStep.env?.GIT_CONFIG_VALUE_0 ?? ''), /\.git\/hooks$/, 'core.hooksPath override must point at the stock empty hook directory');
assert.match(release.jobs.publish.if, /github.ref == 'refs\/heads\/main'/);
assert.equal(release.jobs.publish.steps[0].with.ref, '${{ github.sha }}');
assert.equal(release.jobs.publish.steps[0].with['fetch-depth'], 0);
assert.equal(release.concurrency['cancel-in-progress'], false);
assert.doesNotMatch(JSON.stringify(release), /NPM_TOKEN|NODE_AUTH_TOKEN|GH_PAT|repository_dispatch|OPENAI_API_KEY/);
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
