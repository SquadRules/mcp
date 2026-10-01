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
  assert.ok(Object.hasOwn(config.on, 'pull_request') && Object.hasOwn(config.on, 'push') && Object.hasOwn(config.on, 'merge_group'));
  for (const [jobName, job] of Object.entries(config.jobs)) {
    // Security workflow's auto-remediation jobs (npm-audit, container-base-os-trivy) are allowed to write
    const isSecurityAutoRemediation = config === security && ['npm-audit', 'container-base-os-trivy'].includes(jobName);
    
    if (!isSecurityAutoRemediation) {
      assert.notEqual(job.permissions?.contents, 'write', 'PR tests must not write repository contents');
    }
    
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.equal(step.with?.ref, '${{ github.sha }}', 'All tests must consume the immutable event revision');
        // Security auto-remediation jobs need credentials for pushing fixes
        if (!isSecurityAutoRemediation) {
          assert.equal(step.with?.['persist-credentials'], false, 'Do not persist tokens in PR build workspaces');
        }
      }
      assert.doesNotMatch(JSON.stringify(step), /secrets\.(GH_PAT|DOCKER_PASSWORD|QUAY_PASSWORD)/, 'Publishing credentials must not reach tests');
      // Security auto-remediation jobs are allowed to push fixes
      if (!isSecurityAutoRemediation) {
        assert.doesNotMatch(step.run ?? '', /git push|--force-with-lease|gh pr merge/, 'Tests must never mutate PRs');
      }
    }
  }
}
assert.ok(security.jobs['security-pass'].needs.includes('dependency-review'));
assert.notEqual(security.jobs['dependency-review']['continue-on-error'], true);
assert.ok(integration.jobs['verify-ui-primary'].steps.some(s => /npm run lint\b/.test(s.run ?? '')));
assert.match(integration.jobs.changes.steps.find(s => s.id === 'combine').run, /\[ "\$EVENT_NAME" = "push" \]/);
assert.ok(policy.jobs.policy.steps.some(s => s.run === 'npm run test:automation'));
assert.ok(policy.jobs.policy.steps.some(s => s.run === 'npm run lint:renovate'));
assert.ok(release.on.workflow_run && release.on.schedule);
assert.deepEqual(release.jobs.publish.needs, ['resolve', 'prepare']);
assert.equal(release.jobs.publish.environment, 'release');
assert.equal(release.jobs.publish.permissions['id-token'], 'write');
assert.equal(release.on.workflow_dispatch.inputs['validate-artifacts'].default, false);
assert.match(release.jobs.publish.if, /!\(github\.event_name == 'workflow_dispatch' && inputs\.dry-run\)/, 'Artifact rehearsal must never publish');
for (const job of ['prepare', 'publish']) {
  assert.equal(release.jobs[job].steps[0].with.ref, '${{ needs.resolve.outputs.sha }}');
}
assert.equal(release.concurrency['cancel-in-progress'], false);
const source = readFileSync('scripts/ci-release.mjs', 'utf8');
assert.doesNotMatch(source, /git describe|already published versions|already exist/);
assert.match(source, /await publishStages\(record/);
for (const stage of ['validate', 'recover', 'tag', 'npm', 'images', 'chart', 'promoted', 'complete']) {
  assert.match(source, new RegExp(`\\b${stage}:`), `Release must wire the tested ${stage} stage`);
}
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
