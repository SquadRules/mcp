import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  GitHub, dependencyTitle, managedPull, orderPulls, gateRuns, reconcile,
  assertProtection, conventionalTitle,
} from '../../scripts/ci-automation.mjs';
import { publishAudit } from '../../scripts/ci-audit.mjs';

const repo = 'owner/repo';
const sha = 'a'.repeat(40);
const base = 'b'.repeat(40);
const pull = (number = 1, overrides = {}) => ({
  number, title: 'chore(deps): bump dependencies', body: '', draft: false,
  state: 'open', created_at: '2026-01-01T00:00:00Z', labels: [],
  user: { id: 49699333, login: 'dependabot[bot]', type: 'Bot' },
  head: { sha, ref: 'dependabot/npm_and_yarn/example', repo: { full_name: repo } },
  base: { ref: 'main', sha: base, repo: { full_name: repo } },
  mergeable: true, mergeable_state: 'clean', ...overrides,
});
const files = [{ filename: 'package-lock.json', status: 'modified' }];
const paths = ['integration', 'security', 'automation-policy'];
const runs = paths.map((path, i) => ({ id: i + 1, run_number: 1, run_attempt: 1,
  path: `.github/workflows/${path}.yml`, event: 'pull_request',
  head_sha: sha, head_branch: 'dependabot/npm_and_yarn/example',
  head_repository: { full_name: repo }, status: 'completed', conclusion: 'success',
}));

test('credentials are mandatory, never silently successful', () => {
  assert.throws(() => new GitHub({ repo, token: '' }), /token/i);
});

test('pagination handles more than 100 pulls using supported REST parameters', async () => {
  const calls = [];
  const api = new GitHub({ repo, token: 'fixture', fetch: async url => {
    calls.push(String(url));
    const page = new URL(url).searchParams.get('page');
    return Response.json(page === '1' ? Array.from({ length: 100 }, (_, i) => ({ number: i })) : [{ number: 100 }]);
  } });
  assert.equal((await api.pages('/pulls?state=open&sort=created&direction=asc')).length, 101);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /page=2/);
});

test('trusted REST bot identity and dependency paths are both required', () => {
  assert.equal(managedPull(pull(), files, repo, 42), true);
  assert.equal(managedPull(pull(1, { user: { id: 9, login: 'app/dependabot', type: 'User' } }), files, repo, 42), false);
  assert.equal(managedPull(pull(1, { user: { id: 7, login: 'dependabot[bot]', type: 'Bot' } }), files, repo, 42), false);
  assert.equal(managedPull(pull(), [{ filename: 'src/index.ts' }], repo, 42), false);
  assert.equal(managedPull(pull(), [{ filename: 'package.json', previous_filename: 'src/index.ts' }], repo, 42), false);
});

test('managed producers require numeric credential identity, prefix, same origin', () => {
  const p = pull(1, { user: { id: 42, login: 'owner', type: 'User' },
    head: { sha, ref: 'automation/renovate/react', repo: { full_name: repo } } });
  assert.equal(managedPull(p, files, repo, 42), true);
  assert.equal(managedPull(p, files, repo, 43), false);
  assert.equal(managedPull({ ...p, labels: [{ name: 'security' }], user: { id: 43 } }, files, repo, 42), false);
  assert.equal(managedPull({ ...p, head: { ...p.head, repo: { full_name: 'fork/repo' } } }, files, repo, 42), false);
  assert.equal(managedPull({ ...p, head: { ...p.head, ref: 'human-work' } }, files, repo, 42), false);
});

test('security first, oldest within priority, deterministic ties', () => {
  assert.deepEqual(orderPulls([
    pull(3, { created_at: '2026-01-03', labels: [{ name: 'security' }] }),
    pull(2, { created_at: '2026-01-02', labels: [{ name: 'security' }] }), pull(1),
  ]).map(p => p.number), [2, 3, 1]);
});

test('release-compatible titles preserve breaking information', () => {
  assert.equal(dependencyTitle('chore(deps)!: bump compiler'), 'fix(deps)!: bump compiler');
  assert.equal(dependencyTitle('deps(npm): bump react'), 'fix(deps): bump react');
  assert.equal(dependencyTitle('fix(deps): update package'), 'fix(deps): update package');
  assert.throws(() => dependencyTitle('arbitrary title'), /title/i);
  assert.equal(conventionalTitle('feat(api)!: new API'), true);
  assert.equal(conventionalTitle('docs: clarify setup'), true);
  assert.equal(conventionalTitle('fix: injected\nsecond line'), false);
});

