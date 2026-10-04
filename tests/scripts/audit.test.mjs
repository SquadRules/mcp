import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditResult, nativeProgressing } from '../../scripts/ci-audit.mjs';

const audit = (count = 0) => JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: {
  moderate: count, high: 0, critical: 0,
} } });
test('audit clean no-op and structured moderate assessment', () => {
  assert.equal(auditResult(audit(), 0).count, 0);
  assert.equal(auditResult(audit(1), 1).count, 1);
});

test('registry and auth errors are not security findings', () => {
  assert.throws(() => auditResult('{"error":{"code":"E401"}}', 1), /registry\/auth/);
  assert.throws(() => auditResult('not json', 1), /invalid audit JSON/);
  assert.throws(() => auditResult(audit(), 2), /registry\/auth/);
});
test('progressing native fixes take precedence; stalled/failed updates allow refreshed fallback', () => {
  const now = Date.now();
  const pr = { user: { id: 49699333, login: 'dependabot[bot]' }, state: 'open',
    labels: [{ name: 'security' }], head: { sha: 'abc' }, updated_at: new Date(now).toISOString() };
  assert.equal(nativeProgressing(pr, [], now), true);
  assert.equal(nativeProgressing(pr, [{ head_sha: 'abc', conclusion: 'failure' }], now), false);
  assert.equal(nativeProgressing(pr, [], now + 3 * 60 * 60 * 1000), false);
});
