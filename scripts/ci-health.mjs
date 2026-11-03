import { GitHub, report } from './ci-automation.mjs';
import { AUDIT_STALE_MINUTES, assessWorkflow } from './ci-health-policy.mjs';

const api = new GitHub();
const checks = [
  ['npm-audit-fix.yml', AUDIT_STALE_MINUTES],
  ['release.yml', null],
];
const issues = await api.pages('/issues?state=open&creator=github-actions%5Bbot%5D');
const failures = [];
for (const [file, maxMinutes] of checks) {
  const { workflow_runs: runs } = await api.request(`/actions/workflows/${file}/runs?branch=main&per_page=100`);
  const { completed, failed, reason } = assessWorkflow(file, maxMinutes, runs);
  const key = `<!-- automation-incident:${file} -->`;
  const existing = issues.find(issue => !issue.pull_request && issue.body?.includes(key));
  if (failed) {
    failures.push({ workflow: file, reason, run: completed?.html_url });
    const body = `${key}\n${reason}.\n\nLatest completed run: ${completed?.html_url ?? 'none'}.\n\nAutomation remains fail-closed. Inspect the workflow summary; restore credentials or infrastructure, then re-run validation or the failed workflow. Do not bypass validation.`;
    if (!existing) await api.request('/issues', { method: 'POST', body: { title: `Automation incident: ${file}`, body } });
    else if (existing.body !== body) await api.request(`/issues/${existing.number}`, { method: 'PATCH', body: { body } });
  } else if (existing) {
    await api.request(`/issues/${existing.number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
  }
}
report({ healthy: failures.length === 0, failures });
if (failures.length) process.exitCode = 1;
