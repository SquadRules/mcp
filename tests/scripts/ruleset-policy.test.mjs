// Ruleset assertions for scripts/ci-automation.mjs. Extracted from
// tests/scripts/automation.test.mjs to keep per-file line counts within ESLint max-lines.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertRuleset, rulesetId, REQUIRED, ACTIONS_APP_ID } from '../../scripts/ci-automation.mjs';

test('the main ruleset must bind exactly the mandated gates, with no bypass and no extra approval', () => {
  // Shape taken from the live `GET /repos/SquadRules/mcp/rulesets/25951418` response:
  // classic branch protection is deleted, so no protection document exists to assert on.
  const statusRule = checks => ({
    type: 'required_status_checks',
    parameters: { strict_required_status_checks_policy: true, required_status_checks: checks },
  });
  const reviewRule = extra => ({
    type: 'pull_request',
    parameters: { required_approving_review_count: 0, require_extra_approval_for_unattributed_changes: extra },
  });
  const contexts = Object.values(REQUIRED).map(context => ({ context, integration_id: ACTIONS_APP_ID }));
  const ruleset = {
    enforcement: 'active',
    target: 'branch',
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    bypass_actors: [],
    rules: [statusRule(contexts), reviewRule(false), { type: 'deletion' }, { type: 'non_fast_forward' }],
  };
  assert.doesNotThrow(() => assertRuleset(ruleset));

  const mutate = (type, change) => ({
    ...ruleset,
    rules: ruleset.rules.map(rule => rule.type === type ? change(rule) : rule),
  });
  const rejections = [
    { ...ruleset, enforcement: 'disabled' },
    { ...ruleset, target: 'tag' },
    { ...ruleset, conditions: { ref_name: { include: ['~ALL'], exclude: [] } } },
    { ...ruleset, bypass_actors: [{ actor_id: 1, actor_type: 'RepositoryRole', bypass_mode: 'always' }] },
    mutate('required_status_checks', rule => ({ ...rule, parameters: { ...rule.parameters, strict_required_status_checks_policy: false } })),
    // A dropped context stops enforcing a gate; an added one strands PRs that cannot produce it.
    mutate('required_status_checks', rule => ({ ...rule, parameters: { ...rule.parameters, required_status_checks: rule.parameters.required_status_checks.slice(1) } })),
    mutate('required_status_checks', rule => ({ ...rule, parameters: { ...rule.parameters, required_status_checks: [...rule.parameters.required_status_checks, { context: 'Something else passed', integration_id: ACTIONS_APP_ID }] } })),
    // Not GitHub Actions: an unrelated integration cannot report the context.
    mutate('required_status_checks', rule => ({ ...rule, parameters: { ...rule.parameters, required_status_checks: rule.parameters.required_status_checks.map((c, i) => ({ ...c, integration_id: i === 0 ? 1 : ACTIONS_APP_ID })) } })),
    // The rulesets API defaults this to true, which would block bot-authored PRs.
    mutate('pull_request', rule => ({ ...rule, parameters: { ...rule.parameters, require_extra_approval_for_unattributed_changes: true } })),
  ];
  for (const bad of rejections) assert.throws(() => assertRuleset(bad));
});

test('the protecting ruleset must be named, never guessed', () => {
  assert.equal(rulesetId('25951418'), 25951418);
  for (const blank of ['', undefined, 'main', '-1', '1.5']) assert.throws(() => rulesetId(blank));
});
