// squadrules-compat-surface: preserves the docker compose project name kairos-mcp used by existing volumes/containers
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export const REQUIRED = {
  'integration.yml': 'Integration workflow passed',
  'security.yml': 'Security workflow passed',
  'automation-policy.yml': 'Automation policy passed',
};

export class GitHub {
  constructor({ repo = process.env.GITHUB_REPOSITORY, token = process.env.GH_TOKEN, fetch = globalThis.fetch } = {}) {
    if (!token?.trim()) throw new Error('An automation token is required');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('Invalid repository');
    this.repo = repo;
    this.token = token;
    this.fetch = fetch;
  }

  async request(path, { method = 'GET', body, global = false, accept = 'application/vnd.github+json' } = {}) {
    const url = `https://api.github.com${global ? '' : `/repos/${this.repo}`}${path}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let response;
      try {
        response = await this.fetch(url, { method, headers: {
          Authorization: `Bearer ${this.token}`, Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
        }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      } catch (error) {
        if (attempt === 3) throw error;
        await sleep(attempt * 2000);
        continue;
      }
      if ((response.status >= 500 || response.status === 429) && attempt < 3) {
        await sleep(attempt * 2000);
        continue;
      }
      if (!response.ok) {
        const error = new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      if (response.status === 204) return null;
      return accept === 'application/octet-stream' ? Buffer.from(await response.arrayBuffer()) : response.json();
    }
    throw new Error('GitHub request exhausted retries');
  }

  async pages(path, key) {
    const items = [];
    for (let page = 1; ; page++) {
      const result = await this.request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const batch = key ? result[key] : result;
      if (!Array.isArray(batch)) throw new Error(`Invalid paginated response: ${path}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }
}

export function report(value) {
  const text = JSON.stringify(value, null, 2);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${text}\n\`\`\`\n`);
}

export function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(String(value))) throw new Error('Multiline step output rejected');
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

export function conventionalTitle(title) {
  return typeof title === 'string' && !/[\r\n]/.test(title) &&
    /^(feat|fix|perf|revert|docs|style|refactor|test|build|ci|chore)(\([a-zA-Z0-9_.\/-]+\))?!?: \S.+$/.test(title);
}

export function dependencyTitle(title) {
  const normalized = title.replace(/^(?:chore\(deps(?:-dev)?\)|deps(?:\([^)]*\))?)(!?): /, 'fix(deps)$1: ');
  if (!conventionalTitle(normalized) || !/^(fix|feat|perf)\(deps(?:-dev)?\)!?: /.test(normalized)) {
    throw new Error('Unrecognized dependency PR title');
  }
  return normalized;
}

function dependencyFile(path) {
  return /^(package(?:-lock)?\.json|Dockerfile(?:\.[\w-]+)?|compose(?:\.[\w-]+)?\.ya?ml|\.github\/workflows\/[\w.-]+\.ya?ml|helm\/kairos-mcp\/(Chart\.(yaml|lock)|values\.yaml))$/.test(path);
}

export function managedPull(pr, files, repo, actorId) {
  if (pr.draft || pr.state !== 'open' || pr.base?.ref !== 'main' ||
      pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo) return false;
  const native = pr.user?.type === 'Bot' && (
    (pr.user.login === 'dependabot[bot]' && pr.user.id === 49699333 && pr.head.ref.startsWith('dependabot/')) ||
    (pr.user.login === 'renovate[bot]' && pr.user.id === 29139614 && pr.head.ref.startsWith('renovate/')));
  const own = Number.isSafeInteger(actorId) && actorId > 0 && pr.user?.id === actorId &&
    (pr.head.ref.startsWith('automation/renovate/') || pr.head.ref === 'automation/audit-fix');
  return Boolean((native || own) && files.length > 0 &&
    (pr.changed_files === undefined || pr.changed_files === files.length) &&
    files.every(f => dependencyFile(f.filename) && (!f.previous_filename || dependencyFile(f.previous_filename))));
}

export function securityPull(pr) {
  return pr.head?.ref === 'automation/audit-fix' || pr.labels?.some(l => /security|vulnerability/i.test(l.name));
}

export function orderPulls(pulls) {
  return [...pulls].sort((a, b) => Number(Boolean(securityPull(b))) - Number(Boolean(securityPull(a))) ||
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number);
}

export function gateRuns(runs, { sha, branch, repo, event }) {
  const gates = Object.keys(REQUIRED).map(file => {
    const run = runs.filter(r => r.path === `.github/workflows/${file}` && r.head_sha === sha &&
      r.head_branch === branch && r.head_repository?.full_name === repo && r.event === event)
      .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt || b.id - a.id)[0];
    return { workflow: file, id: run?.id, status: run?.status ?? 'missing', conclusion: run?.conclusion ?? null };
  });
  return { ready: gates.every(g => g.status === 'completed' && g.conclusion === 'success'), gates };
}

