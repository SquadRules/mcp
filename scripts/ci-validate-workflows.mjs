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
// Native GitHub Actions path filtering replaces the classifier job.
// Workflows only run when relevant paths change, preventing empty-diff bypasses.
// Gate shell behavior (including skipped/missing results) is exercised by test:automation.
const requiredPaths = {
  integration: ['src/**', 'tests/**', 'package.json', 'package-lock.json'],
  security: ['src/**', 'package.json', 'package-lock.json'],
};
for (const [config, gateId, required] of [
  [integration, 'integration-pass', ['build', 'verify-integration-cluster', 'verify-integration-single']],
  [security, 'security-pass', ['dependency-review', 'npm-audit', 'codeql']],
]) {
  assert.deepEqual(config.on.pull_request.branches, ['main']);
  assert.ok(Array.isArray(config.on.pull_request.paths), 'Workflows must use native path filtering');
  for (const path of requiredPaths[gateId.replace('-pass', '')]) {
    assert.ok(config.on.pull_request.paths.includes(path), `Missing required path: ${path}`);
  }
  assert.equal(config.on.pull_request['paths-ignore'], undefined);
  assert.ok(!config.on.pull_request.types || config.on.pull_request.types.includes('synchronize'));
  assert.equal(config.jobs.changes, undefined, 'No path classifier may suppress required validation');
  const gate = config.jobs[gateId];
  assert.deepEqual([...gate.needs].sort(), [...required].sort());
  assert.equal(gate.if, 'always()');
  for (const id of [...required, gateId]) {
    const job = config.jobs[id];
    assert.equal(job['continue-on-error'], undefined, `${id} must fail closed`);
    if (id !== gateId && id !== 'dependency-review') assert.equal(job.if, undefined);
    for (const step of job.steps ?? []) assert.equal(step['continue-on-error'], undefined);
  }
  const gateStep = gate.steps.find(s => s.run);
  for (const id of required) {
    assert.ok(Object.values(gateStep.env).includes(`\${{ needs.${id}.result }}`), `${gateId} must check ${id}`);
  }
}
assert.equal(integration.jobs.build.needs, undefined);
assert.deepEqual(integration.jobs['verify-integration-cluster'].needs, ['build']);
assert.equal(security.jobs.codeql.needs, undefined);
assert.equal(security.jobs['npm-audit'].needs, undefined);
assert.equal(security.jobs['dependency-review'].if, "github.event_name == 'pull_request'");
assert.ok(policy.jobs.policy.steps.some(s => s.run === 'npm run test:automation'));
assert.ok(policy.jobs.policy.steps.some(s => s.run === 'npm run lint:renovate'));
assert.deepEqual(release.on.push.branches, ['main']);
assert.ok(!release.on.workflow_run && !release.on.schedule && !release.on.pull_request);
assert.equal(release.on.workflow_dispatch.inputs.tag.required, true);

const releasePlease = release.jobs['release-please'];
assert.match(releasePlease.if, /github\.event_name == 'push'/);
assert.equal(releasePlease.permissions.contents, 'read');
const releasePleaseStep = releasePlease.steps.find(s => s.uses?.startsWith('googleapis/release-please-action@'));
assert.equal(releasePleaseStep.uses, 'googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071');
assert.equal(releasePleaseStep.with.token, '${{ steps.app-token.outputs.token }}');
assert.equal(releasePleaseStep.with['config-file'], 'release-please-config.json');
assert.equal(releasePleaseStep.with['manifest-file'], '.release-please-manifest.json');

const syncReleasePr = release.jobs['sync-release-pr'];
assert.equal(syncReleasePr.needs, 'release-please');
const syncCheckout = syncReleasePr.steps.find(s => s.uses?.startsWith('actions/checkout@'));
assert.equal(syncCheckout.with.token, '${{ steps.app-token.outputs.token }}');
assert.equal(syncReleasePr.permissions.contents, 'read');
const syncStep = syncReleasePr.steps.find(s => s.name === 'Synchronize version-derived source on the Release PR');
assert.match(syncStep.run ?? '', /npm run version:sync/);
assert.match(syncStep.run ?? '', /build-embed-docs\.ts/);
assert.match(syncStep.run ?? '', /\.qoder\/repowiki/);
assert.match(syncStep.run ?? '', /git push origin "HEAD:\$RELEASE_BRANCH"/);
assert.doesNotMatch(syncStep.run ?? '', /HEAD:main|refs\/heads\/main/);

