import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUDIT_STALE_MINUTES, assessWorkflow } from '../../scripts/ci-health-policy.mjs';

const now = Date.parse('2026-11-03T07:00:00Z');
const auditRun = (ageMinutes, conclusion = 'success') => ({
  id: 100,
  event: 'schedule',
  status: 'completed',
  conclusion,
  updated_at: new Date(now - ageMinutes * 60_000).toISOString(),
});
const audit = runs => assessWorkflow('npm-audit-fix.yml', AUDIT_STALE_MINUTES, runs, now);

test('scheduled audit allows observed multi-hour cron gaps but detects a real outage', () => {
  assert.equal(AUDIT_STALE_MINUTES, 12 * 60);
  assert.equal(audit([auditRun(6 * 60)]).failed, false);
  assert.equal(audit([auditRun(12 * 60)]).failed, false);
  assert.equal(audit([auditRun(12 * 60 + 1)]).failed, true);
  assert.match(audit([auditRun(12 * 60 + 1)]).reason, /stale/);
  assert.equal(audit([]).failed, true);
});

test('failed or cancelled audit still causes an immediate incident', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    assert.equal(audit([auditRun(5, conclusion)]).failed, true, conclusion);
  }
  assert.equal(audit([auditRun(5, 'skipped')]).failed, false);
});

test('release monitors the latest completed main release and ignores audit events', () => {
  const releaseRun = { ...auditRun(1, 'failure'), id: 200, event: 'push' };
  assert.equal(assessWorkflow('release.yml', null, [releaseRun], now).failed, true);
  assert.equal(assessWorkflow('release.yml', null, [{ ...releaseRun, conclusion: 'success' }], now).failed, false);
  assert.equal(assessWorkflow('release.yml', null, [auditRun(1)], now).failed, true);
});
