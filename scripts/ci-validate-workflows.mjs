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
assert.ok(integration.jobs['verify-integration-cluster'].steps.some(s => s.run === 'TRANSPORT_TYPE=http npm test -- tests/unit'));
const single = integration.jobs['verify-integration-single'];
assert.deepEqual(single.needs, ['build'], 'Single lane consumes the build matrix artifact');
assert.equal(single['continue-on-error'], undefined, 'Single lane is required (not advisory)');
assert.ok(integration.jobs['integration-pass'].needs.includes('verify-integration-single'));
assert.ok(single.steps.some(s => s.run === 'npm test -- tests/unit'), 'Single lane runs unit tests under zero-config defaults');
assert.ok(single.steps.some(s => s.run?.includes('spaces-tool.stdio-simple.test.ts')), 'Single lane runs stdio integration test to verify SINGLE mode end-to-end');
assert.ok(policy.jobs.policy.steps.some(s => s.run === 'npm run test:automation'));
assert.ok(policy.jobs.policy.steps.some(s => s.run === 'npm run lint:renovate'));
assert.deepEqual(release.on.push.branches, ['main']);
assert.ok(!release.on.workflow_run && !release.on.schedule && !release.on.pull_request);
assert.equal(release.on.workflow_dispatch.inputs.tag.required, true);

const releasePlease = release.jobs['release-please'];
assert.match(releasePlease.if, /github\.event_name == 'push'/);
assert.equal(releasePlease.permissions.contents, 'write');
assert.equal(releasePlease.permissions['pull-requests'], 'write');
const releasePleaseStep = releasePlease.steps.find(s => s.uses?.startsWith('googleapis/release-please-action@'));
assert.equal(releasePleaseStep.uses, 'googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071');
assert.equal(releasePleaseStep.with.token, '${{ github.token }}');
assert.equal(releasePleaseStep.with['config-file'], 'release-please-config.json');
assert.equal(releasePleaseStep.with['manifest-file'], '.release-please-manifest.json');

const syncReleasePr = release.jobs['sync-release-pr'];
assert.equal(syncReleasePr.needs, 'release-please');
const syncCheckout = syncReleasePr.steps.find(s => s.uses?.startsWith('actions/checkout@'));
assert.equal(syncCheckout.with.token, '${{ github.token }}');
assert.equal(syncReleasePr.permissions.contents, 'write');
const syncStep = syncReleasePr.steps.find(s => s.name === 'Synchronize version-derived source on the Release PR');
assert.match(syncStep.run ?? '', /npm run version:sync/);
assert.match(syncStep.run ?? '', /build-embed-docs\.ts/);
assert.match(syncStep.run ?? '', /git push origin "HEAD:\$RELEASE_BRANCH"/);
assert.doesNotMatch(syncStep.run ?? '', /HEAD:main|refs\/heads\/main/);

const validateReleasePr = release.jobs['validate-release-pr'];
assert.deepEqual(validateReleasePr.needs, ['release-please', 'sync-release-pr']);
assert.equal(validateReleasePr.permissions.actions, 'write');
const dispatchChecks = validateReleasePr.steps.find(s => s.name === 'Dispatch required checks on Release PR head');
assert.match(dispatchChecks.run ?? '', /gh workflow run "\$workflow" --ref "\$RELEASE_BRANCH"/);
for (const workflowName of ['integration.yml', 'security.yml', 'automation-policy.yml']) {
  assert.match(dispatchChecks.run ?? '', new RegExp(workflowName.replace('.', '\\.')));
}
assert.doesNotMatch(JSON.stringify(release), /secrets\.GH_PAT/);

const publish = release.jobs.publish;
assert.equal(publish.environment, 'release');
assert.equal(publish.permissions['id-token'], 'write');
assert.match(publish.if, /release_created/);
const publishCheckout = publish.steps.find(s => s.name === 'Checkout released source');
assert.equal(publishCheckout.with['persist-credentials'], false);
const setupNode = publish.steps.find(s => s.uses?.startsWith('actions/setup-node@'));
assert.equal(setupNode?.with?.['node-version'], '26');
const identityStep = publish.steps.find(s => s.name === 'Verify released source identity');
assert.match(identityStep.run ?? '', /gh release view/);
assert.match(identityStep.run ?? '', /git rev-list -n 1/);
assert.match(identityStep.run ?? '', /git merge-base --is-ancestor/);
const npmPublishStep = publish.steps.find(s => s.name === 'Publish npm package with Trusted Publishing');
assert.match(npmPublishStep.run ?? '', /npm publish "\.\/artifacts\/squadrules-mcp-\$VERSION\.tgz"/);
assert.match(npmPublishStep.run ?? '', /--provenance/);
assert.equal(release.concurrency['cancel-in-progress'], false);
assert.doesNotMatch(JSON.stringify(release), /NPM_TOKEN|NODE_AUTH_TOKEN|repository_dispatch|semantic-release/);
assert.doesNotMatch(JSON.stringify(release), /git push[^\n]*(HEAD:main|refs\/heads\/main)/);

const releasePleaseConfig = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
const releasePleaseManifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
assert.equal(releasePleaseConfig['release-type'], 'node');
assert.equal(releasePleaseConfig['include-component-in-tag'], false);
assert.equal(releasePleaseConfig.packages['.']['package-name'], '@squadrules/mcp');
const releasePackage = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(releasePleaseManifest['.'], releasePackage.version);

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
