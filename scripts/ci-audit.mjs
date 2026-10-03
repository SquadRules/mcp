import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { GitHub, managedPull, securityPull, verifyIdentity, output, report } from './ci-automation.mjs';

const directory = '.local/npm-audit-fix';
export function auditResult(raw, status) {
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Registry returned invalid audit JSON'); }
  const counts = data.metadata?.vulnerabilities;
  if (![0, 1].includes(status) || data.error || !data.vulnerabilities || !counts ||
      !['moderate', 'high', 'critical'].every(k => Number.isInteger(counts[k]))) {
    throw new Error('Audit assessment failed (registry/auth/tool error, not a vulnerability finding)');
  }
  return { count: counts.moderate + counts.high + counts.critical, vulnerabilities: data.vulnerabilities, counts };
}

function assess(name) {
  // Production scope: the remediation gate (and publishAudit's before/after count
  // check) covers shipped dependencies only. `npm audit fix --force` "resolves"
  // wide-ranged dev tooling by downgrading it, which breaks builds/releases and
  // still leaves advisories open; dev-only advisories are delegated to dependency
  // tooling instead of being force-downgraded.
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', env: { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: 'true' } });
  const audit = auditResult(result.stdout, result.status);
  writeFileSync(`${directory}/${name}.json`, result.stdout);
  return audit;
}

export function nativeProgressing(pr, runs, now = Date.now()) {
  return pr.user?.id === 49699333 && pr.user?.login === 'dependabot[bot]' && securityPull(pr) &&
    pr.state === 'open' && !pr.draft && pr.mergeable !== false &&
    now - Date.parse(pr.updated_at) < 2 * 60 * 60 * 1000 &&
    !runs.some(r => r.head_sha === pr.head.sha && ['failure', 'cancelled', 'timed_out', 'action_required'].includes(r.conclusion));
}

export async function publishAudit(api, { env = process.env, read = readFileSync } = {}) {
  const user = await verifyIdentity(api, Number(env.AUTOMATION_USER_ID));
  const before = auditResult(read(`${directory}/before.json`, 'utf8'), 1);
  const after = auditResult(read(`${directory}/after.json`, 'utf8'), 0);
  if (!before.count || after.count) throw new Error('Audit artifacts do not demonstrate a complete moderate-or-higher fix');
  const main = await api.request('/branches/main');
  if (main.commit.sha !== env.SOURCE_SHA) return { state: 'deferred', reason: 'main advanced; reassess next run' };
  const pulls = await api.pages('/pulls?state=open&base=main&sort=created&direction=asc');
  for (const pr of pulls.filter(p => p.user?.id === 49699333 && securityPull(p))) {
    const runs = await api.pages(`/actions/runs?head_sha=${pr.head.sha}`, 'workflow_runs');
    if (nativeProgressing(pr, runs)) return { state: 'deferred', reason: 'native security PR progressing', number: pr.number };
  }
  const branch = 'automation/audit-fix';
  const existing = pulls.find(p => p.head.ref === branch);
  if (existing && !managedPull(existing, await api.pages(`/pulls/${existing.number}/files`), api.repo, user.id)) {
    throw new Error('Existing audit branch PR is not owned by this automation identity');
  }
  const title = 'fix(deps): resolve npm security advisories';
  if (env.DRY_RUN !== 'false') return { state: 'would-publish', branch, before: before.count, after: after.count };
  if (env.AUTOMATION_ENABLED !== 'true') throw new Error('Automation is disabled');
  let old;
  try { old = await api.request(`/git/ref/heads/${branch}`); } catch (error) { if (error.status !== 404) throw error; }
  if (old && !existing) {
    const orphan = await api.request(`/commits/${old.object.sha}`);
    const comparison = await api.request(`/compare/${main.commit.sha}...${old.object.sha}`);
    if (orphan.author?.id !== user.id || orphan.commit?.message !== title || !comparison.files?.length ||
        !comparison.files.every(f => ['package.json', 'package-lock.json'].includes(f.filename) && !f.previous_filename)) {
      throw new Error('Audit ref exists without verified producer identity and manifest-only changes');
    }
  }
  const commit = await api.request(`/git/commits/${main.commit.sha}`);
  const tree = await api.request('/git/trees', { method: 'POST', body: {
    base_tree: commit.tree.sha,
    tree: ['package.json', 'package-lock.json'].map(path => ({ path, mode: '100644', type: 'blob', content: read(path, 'utf8') })),
  } });
  if (old) {
    const previous = await api.request(`/git/commits/${old.object.sha}`);
    const comparison = await api.request(`/compare/${main.commit.sha}...${old.object.sha}`);
    if (existing && previous.tree.sha === tree.sha && comparison.behind_by === 0) return { state: 'unchanged', number: existing.number };
  }
  const next = await api.request('/git/commits', { method: 'POST', body: {
    message: title, tree: tree.sha,
    parents: [...new Set([old?.object.sha, main.commit.sha].filter(Boolean))],
  } });
  if (old) await api.request(`/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: next.sha, force: false } });
  else await api.request('/git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: next.sha } });
  const body = `Consolidated security fallback: ${before.count} moderate-or-higher findings before, ${after.count} after.\n\nFull Integration, Security, and automation-policy validation gates this update. Native security PRs are retained until fixes are verified on main.`;
  const pr = existing
    ? await api.request(`/pulls/${existing.number}`, { method: 'PATCH', body: { title, body } })
    : await api.request('/pulls', { method: 'POST', body: { base: 'main', head: branch, title, body } });
  if (!pr.number || pr.head?.sha !== next.sha) throw new Error('Audit PR revision was not confirmed');
  return { state: existing ? 'refreshed' : 'created', number: pr.number, sha: next.sha };
}

async function main() {
  if (process.argv[2] === 'publish') return report(await publishAudit(new GitHub()));
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) throw new Error('Do not expose repository credentials to npm assessment');
  mkdirSync(directory, { recursive: true });
  const before = assess('before');
  if (!before.count) { output({ changed: false }); return report({ state: 'clean', ...before.counts }); }
  const fix = spawnSync('bash', ['scripts/npm-audit-fix.sh'], { stdio: 'inherit', env: { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: 'true' } });
  const after = assess('after');
  if (fix.status !== 0 || after.count !== 0) throw new Error('Unresolved production moderate-or-higher advisories; no false success');
  const diff = spawnSync('git', ['diff', '--quiet', '--', 'package.json', 'package-lock.json']);
  if (diff.status !== 1) throw new Error('Audit reported a fix without changed manifests');
  output({ changed: true });
  report({ state: 'fixed', before: before.count, after: after.count });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