const validateAuthStep = syncReleasePr.steps.find(s => s.name === 'Validate Qoder CLI authentication');
assert.ok(validateAuthStep, 'Validate Qoder CLI authentication step must exist');
assert.equal(validateAuthStep.env.QODER_PERSONAL_ACCESS_TOKEN, '${{ secrets.QODER_PERSONAL_ACCESS_TOKEN }}');
assert.match(validateAuthStep.run ?? '', /qodercli.*status/);
assert.ok((validateAuthStep.run ?? '').includes('https://qoder.com/account/integrations'));

assert.equal(release.jobs['validate-release-pr'], undefined);
const autoMerge = release.jobs['auto-merge-release-pr'];
assert.deepEqual(autoMerge.needs, ['release-please', 'sync-release-pr']);
assert.equal(syncReleasePr.outputs.head_sha, '${{ steps.sync.outputs.head_sha }}');
for (const job of [releasePlease, syncReleasePr, autoMerge]) {
  const token = job.steps.find(s => s.id === 'app-token');
  assert.equal(token.uses, 'actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349');
  assert.equal(token.with['app-id'], '${{ vars.RELEASE_APP_ID }}');
  assert.equal(token.with['private-key'], '${{ secrets.RELEASE_APP_PRIVATE_KEY }}');
  assert.equal(token.with.repositories, '${{ github.event.repository.name }}');
  assert.equal(token.with['permission-administration'], undefined);
  assert.equal(job.permissions.contents, 'read');
}
const mergeStep = autoMerge.steps.find(s => s.run);
assert.equal(mergeStep.env.GH_TOKEN, '${{ steps.app-token.outputs.token }}');
assert.match(mergeStep.run, /--auto --squash --match-head-commit/);
assert.doesNotMatch(JSON.stringify(release), /gh workflow run|--admin/);
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

const autoMergeDeps = load(readFileSync(`${directory}/auto-merge-deps.yml`, 'utf8'));
assert.ok(autoMergeDeps.on.schedule.some(s => s.cron === '23 */6 * * *'), 'Auto-merge must run every 6 hours');
assert.ok(autoMergeDeps.on.workflow_dispatch?.inputs?.['dry-run'], 'Auto-merge must support dry-run dispatch');
assert.equal(autoMergeDeps.permissions.contents, 'read');
assert.equal(autoMergeDeps.concurrency['cancel-in-progress'], false);
const autoMergeJob = autoMergeDeps.jobs.merge;
assert.match(autoMergeJob.if, /AUTOMATION_ENABLED/);
const autoMergeCheckout = autoMergeJob.steps.find(s => s.uses?.startsWith('actions/checkout@'));
assert.equal(autoMergeCheckout.with.ref, 'refs/heads/main');
assert.equal(autoMergeCheckout.with['persist-credentials'], false);
const autoMergeStep = autoMergeJob.steps.find(s => s.run?.includes('ci-automation.mjs'));
assert.ok(autoMergeStep, 'Auto-merge must invoke ci-automation.mjs');
assert.equal(autoMergeStep.env.GH_TOKEN, '${{ secrets.GH_PAT }}');
assert.doesNotMatch(JSON.stringify(autoMergeDeps), /git push|npm audit fix/);

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

// Docs bot workflow: regenerates Qoder wiki and opens docs-typed PRs.
const docs = load(readFileSync('.github/workflows/docs.yml', 'utf8'));
assert.equal(docs.name, 'Docs wiki regeneration');
assert.ok(docs.on.schedule?.some(s => s.cron === '17 4 * * *'), 'docs.yml must run daily at 04:17 UTC');
assert.ok(docs.on.push?.paths?.includes('src/**'), 'docs.yml must trigger on src/** changes');
assert.ok('workflow_dispatch' in docs.on, 'docs.yml must support manual trigger');
assert.ok(docs.jobs['regenerate-wiki'], 'docs.yml must have regenerate-wiki job');
assert.ok(docs.jobs['regenerate-wiki'].steps.some(s => s.uses?.startsWith('actions/create-github-app-token@')), 'docs.yml must create GitHub App token');
assert.ok(docs.jobs['regenerate-wiki'].steps.some(s => s.env?.QODER_PERSONAL_ACCESS_TOKEN), 'docs.yml must use QODER_PERSONAL_ACCESS_TOKEN');
assert.ok(docs.jobs['regenerate-wiki'].steps.some(s => s.id === 'changes'), 'docs.yml must check for changes');
assert.ok(docs.jobs['auto-merge'], 'docs.yml must have auto-merge job');

console.log('Workflow, privilege-boundary, release-order and producer policy validation passed.');
