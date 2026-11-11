// UNIT boundary regressions for the consensus ladder (ADR 0046, Clarification 2026-11-11):
// what counts as verified evidence, why the expert rung is unreachable, and which anomalies
// a frequency count is allowed to read. Map-backed doubles throughout — the shared loader
// and graph double live in `./evolution-integrity-harness.mjs`.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  adapter,
  adapterGraphKey,
  anomaly,
  child,
  consensus,
  evolution,
  graphDouble,
  hooks,
  layerUri,
  onSubject,
  owner,
  proposal,
  releaseHarness,
  reward,
  space,
  target,
  vote
} from './evolution-integrity-harness.mjs';

after(() => { hooks.deregister(); releaseHarness(); });

// The evidence rung's sufficiency boundary: a recognized kind WITH provenance, or nothing.
test('evidence rung accepts only allowlisted kinds with their provenance', async (t) => {
  const detected = {
    kind: 'deterministic-contradiction',
    detected_from: 'frontmatter-primitives-and-rule-statements',
    contradiction_kind: 'property',
    target_adapter_version: target.version
  };
  const rewarded = { kind: 'reward-failure', uri: layerUri, outcome: 'failure', target_adapter_version: target.version };

  await t.test('the allowlist is exported data, not a hidden condition', () => {
    assert.deepEqual(Object.keys(consensus.EVIDENCE_SUFFICIENCY_ALLOWLIST).sort(), [
      'deterministic-contradiction',
      'reward-failure'
    ]);
    assert.deepEqual(Object.keys(consensus.EVIDENCE_SUFFICIENCY_ALLOWLIST['reward-failure'].requires).sort(), [
      'outcome', 'target_adapter_version', 'uri'
    ]);
    assert.deepEqual(Object.keys(consensus.EVIDENCE_SUFFICIENCY_ALLOWLIST['deterministic-contradiction'].requires).sort(), [
      'contradiction_kind', 'detected_from', 'target_adapter_version'
    ]);
  });

  await t.test('an arbitrary non-note key is attached, never sufficient', () => {
    const arbitrary = { observed: 'retry_limit=5', expected: 'retry_limit=3', reproduced_by: 'unit' };
    assert.equal(consensus.classifyEvidence(arbitrary), 'attached-unverified');
    const result = consensus.evaluateConsensus(proposal({ required_confirmations: 3 }), [vote({ evidence: arbitrary })]);
    assert.equal(result.evidence_class, 'none');
    assert.equal(result.decision, 'pending');
    assert.deepEqual(result.attached_unverified_evidence, ['subject|voter']);
    assert.match(result.reason, /attached but not verified-sufficient/);
  });

  await t.test('a recognized kind with its provenance is verified-sufficient', () => {
    assert.equal(consensus.classifyEvidence(detected), 'verified-sufficient');
    assert.equal(consensus.classifyEvidence(rewarded), 'verified-sufficient');
    assert.equal(consensus.classifyEvidence(undefined), 'absent');
    const result = consensus.evaluateConsensus(proposal({ required_confirmations: 1 }), [vote({ evidence: rewarded })]);
    assert.equal(result.decision, 'accept');
    assert.equal(result.evidence_class, 'evidence');
    assert.deepEqual(result.attached_unverified_evidence, []);
  });

  await t.test('a recognized kind missing or abusing provenance is not sufficient', () => {
    const missing = { kind: 'reward-failure', uri: layerUri };
    const emptyProvenance = { ...rewarded, target_adapter_version: '  ' };
    const outOfRange = [{ ...rewarded, outcome: 'success' }, { ...detected, contradiction_kind: 'semantic' }];
    assert.equal(consensus.classifyEvidence(missing), 'attached-unverified');
    assert.equal(consensus.classifyEvidence(emptyProvenance), 'attached-unverified');
    for (const payload of outOfRange) assert.equal(consensus.classifyEvidence(payload), 'attached-unverified');
    const result = consensus.evaluateConsensus(proposal({ required_confirmations: 1 }), [vote({ evidence: missing })]);
    // The vote still counts as a vote (required_confirmations: 1 accepts one observation);
    // what it must never do is arrive through the evidence rung.
    assert.equal(result.evidence_class, 'agent_vote');
    assert.equal(result.decision, 'accept');
    assert.equal(result.decided_by, 'core contradiction confirmed by subject|voter');
  });

  await t.test('decided_by and reason name the verified case, and only it', () => {
    const verified = consensus.evaluateConsensus(proposal({ required_confirmations: 1 }), [vote({ evidence: rewarded })]);
    assert.equal(verified.decided_by, 'verified evidence from subject|voter');
    assert.match(verified.reason, /sufficiency allowlist/);
    const attached = consensus.evaluateConsensus(proposal({ required_confirmations: 1 }), [
      vote({ evidence: { observed: 'retry_limit=5' } })
    ]);
    assert.notEqual(attached.decided_by, verified.decided_by);
    assert.doesNotMatch(attached.decided_by, /verified evidence/);
    const conflict = consensus.evaluateConsensus(proposal({ required_confirmations: 3 }), [
      vote({ evidence: rewarded }),
      vote({ key: 'confirmation:unit-2', actor: 'skeptic', decision: 'reject', evidence: { ...rewarded, outcome: 'failure' } })
    ]);
    assert.equal(conflict.decision, 'branch');
    assert.equal(conflict.decided_by, 'conflicting verified evidence');
  });
});

