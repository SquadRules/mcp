import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditedOverrideUpdates } from '../../scripts/ci-audit.mjs';

test('only vulnerable, explicitly supported stale overrides are upgraded', () => {
  const vulnerabilities = { glob: { severity: 'moderate' }, minimatch: { severity: 'moderate' }, other: { severity: 'high' } };
  const overrides = { glob: '^13.0.0', minimatch: '^10.2.3', other: '^1.0.0' };
  assert.deepEqual(auditedOverrideUpdates(vulnerabilities, overrides), [
    ['glob', '^14.0.2'],
    ['minimatch', '^11.0.1'],
  ]);
  assert.deepEqual(overrides, { glob: '^13.0.0', minimatch: '^10.2.3', other: '^1.0.0' });
});

test('does not rewrite unaffected, already patched, or custom overrides', () => {
  assert.deepEqual(auditedOverrideUpdates({}, { glob: '^13.0.0', minimatch: '^10.2.3' }), []);
  assert.deepEqual(auditedOverrideUpdates({ glob: {}, minimatch: {} }, {
    glob: '^14.0.2',
    minimatch: '^11.0.1',
  }), []);
  assert.deepEqual(auditedOverrideUpdates({ glob: {}, minimatch: {} }, {
    glob: '^12.0.0',
    minimatch: '10.2.6',
  }), []);
  assert.deepEqual(auditedOverrideUpdates({ glob: {} }, { glob: '^13.0.0' }), [['glob', '^14.0.2']]);
});