test('gates fail closed for missing, stale, pending, failed and wrong-origin runs', () => {
  const opts = { sha, branch: 'dependabot/npm_and_yarn/example', repo, event: 'pull_request' };
  assert.equal(gateRuns(runs, opts).ready, true);
  for (const bad of [runs.slice(1), runs.map(r => ({ ...r, head_sha: base })),
    runs.map(r => ({ ...r, event: 'push' })), runs.map(r => ({ ...r, status: 'in_progress' })),
    runs.map(r => ({ ...r, conclusion: 'failure' })),
    runs.map(r => ({ ...r, head_repository: { full_name: 'fork/repo' } }))]) {
    assert.equal(gateRuns(bad, opts).ready, false);
  }
  assert.equal(gateRuns([...runs, { ...runs[0], id: 99, run_number: 2, status: 'queued', conclusion: null }], opts).ready, false);
});

test('main validation excludes PR events and requires all three workflows', () => {
  assert.equal(gateRuns(runs, { sha, branch: 'main', repo, event: 'push' }).ready, false);
  assert.equal(gateRuns(runs.map(r => ({ ...r, event: 'push', head_branch: 'main' })),
    { sha, branch: 'main', repo, event: 'push' }).ready, true);
});

function fixture(pulls = [pull()]) {
  const mutations = [];
  const api = {
    repo,
    request: async (path, options = {}) => {
      if (options.method) {
        mutations.push({ path, ...options });
        return path.endsWith('/merge') ? { merged: true, sha: base } : { message: 'Updating pull request branch.' };
      }
      if (path === '/branches/main') return { commit: { sha: base } };
      if (path.startsWith('/compare/')) return { behind_by: 0 };
      if (/\/pulls\/\d+$/.test(path)) return pulls.find(p => path.endsWith(`/${p.number}`));
      throw new Error(`Unexpected request ${path}`);
    },
    pages: async path => {
      if (path.startsWith('/pulls?')) return pulls;
      if (path.endsWith('/files')) return files;
      if (path.startsWith('/actions/runs?')) return runs;
      throw new Error(`Unexpected pages ${path}`);
    },
  };
  return { api, mutations };
}

test('only one protected expected-head merge per reconciliation; duplicate event is no-op', async () => {
  const { api, mutations } = fixture([pull(), pull(2)]);
  const result = await reconcile(api, { actorId: 42 });
  assert.equal(result.state, 'merged');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].body.sha, sha);
  assert.equal(mutations[0].body.merge_method, 'squash');
  const duplicate = fixture([]);
  assert.equal((await reconcile(duplicate.api, { actorId: 42 })).state, 'deferred');
});

test('dry-run has no mutations', async () => {
  const { api, mutations } = fixture();
  assert.equal((await reconcile(api, { actorId: 42, dryRun: true })).state, 'would-merge');
  assert.equal(mutations.length, 0);
});

test('changed head before mutation is deferred', async () => {
  const { api, mutations } = fixture();
  const original = api.request;
  let reads = 0;
  api.request = async (path, opts) => {
    const result = await original(path, opts);
    return path === '/pulls/1' && ++reads > 1 ? { ...result, head: { ...result.head, sha: base } } : result;
  };
  assert.equal((await reconcile(api, { actorId: 42 })).state, 'deferred');
  assert.equal(mutations.length, 0);
});

test('failed earlier pull does not prevent another eligible security fix', async () => {
  const { api, mutations } = fixture([pull(1, { mergeable: false }), pull(2, { labels: [{ name: 'security' }] })]);
  assert.equal((await reconcile(api, { actorId: 42 })).number, 2);
  assert.equal(mutations.length, 1);
});

test('merge API rejection fails visibly', async () => {
  const { api } = fixture();
  const original = api.request;
  api.request = (path, opts) => opts?.method ? { merged: false, message: 'Denied' } : original(path, opts);
  await assert.rejects(reconcile(api, { actorId: 42 }), /merge/i);
});

test('behind managed branches receive one expected-head API update, never a merge', async () => {
  const { api, mutations } = fixture([pull(1, { mergeable_state: 'behind' }), pull(2, { mergeable_state: 'behind' })]);
  const result = await reconcile(api, { actorId: 42 });
  assert.equal(result.state, 'update-requested');
  assert.equal(result.number, 1);
  assert.deepEqual(mutations, [{ path: '/pulls/1/update-branch', method: 'PUT', body: { expected_head_sha: sha } }]);
});

for (const status of [403, 409, 422]) {
  test(`API ${status} is an error unless a head race is proven`, async () => {
    const { api } = fixture();
    const original = api.request;
    let attempted = false;
    let changed = false;
    api.request = async (path, opts) => {
      if (opts?.method) { attempted = true; throw Object.assign(new Error('fixture API error'), { status }); }
      const result = await original(path, opts);
      return path === '/pulls/1' && attempted && changed ? { ...result, head: { ...result.head, sha: base } } : result;
    };
    await assert.rejects(reconcile(api, { actorId: 42 }), /fixture API error/);
    attempted = false;
    changed = true;
    if (status === 403) await assert.rejects(reconcile(api, { actorId: 42 }), /fixture API error/);
    else assert.equal((await reconcile(api, { actorId: 42 })).state, 'deferred');
  });
}

