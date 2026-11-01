import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { APP_PATHS } from '../../scripts/ci-change-class.mjs';

const workflow = name => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const stepNamed = (config, job, name) => config.jobs[job].steps.find(s => s.name === name);
const runOf = (config, job, name) => stepNamed(config, job, name).run;

test('integration, security, and policy workflows have correct triggers and permissions', () => {
  const integration = workflow('integration');
  const security = workflow('security');
  const policy = workflow('automation-policy');

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
});

test('security workflow includes dependency review and does not continue on error', () => {
  const security = workflow('security');
  assert.ok(security.jobs['security-pass'].needs.includes('dependency-review'));
  assert.notEqual(security.jobs['dependency-review']['continue-on-error'], true);
});

test('integration build runs all required scripts', () => {
  const integration = workflow('integration');
  for (const script of ['lint', 'typecheck', 'knip', 'test:ui', 'build:tgz', 'test:tgz']) {
    assert.ok(integration.jobs.build.steps.some(s => s.run === `npm run ${script}`));
  }
});

test('integration build matrix uses Node 24 and 26', () => {
  const integration = workflow('integration');
  assert.deepEqual(integration.jobs.build.strategy.matrix.node, ['24', '26']);
});

test('integration cluster lane runs HTTP transport tests', () => {
  const integration = workflow('integration');
  assert.ok(integration.jobs['verify-integration-cluster'].steps.some(s => s.run === 'TRANSPORT_TYPE=http npm test -- tests/unit'));
});

test('integration single lane is required and runs correct tests', () => {
  const integration = workflow('integration');
  const single = integration.jobs['verify-integration-single'];
  assert.deepEqual(single.needs, ['build'], 'Single lane consumes the build matrix artifact');
  assert.equal(single['continue-on-error'], undefined, 'Single lane is required (not advisory)');
  assert.ok(integration.jobs['integration-pass'].needs.includes('verify-integration-single'));
  assert.ok(single.steps.some(s => s.run === 'npm test -- tests/unit'), 'Single lane runs unit tests under zero-config defaults');
  assert.ok(single.steps.some(s => s.run?.includes('spaces-tool.stdio-simple.test.ts')), 'Single lane runs stdio integration test to verify SINGLE mode end-to-end');
});

test('workflows use native path filtering to prevent empty-diff bypass', () => {
  const integration = workflow('integration');
  const security = workflow('security');
  const requiredPaths = {
    integration: ['src/**', 'tests/**', 'package.json', 'package-lock.json'],
    security: ['src/**', 'package.json', 'package-lock.json'],
  };

  for (const [config, name] of [[integration, 'integration'], [security, 'security']]) {
    assert.deepEqual(config.on.pull_request.branches, ['main']);
    assert.ok(Array.isArray(config.on.pull_request.paths), 'Workflows must use native path filtering');
    for (const path of requiredPaths[name]) {
      assert.ok(config.on.pull_request.paths.includes(path), `Missing required path: ${path}`);
    }
    assert.equal(config.on.pull_request['paths-ignore'], undefined);
    assert.ok(!config.on.pull_request.types || config.on.pull_request.types.includes('synchronize'));
    assert.equal(config.jobs.changes, undefined, 'No path classifier may suppress required validation');
  }
});