// The expert rung is unreachable by design, and says so with a value instead of a message.
test('expert authority is a structured deferral and the ladder rung stays intact', async () => {
  const f = graphDouble(proposal(), []);
  const input = { proposalKey: 'proposal:unit', actorKind: 'human_expert', decision: 'confirm', distinctChild: child.key };
  let caught;
  await onSubject('voter', async () => {
    try {
      await evolution.confirmProposal(f.graph, input);
    } catch (err) {
      caught = err;
    }
  });
  assert.ok(caught instanceof evolution.ExpertAuthorityDeferredError);
  assert.ok(caught instanceof evolution.EvolutionIntegrityError);
  assert.equal(caught.diagnostic.code, evolution.EXPERT_AUTHORITY_DEFERRED);
  assert.equal(evolution.EXPERT_AUTHORITY_DEFERRED, 'expert_authority_deferred');
  assert.equal(caught.deferral.reason, 'no-trusted-expert-role-source');
  assert.equal(caught.deferral.consensus_rung, 'authorized-human-expert');
  assert.ok(caught.diagnostic.recovery_action.length > 0);
  assert.deepEqual(f.writes, { proposals: 0, confirmations: 0, settlements: 0 });

  // Keeping the rung intact is what lets a future trusted role mapping activate it: an
  // authenticated-subject expert confirmation still decides when consensus reads it.
  const decided = consensus.evaluateConsensus(proposal({ required_confirmations: 1 }), [
    { ...vote(), actor_kind: 'human_expert' }
  ]);
  assert.equal(decided.evidence_class, 'human_authority');
  assert.equal(decided.decision, 'accept');
});

/** One anomaly row as a frequency read would return it. */
function frequencyRow(key, routesTo, sourceChild, metadata) {
  return {
    key, type: 'Anomaly', discovered_by: 'reporter', routes_to: routesTo, description: '',
    created_at: '2026-01-01T00:00:00Z', source_child: sourceChild, metadata
  };
}

// Frequency is distinct children of THIS target and THIS claim (ADR 0046 §§3–4).
test('reward frequency ignores another space and an unrelated field on the same slug', async () => {
  const f = graphDouble(null, []);
  const foreign = adapter(target.slug, 'space:unit-foreign');
  f.graph.listAnomalies = async ({ routesTo }) => [
    // Same slug, same claim, different target space: a different adapter.
    frequencyRow('anomaly:foreign', routesTo, adapterGraphKey(foreign.space, 'reporter-a'), {
      field: 'reward_failure', target_key: foreign.key, target_space_id: foreign.space
    }),
    // Same target, different contested field: a different claim.
    frequencyRow('anomaly:other-field', routesTo, adapterGraphKey(space, 'reporter-b'), {
      field: 'has_fur', target_key: target.key, target_space_id: space
    }),
    // Same target, same claim, one child reporting twice: one reporter.
    frequencyRow('anomaly:local-1', routesTo, adapterGraphKey(space, 'reporter-c'), {
      field: 'reward_failure', target_key: target.key, target_space_id: space
    }),
    frequencyRow('anomaly:local-2', routesTo, adapterGraphKey(space, 'reporter-c'), {
      field: 'reward_failure', target_key: target.key, target_space_id: space
    })
  ];

  const report = await onSubject('author', () => reward.recordRewardEvolution(owner(f), anomaly, {
    uri: layerUri, outcome: 'failure', feedback: 'unit claim'
  }));
  const stored = f.proposals.get(report.proposal);
  assert.equal(stored.evidence.distinct_children, 1);
  assert.equal(stored.evidence.frequency_met, false);
  assert.equal(stored.required_confirmations, 1);
  assert.equal(report.distinct_children, 1);
  assert.equal(report.frequency_truncated, false);

  // The same rows become three reporters only when they are the same target and claim.
  f.graph.listAnomalies = async ({ routesTo }) => ['reporter-a', 'reporter-b', 'reporter-c'].map((slug, index) =>
    frequencyRow(`anomaly:local-${index}`, routesTo, adapterGraphKey(space, slug), {
      field: 'reward_failure', target_key: target.key, target_space_id: space
    }));
  const raised = await onSubject('author', () => reward.recordRewardEvolution(owner(f), anomaly, {
    uri: layerUri, outcome: 'failure', feedback: 'second unit claim'
  }));
  const raisedRow = f.proposals.get(raised.proposal);
  assert.equal(raisedRow.evidence.distinct_children, 3);
  assert.equal(raisedRow.evidence.frequency_met, true);
  assert.equal(raisedRow.required_confirmations, 3);
});

test('a filled frequency window is surfaced as a floor, not as the population', async () => {
  const f = graphDouble(null, []);
  // Exactly one window of reporters: the read cannot prove this is all of them.
  f.graph.listAnomalies = async ({ routesTo }) => Array.from({ length: 500 }, (_, index) =>
    frequencyRow(`anomaly:window-${index}`, routesTo, adapterGraphKey(space, `reporter-${index}`), {
      field: 'reward_failure', target_key: target.key, target_space_id: space
    }));
  const report = await onSubject('author', () => reward.recordRewardEvolution(owner(f), anomaly, {
    uri: layerUri, outcome: 'failure', feedback: 'windowed claim'
  }));
  const stored = f.proposals.get(report.proposal);
  assert.equal(report.frequency_truncated, true);
  assert.equal(report.frequency_window, 500);
  assert.equal(stored.evidence.frequency_truncated, true);
  assert.equal(stored.evidence.frequency_window, 500);
  // The caller is told the count is a floor; a filled window must never read as a total.
  assert.match(report.next_action, /floor, not a population/);
});