test('renovate runner does not force-enable and ignores require-config', () => {
  const runner = readFileSync('scripts/ci-renovate.mjs', 'utf8');
  assert.doesNotMatch(runner, /RENOVATE_FORCE: JSON.stringify\(\{ enabled:/, 'Forced enabled would override release-managed image exclusions');
  assert.match(runner, /RENOVATE_REQUIRE_CONFIG: 'ignored'/);
});

function auditFixture({ existing = false, orphan = false } = {}) {
  const mutations = [];
  const owner = { id: 42, login: 'automation', type: 'User' };
  const pr = pull(9, { user: owner, head: { sha, ref: 'automation/audit-fix', repo: { full_name: repo } } });
  const api = {
    repo,
    pages: async path => path.endsWith('/files') ? files : existing ? [pr] : [],
    request: async (path, options = {}) => {
      if (options.method) {
        mutations.push({ path, ...options });
        if (path === '/git/trees') return { sha: 'new-tree' };
        if (path === '/git/commits') return { sha: 'new-head' };
        if (path.startsWith('/pulls')) return { number: 9, head: { sha: 'new-head' } };
        return { object: { sha: 'new-head' } };
      }
      if (path === '/user') return owner;
      if (path === '') return { default_branch: 'main', permissions: { push: true } };
      if (path === '/branches/main') return { commit: { sha: base } };
      if (path.startsWith('/git/ref/')) {
        if (existing || orphan) return { object: { sha } };
        throw Object.assign(new Error('missing ref'), { status: 404 });
      }
      if (path.startsWith('/git/commits/')) return { tree: { sha: 'old-tree' } };
      if (path.startsWith('/commits/')) return { author: owner, commit: { message: 'fix(deps): resolve npm security advisories' } };
      if (path.startsWith('/compare/')) return { behind_by: 1, files };
      throw new Error(`Unexpected audit request ${path}`);
    },
  };
  const options = {
    env: { AUTOMATION_USER_ID: '42', AUTOMATION_ENABLED: 'true', DRY_RUN: 'false', SOURCE_SHA: base },
    read: path => path.endsWith('before.json') || path.endsWith('after.json')
      ? JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { moderate: path.endsWith('before.json') ? 1 : 0, high: 0, critical: 0 } } })
      : '{"name":"fixture","version":"2.0.0"}',
  };
  return { api, options, mutations };
}

for (const scenario of [{}, { existing: true }, { orphan: true }]) {
  test(`audit creates, refreshes or recovers one manifest-only PR: ${JSON.stringify(scenario)}`, async () => {
    const { api, options, mutations } = auditFixture(scenario);
    const result = await publishAudit(api, options);
    assert.equal(result.state, scenario.existing ? 'refreshed' : 'created');
    assert.deepEqual(mutations.find(m => m.path === '/git/trees').body.tree.map(f => f.path), ['package.json', 'package-lock.json']);
    const commit = mutations.find(m => m.path === '/git/commits').body;
    assert.deepEqual(commit.parents, scenario.existing || scenario.orphan ? [sha, base] : [base]);
    assert.equal(mutations.filter(m => m.path.startsWith('/pulls')).length, 1);
    assert.ok(mutations.every(m => m.body.force !== true));
    assert.equal(result.sha, 'new-head');
  });
}

test('audit stale source, dry-run and disabled automation never write', async () => {
  for (const change of [{ SOURCE_SHA: sha }, { DRY_RUN: 'true' }, { AUTOMATION_ENABLED: 'false' }]) {
    const { api, options, mutations } = auditFixture();
    Object.assign(options.env, change);
    if (change.AUTOMATION_ENABLED) await assert.rejects(publishAudit(api, options), /disabled/);
    else await publishAudit(api, options);
    assert.equal(mutations.length, 0);
  }
});

test('producer credentials and validation remain separated in workflow wiring', () => {
  const workflow = readFileSync('.github/workflows/npm-audit-fix.yml', 'utf8');
  const [assessment, publishing] = workflow.split('\n  publish:');
  assert.doesNotMatch(assessment, /secrets.GH_PAT/);
  assert.match(publishing, /GH_TOKEN: \$\{\{ secrets.GH_PAT \}\}/);
  assert.doesNotMatch(publishing, /npm (ci|install|run)/);
});

test('protection must bind all required gates to Actions with strict base', () => {
  const settings = { required_status_checks: { strict: true, checks: [
    'Integration workflow passed', 'Security workflow passed', 'Automation policy passed',
  ].map(context => ({ context, app_id: 15368 })) }, enforce_admins: { enabled: true } };
  assert.doesNotThrow(() => assertProtection(settings));
  assert.throws(() => assertProtection({ ...settings, required_status_checks: { strict: false, checks: [] } }));
});