test('aggregate gates require all jobs and fail closed', () => {
  const integration = workflow('integration');
  const security = workflow('security');

  for (const [config, gateId, required] of [
    [integration, 'integration-pass', ['build', 'verify-integration-cluster', 'verify-integration-single']],
    [security, 'security-pass', ['dependency-review', 'npm-audit', 'codeql']],
  ]) {
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
});

test('integration and security job dependencies are correct', () => {
  const integration = workflow('integration');
  const security = workflow('security');
  assert.equal(integration.jobs.build.needs, undefined);
  assert.deepEqual(integration.jobs['verify-integration-cluster'].needs, ['build']);
  assert.equal(security.jobs.codeql.needs, undefined);
  assert.equal(security.jobs['npm-audit'].needs, undefined);
  assert.equal(security.jobs['dependency-review'].if, "github.event_name == 'pull_request'");
});

test('automation policy runs required checks', () => {
  const policy = workflow('automation-policy');
  assert.ok(policy.jobs.policy.steps.some(s => s.run === 'npm run test:automation'));
});

test('release workflow triggers and structure', () => {
  const release = workflow('release');
  assert.deepEqual(release.on.push.branches, ['main']);
  assert.ok(Array.isArray(release.on.push.paths), 'release.yml must use native path filtering');
  for (const path of ['src/**', 'package.json', 'package-lock.json']) {
    assert.ok(release.on.push.paths.includes(path), `Missing required path: ${path}`);
  }
  assert.ok(!release.on.push.paths.includes('.github/workflows/**'), 'CI workflow changes should not trigger releases');
  assert.ok(!release.on.push.paths.includes('scripts/**'), 'Build script changes should not trigger releases');
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
});

test('release PR sync step is correct', () => {
  const release = workflow('release');
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
});

test('release auto-merge is correctly configured', () => {
  const release = workflow('release');
  assert.equal(release.jobs['validate-release-pr'], undefined);
  const autoMerge = release.jobs['auto-merge-release-pr'];
  assert.deepEqual(autoMerge.needs, ['release-please', 'sync-release-pr']);
  const syncReleasePr = release.jobs['sync-release-pr'];
  assert.equal(syncReleasePr.outputs.head_sha, '${{ steps.sync.outputs.head_sha }}');

  for (const job of [release.jobs['release-please'], syncReleasePr, autoMerge]) {
    const token = job.steps.find(s => s.id === 'app-token');
    assert.equal(token.uses, 'actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349');
    assert.equal(token.with['app-id'], '${{ vars.AUTO_APP_ID }}');
    assert.equal(token.with['private-key'], '${{ secrets.AUTO_APP_PRIVATE_KEY }}');
    assert.equal(token.with.repositories, '${{ github.event.repository.name }}');
    assert.equal(token.with['permission-administration'], undefined);
    assert.equal(job.permissions.contents, 'read');
  }
  const mergeStep = autoMerge.steps.find(s => s.run);
  assert.equal(mergeStep.env.GH_TOKEN, '${{ steps.app-token.outputs.token }}');
  assert.match(mergeStep.run, /--auto --squash --match-head-commit/);
  assert.doesNotMatch(JSON.stringify(release), /gh workflow run|--admin/);
  assert.doesNotMatch(JSON.stringify(release), /secrets\.GH_PAT/);
});

test('release publish job is correctly configured', () => {
  const release = workflow('release');
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
});

test('release configuration matches package metadata', () => {
  const releasePleaseConfig = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
  const releasePleaseManifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
  assert.equal(releasePleaseConfig['release-type'], 'node');
  assert.equal(releasePleaseConfig['include-component-in-tag'], false);
  assert.equal(releasePleaseConfig.packages['.']['package-name'], '@squadrules/mcp');
  const releasePackage = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(releasePleaseManifest['.'], releasePackage.version);
});

test('package.json has correct publish configuration', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts.publish, undefined, 'Avoid npm publish lifecycle recursion');
  assert.equal(pkg.scripts.prepack, 'npm run build && node scripts/stage-runtime-lock.mjs');
  assert.equal(pkg.publishConfig.provenance, true);
});

test('dependabot is correctly configured', () => {
  const dependabot = load(readFileSync('.github/dependabot.yml', 'utf8'));
  assert.equal(dependabot.updates.length, 2);
  assert.ok(dependabot.updates.every(u => u['open-pull-requests-limit'] === 0));
});

test('auto-update workflow sequentially updates, checks, and merges PRs', () => {
  const autoUpdate = workflow('auto-update-pr-branches');
  assert.ok(Object.hasOwn(autoUpdate.on, 'push'), 'Updates must run as soon as main advances');
  assert.ok(autoUpdate.on.workflow_run?.workflows?.includes('Docs wiki regeneration'), 'Auto-update must wait for docs wiki regeneration to avoid race condition');
  assert.ok(autoUpdate.on.workflow_run?.workflows?.includes('Release'), 'Auto-update must wait for Release (auto-merge-release-pr changes main) to avoid race condition');
  assert.equal(autoUpdate.on.schedule, undefined, 'No schedule trigger — PRs only need updating after a push to main');
  assert.equal(autoUpdate.permissions['pull-requests'], 'write', 'Must have pull-requests: write for gh pr merge');
  const updateStep = autoUpdate.jobs['update-prs'].steps.find(s => s.run?.includes('gh pr update-branch'));
  assert.ok(updateStep, 'update-prs must delegate branch update to gh pr update-branch');
  assert.ok(updateStep.run.includes('gh pr checks'), 'Must wait for checks with gh pr checks --watch');
  assert.ok(updateStep.run.includes('gh pr merge'), 'Must merge with gh pr merge');
  for (const validator of ['Integration', 'Security', 'Automation policy']) {
    assert.ok(autoUpdate.on.workflow_run.workflows.includes(validator), `Must retry after ${validator} finishes`);
  }
  assert.match(updateStep.run, /CHANGED_FILES.*= "0"/, 'Must close already-absorbed managed dependency PRs');
  assert.match(updateStep.run, /dependabot\[bot\].*49699333/, 'Must verify bot identity before closing no-op PR');
  assert.match(updateStep.run, /\.head_repository\.full_name/, 'Must gate by same-repository run origin');
  assert.match(updateStep.run, /for WORKFLOW in automation-policy ci-gate/, 'Must require the always-on policy gate plus the change-class aggregate');
  assert.match(updateStep.run, /--auto --squash --match-head-commit/, 'Must use protected expected-head auto-merge');
  assert.doesNotMatch(updateStep.run, /--admin/, 'Never override required checks');
  assert.doesNotMatch(updateStep.run, /mergeStateStatus|git merge|git push|gh repo clone/, 'No async-stale status fields and no local merge machinery');
});