export function assertProtection(protection) {
  const checks = protection.required_status_checks;
  if (!checks?.strict || !protection.enforce_admins?.enabled ||
      !Object.values(REQUIRED).every(name => checks.checks?.some(c => c.context === name && c.app_id === 15368))) {
    throw new Error('Mandatory Actions gates, strict current-base protection, and admin enforcement are required');
  }
}

export async function verifyIdentity(api, expected = Number(process.env.AUTOMATION_USER_ID)) {
  const user = await api.request('/user', { global: true });
  if (!Number.isSafeInteger(expected) || expected <= 0 || user.id !== expected) {
    throw new Error('AUTOMATION_USER_ID must match the verified automation credential owner');
  }
  const repo = await api.request('');
  if (repo.default_branch !== 'main' || !repo.permissions?.push) throw new Error('Credential cannot update the expected default branch');
  return user;
}

async function mutateHead(api, pr, operation, body) {
  try {
    return await api.request(`/pulls/${pr.number}/${operation}`, { method: 'PUT', body });
  } catch (error) {
    if ([409, 422].includes(error.status)) {
      const fresh = await api.request(`/pulls/${pr.number}`);
      if (fresh.head.sha !== pr.head.sha || fresh.state !== 'open') return null;
    }
    throw error;
  }
}

export async function reconcile(api, { actorId, dryRun = false } = {}) {
  const candidates = orderPulls(await api.pages('/pulls?state=open&base=main&sort=created&direction=asc'));
  const deferred = [];
  let update;
  for (const candidate of candidates) {
    const pr = await api.request(`/pulls/${candidate.number}`);
    const files = await api.pages(`/pulls/${pr.number}/files`);
    if (!managedPull(pr, files, api.repo, actorId)) continue;
    let title;
    try { title = dependencyTitle(pr.title); } catch {
      deferred.push({ number: pr.number, reason: 'unrecognized dependency title' });
      continue;
    }
    if (pr.mergeable !== true) {
      deferred.push({ number: pr.number, reason: 'conflicts or mergeability pending' });
      continue;
    }
    const main = await api.request('/branches/main');
    const comparison = await api.request(`/compare/${main.commit.sha}...${pr.head.sha}`);
    if (comparison.behind_by !== 0 || pr.mergeable_state === 'behind') {
      update ??= pr;
      deferred.push({ number: pr.number, reason: 'base behind main' });
      continue;
    }
    const runs = await api.pages(`/actions/runs?head_sha=${pr.head.sha}`, 'workflow_runs');
    const gates = gateRuns(runs, { sha: pr.head.sha, branch: pr.head.ref, repo: api.repo, event: 'pull_request' });
    if (!gates.ready || pr.mergeable_state !== 'clean') {
      deferred.push({ number: pr.number, reason: 'checks or protection pending', ...gates });
      continue;
    }
    const fresh = await api.request(`/pulls/${pr.number}`);
    const currentMain = await api.request('/branches/main');
    if (fresh.head.sha !== pr.head.sha || fresh.state !== 'open' || fresh.draft ||
        fresh.mergeable_state !== 'clean' || currentMain.commit.sha !== main.commit.sha) {
      deferred.push({ number: pr.number, reason: 'head/base changed' });
      continue;
    }
    if (dryRun) return { state: 'would-merge', number: pr.number, sha: pr.head.sha, title, ...gates, deferred };
    const result = await mutateHead(api, pr, 'merge', {
      sha: pr.head.sha, merge_method: 'squash', commit_title: `${dependencyTitle(fresh.title)} (#${pr.number})`,
      commit_message: fresh.body || '',
    });
    if (!result) return { state: 'deferred', number: pr.number, reason: 'head changed during merge' };
    if (result.merged !== true || !result.sha) throw new Error(`Merge rejected for #${pr.number}`);
    return { state: 'merged', number: pr.number, sha: result.sha, ...gates, deferred };
  }
  if (update) {
    const fresh = await api.request(`/pulls/${update.number}`);
    if (fresh.head.sha === update.head.sha && fresh.state === 'open' && !fresh.draft) {
      if (dryRun) return { state: 'would-update', number: update.number, deferred };
      const result = await mutateHead(api, update, 'update-branch', { expected_head_sha: update.head.sha });
      if (!result) return { state: 'deferred', number: update.number, reason: 'head changed during update' };
      if (result.message !== 'Updating pull request branch.') throw new Error('Branch update was not accepted');
      return { state: 'update-requested', number: update.number, deferred };
    }
  }
  return { state: 'deferred', reason: 'no eligible current pull', deferred };
}

async function main() {
  if (process.argv[2] === 'title') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (event.pull_request && !conventionalTitle(event.pull_request.title)) throw new Error('PR title must be a Conventional Commit');
    return;
  }
  const dryRun = process.env.DRY_RUN !== 'false';
  if (!dryRun && process.env.AUTOMATION_ENABLED !== 'true') throw new Error('Automation is disabled');
  const api = new GitHub();
  const user = await verifyIdentity(api);
  if (!dryRun) assertProtection(await api.request('/branches/main/protection'));
  report(await reconcile(api, { actorId: user.id, dryRun }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