test('ci gate is always-on, classifies the revision and fails closed', () => {
  const gate = workflow('ci-gate');
  const raw = readFileSync('.github/workflows/ci-gate.yml', 'utf8');

  assert.equal(gate.name, 'CI gate');
  assert.deepEqual(gate.on.pull_request.branches, ['main']);
  assert.deepEqual(gate.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review']);
  assert.ok(Object.hasOwn(gate.on, 'merge_group') && Object.hasOwn(gate.on, 'workflow_dispatch'));
  // The absence of a filter is the whole mechanism: a filtered aggregate cannot report.
  assert.equal(gate.on.pull_request.paths, undefined, 'An always-on aggregate must not declare paths');
  assert.equal(gate.on.pull_request['paths-ignore'], undefined, 'paths-ignore would strand the required context the same way');
  assert.doesNotMatch(raw, /^\s*paths(-ignore)?:/m, 'No path filter may appear anywhere in the aggregate');
  assert.equal(JSON.stringify(gate.permissions), JSON.stringify({ contents: 'read', 'pull-requests': 'read', actions: 'read' }));

  assert.equal(gate.jobs.gate.name, 'CI gate passed');
  assert.equal(gate.jobs.gate['continue-on-error'], undefined, 'The aggregate cannot be advisory');
  assert.doesNotMatch(raw, /continue-on-error/, 'No step may demote gate evidence');
  assert.equal(gate.jobs.gate['timeout-minutes'], 90);
  for (const step of gate.jobs.gate.steps) assert.equal(step['continue-on-error'], undefined);

  const checkout = gate.jobs.gate.steps.find(s => s.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.with['fetch-depth'], 0, 'Merge-base classification needs full history');

  const classify = runOf(gate, 'gate', 'Classify changed paths');
  assert.match(classify, /scripts\/ci-change-class\.mjs/);
  assert.match(classify, /git merge-base/);
  assert.match(classify, /git diff --name-only/);
  assert.match(classify, /--empty-diff/, 'An empty revision must fail rather than wait');
  assert.match(classify, /unclassified/, 'A failed classification must expect every lane');

  const docs = stepNamed(gate, 'gate', 'Documentation lane');
  assert.equal(docs.if, "steps.classify.outputs.docs == 'true'");
  assert.match(docs.run, /npm ci/);
  assert.match(docs.run, /lint-docs-links\.mjs --strict/);
  // ADR 0038: the docs lane runs the canonical aggregate, so ESLint (the only
  // checker of forbidden wording in Markdown) runs for every change class. It must
  // not be replaced by a hand-picked subset of lint:* scripts.
  assert.match(docs.run, /npm run lint\b/, 'Documentation lane must run npm run lint');
  assert.doesNotMatch(
    docs.run,
    /npm run lint:(markdown|skills)\b/,
    'Documentation lane must not downgrade the aggregate to individual lints'
  );

  const evidence = stepNamed(gate, 'gate', 'Require integration and security evidence');
  assert.equal(evidence.if, "steps.classify.outputs.app == 'true'");
  assert.match(evidence.run, /no CI evidence for this revision/, 'Exhausting the budget must fail closed');
  for (const bad of ['failure', 'cancelled', 'timed_out', 'action_required']) {
    assert.ok(evidence.run.includes(`completed/${bad}`), `Must abort immediately on ${bad}`);
  }
  // Evidence is keyed by the head branch commit; github.sha is the synthetic merge commit
  // and no workflow run ever records it.
  assert.match(raw, /EVIDENCE_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\|/);
  assert.doesNotMatch(evidence.run, /GITHUB_SHA|\$\{\{ github\.sha \}\}/, 'The wait must not key on the merge commit');
  assert.match(evidence.run, /GITHUB_STEP_SUMMARY/);

  // The aggregate reuses the auto-update proven run filter rather than a weaker one.
  const autoUpdate = workflow('auto-update-pr-branches');
  const updateRun = autoUpdate.jobs['update-prs'].steps.find(s => s.run?.includes('gh pr update-branch')).run;
  for (const fragment of [
    'select(.path == $file', '.head_sha == $sha', '.head_branch == $branch', '.head_repository.full_name == $repo',
    'sort_by(.run_number, .run_attempt, .id) | last',
  ]) {
    assert.ok(updateRun.includes(fragment), `auto-update must keep the proven ${fragment} predicate`);
    assert.ok(evidence.run.includes(fragment), `The gate must reuse the proven ${fragment} predicate`);
  }
  // auto-update only ever lists pull_request runs; the aggregate also serves merge_group,
  // so it parameterizes the same predicate instead of hardcoding it.
  assert.ok(updateRun.includes('.event == "pull_request"'));
  assert.ok(evidence.run.includes('.event == $event'));
  assert.match(evidence.run, /--arg event "\$GITHUB_EVENT_NAME"/);
});

test('change-class application set equals the union of the filtered workflow paths', () => {
  const integration = workflow('integration');
  const security = workflow('security');
  const union = [...new Set([...integration.on.pull_request.paths, ...security.on.pull_request.paths])].sort();
  assert.deepEqual([...APP_PATHS].sort(), union,
    'scripts/ci-change-class.mjs must expect evidence for exactly what integration.yml and security.yml can run for');
});
