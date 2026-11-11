// Focused UNIT regressions for settlement integrity: what a durable settlement must
// refuse, and what it must prove before an apply plan exists. The map-backed graph,
// tenant/auth doubles and the in-memory TypeScript loader live in
// `./evolution-integrity-harness.mjs`, so the dependency allowlist has one owner.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  adapter,
  adapterGraphKey,
  anomaly,
  app,
  assertBlocked,
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
  settle,
  space,
  target,
  vote
} from './evolution-integrity-harness.mjs';

after(() => { hooks.deregister(); releaseHarness(); });

test('failed settlement does not claim local acceptance or supply a plan (unit persistence double)', async () => {
  const f = graphDouble();
  const before = structuredClone([...f.adapters]);
  f.graph.updateProposalStatus = async () => { throw new Error('unit write failure'); };
  const result = await settle(f);
  assertBlocked(result, 'settlement_persistence_failed');
  assert.equal(result.proposal.status, 'proposed');
  assert.equal(f.proposals.get('proposal:unit').status, 'proposed');
  assert.deepEqual([...f.adapters], before);
});

test('readback is mandatory: no-op write, conflicting status and unreadable outcome are blocked', async (t) => {
  for (const mode of ['no-op', 'conflict', 'unreadable']) {
    await t.test(mode, async () => {
      const f = graphDouble();
      if (mode === 'no-op') f.graph.updateProposalStatus = async () => {};
      if (mode === 'conflict') f.graph.updateProposalStatus = async () => { f.proposals.get('proposal:unit').status = 'rejected'; };
      if (mode === 'unreadable') {
        const update = f.graph.updateProposalStatus;
        f.graph.updateProposalStatus = async (...args) => {
          await update(...args);
          f.graph.getProposal = async () => { throw new Error('unit read failure'); };
        };
      }
      const result = await settle(f);
      assertBlocked(result, mode === 'unreadable' ? 'settlement_unverified' : 'settlement_conflict');
      assert.equal(result.proposal.status, 'proposed');
      if (mode === 'unreadable') assert.equal(f.proposals.get('proposal:unit').status, 'accepted'); // not rollback proof
    });
  }
});

test('observed durable acceptance supplies scoped/versioned plan without adapter mutation; retry is idempotent', async () => {
  const f = graphDouble();
  const before = structuredClone([...f.adapters]);
  const result = await settle(f);
  assert.equal(result.proposal.status, 'accepted');
  assert.equal(result.diagnostic, null);
  assert.equal(result.apply_plan.target_key, target.key);
  assert.equal(result.apply_plan.target_space, space);
  assert.equal(result.apply_plan.expected_version, target.version);
  assert.match(result.apply_plan.instructions, /normal tune/);
  assert.deepEqual([...f.adapters], before);
  await settle(f);
  assert.equal(f.writes.settlements, 1);
});

test('observed target drift during settlement suppresses the plan without claiming rollback', async () => {
  const f = graphDouble();
  const update = f.graph.updateProposalStatus;
  f.graph.updateProposalStatus = async (...args) => {
    await update(...args);
    f.adapters.get(target.key).version = '5.0.0'; // injected concurrent change, not service apply
  };
  const result = await settle(f);
  assertBlocked(result, 'target_version_conflict');
  assert.equal(result.proposal.status, 'accepted'); // real unit-double readback, no invented rollback
  assert.equal(f.proposals.get('proposal:unit').status, 'accepted');
});

test('settlement writes also enforce existing scope access, including rejection', async () => {
  const f = graphDouble(proposal(), [vote({ decision: 'reject' })]);
  const result = await onSubject('voter', () => evolution.settleProposal(f.graph, 'proposal:unit'), ['space:other']);
  assertBlocked(result, 'scope_forbidden');
  assert.equal(f.writes.settlements, 0);
});

test('terminal settlement is not overwritten by a different local consensus decision', async () => {
  const f = graphDouble(proposal({ status: 'rejected' }));
  assertBlocked(await settle(f), 'settlement_conflict');
  assert.equal(f.writes.settlements, 0);
  assert.equal(f.proposals.get('proposal:unit').status, 'rejected');
});

test('missing, unreadable, cross-scope or stale target/version never creates actionable acceptance', async (t) => {
  for (const mode of ['missing', 'unavailable', 'scope', 'stale', 'missing-version', 'unversioned-proposal']) {
    await t.test(mode, async () => {
      const f = graphDouble();
      const codes = {
        missing: 'target_missing', unavailable: 'target_unavailable', scope: 'target_scope_mismatch',
        stale: 'target_version_conflict', 'missing-version': 'target_version_missing', 'unversioned-proposal': 'target_version_missing'
      };
      if (mode === 'missing') f.adapters.delete(target.key);
      if (mode === 'unavailable') f.graph.getAdapter = async () => { throw new Error('unit read error'); };
      if (mode === 'scope') f.adapters.get(target.key).space = 'space:other';
      if (mode === 'stale') f.adapters.get(target.key).version = '5.0.0';
      if (mode === 'missing-version') f.adapters.get(target.key).version = '';
      if (mode === 'unversioned-proposal') f.proposals.get('proposal:unit').evidence = {};
      assertBlocked(await settle(f), codes[mode]);
      assert.equal(f.writes.settlements, 0);
    });
  }
  assert.equal(evolution.buildApplyPlan(proposal({ evidence: {} })), null);
});

test('unknown/self/unauthenticated/foreign/unrelated/nonpending/expert confirmations reject before any unit write', async (t) => {
  const cases = [
    ['unknown', 'proposal_missing', (f, input) => { input.proposalKey = 'proposal:unknown'; }],
    ['self', 'self_confirmation_forbidden', () => {}, ' author '],
    ['no subject', 'authenticated_subject_required', () => {}, ''],
    ['nonpending', 'proposal_not_pending', (f) => { f.proposals.get('proposal:unit').status = 'accepted'; }],
    ['foreign scope', 'scope_forbidden', () => {}, 'voter', ['space:other']],
    ['missing child', 'confirmation_child_missing', (f) => { f.adapters.delete(child.key); }],
    ['missing target', 'target_missing', (f) => { f.adapters.delete(target.key); }],
    ['no attribution', 'confirmation_scope_mismatch', (f, input) => { delete input.distinctChild; }],
    ['cross-scope child', 'confirmation_scope_mismatch', (f, input) => { input.distinctChild = adapterGraphKey(app, child.slug); }],
    ['unrelated child', 'confirmation_child_unrelated', (f) => { f.graph.findPathToRoot = async () => []; }],
    ['same-slug foreign target', 'confirmation_child_unrelated', (f) => { f.graph.findPathToRoot = async () => [{ ancestor: adapter(target.slug, app) }]; }],
    // The refusal is a stable, exported code — not the message the caller once matched.
    ['expert claim', evolution.EXPERT_AUTHORITY_DEFERRED, (f, input) => { input.actorKind = 'human_expert'; }]
  ];
  for (const [name, code, mutate, subject = 'voter', allowed = [space, app]] of cases) {
    await t.test(name, async () => {
      const f = graphDouble(proposal(), []);
      const input = { proposalKey: 'proposal:unit', actorKind: 'agent', decision: 'confirm', distinctChild: child.key };
      mutate(f, input);
      await assert.rejects(onSubject(subject, () => evolution.confirmProposal(f.graph, input), allowed), (err) => err.diagnostic?.code === code);
      assert.deepEqual(f.writes, { proposals: 0, confirmations: 0, settlements: 0 });
    });
  }
});

test('same authenticated subject plus retries collapse regardless of claimed kind; notes are not empirical', async () => {
  const f = graphDouble(proposal({ required_confirmations: 3 }), []);
  const input = { proposalKey: 'proposal:unit', actorKind: 'agent', decision: 'confirm', distinctChild: child.key };
  const first = await onSubject('voter', () => evolution.confirmProposal(f.graph, input));
  const retry = await onSubject('voter', () => evolution.confirmProposal(f.graph, input));
  assert.equal(first.key, retry.key);
  assert.equal(f.confirmations.size, 1);
  const rows = [first, { ...first, key: 'unit-other-kind', actor_kind: 'human_expert' }];
  assert.equal(consensus.evaluateConsensus(proposal({ required_confirmations: 3 }), rows).confirming_actors.length, 1);
  const result = consensus.evaluateConsensus(proposal({ required_confirmations: 3 }), [vote({ evidence: { note: 'unverified claim' } })]);
  assert.equal(result.evidence_class, 'none');
  assert.equal(result.decision, 'pending');
});

test('reward records the observed target version and only the settled plan is returned', async () => {
  const f = graphDouble(null, []);
  const q = owner(f);
  const recorded = await onSubject('author', () => reward.recordRewardEvolution(q, anomaly, { uri: layerUri, outcome: 'failure', feedback: 'unit claim' }));
  const row = f.proposals.get(recorded.proposal);
  assert.equal(row.target_key, target.key);
  assert.equal(row.space, space);
  assert.equal(row.evidence.target_adapter_version, target.version);
  assert.equal(recorded.apply_plan, null);
  const report = await onSubject('voter', () => reward.recordRewardProposalDecision(q, {
    uri: layerUri, proposal: row.key, proposal_decision: 'confirm', feedback: 'ordinary feedback'
  }));
  assert.equal([...f.confirmations.values()][0].evidence, undefined);
  assert.equal(report.apply_plan.expected_version, target.version);
  assert.equal(report.apply_plan.target_space, space);
  // Bare-vote acceptance is existing policy, not empirical positive evidence.
  assert.match(report.decided_by, /core contradiction confirmed/);
});

test('reward target read failure stops before proposal write and does not fall back to an app target', async () => {
  const f = graphDouble(null, []);
  const seen = [];
  f.graph.getAdapter = async (key) => {
    seen.push(key);
    if (key === target.key) throw new Error('unit unavailable');
    return adapter(target.slug, app);
  };
  const report = await onSubject('author', () => reward.recordRewardEvolution(owner(f), anomaly, { uri: layerUri, outcome: 'failure' }));
  assert.equal(report.diagnostic.code, 'target_unavailable');
  assert.equal(report.apply_plan, null);
  assert.deepEqual(seen, [target.key]);
  assert.equal(f.writes.proposals, 0);
});

test('reward missing targets/versions refuse proposals and app fallback requires successful own-scope absence', async (t) => {
  for (const mode of ['missing', 'missing-version', 'app-fallback']) {
    await t.test(mode, async () => {
      const f = graphDouble(null, []);
      if (mode === 'missing-version') f.adapters.get(target.key).version = '';
      else f.adapters.delete(target.key);
      if (mode === 'app-fallback') {
        const appTarget = adapter(target.slug, app, '7.1.0');
        f.adapters.set(appTarget.key, appTarget);
      }
      const report = await onSubject('author', () => reward.recordRewardEvolution(owner(f), anomaly, { uri: layerUri, outcome: 'failure' }));
      assert.equal(report.apply_plan, null);
      if (mode === 'app-fallback') {
        const row = f.proposals.get(report.proposal);
        assert.equal(row.target_key, adapterGraphKey(app, target.slug));
        assert.equal(row.space, app);
        assert.equal(row.evidence.target_adapter_version, '7.1.0');
      } else {
        assert.equal(report.diagnostic.code, mode === 'missing' ? 'target_missing' : 'target_version_missing');
        assert.equal(f.writes.proposals, 0);
      }
    });
  }
});

test('feedback-only reward confirmation is a bare vote, not empirical evidence', async () => {
  const f = graphDouble(proposal({ required_confirmations: 3 }), []);
  const report = await onSubject('voter', () => reward.recordRewardProposalDecision(owner(f), {
    uri: layerUri, proposal: 'proposal:unit', proposal_decision: 'confirm', feedback: 'unit claim'
  }));
  assert.equal(report.decision, 'pending');
  assert.equal([...f.confirmations.values()][0].evidence, undefined);
  const loaded = await evolution.loadConsensus(f.graph, 'proposal:unit');
  assert.equal(loaded.consensus.evidence_class, 'none');
});

test('reward bridge cannot reconstruct an accepted apply plan after failed persistence', async () => {
  const f = graphDouble(proposal(), []);
  f.graph.updateProposalStatus = async () => { throw new Error('unit failed persistence'); };
  const report = await onSubject('voter', () => reward.recordRewardProposalDecision(owner(f), {
    uri: layerUri, proposal: 'proposal:unit', proposal_decision: 'confirm', feedback: 'unit note'
  }));
  assert.equal(report.status, 'proposed');
  assert.equal(report.decision, 'pending');
  assert.equal(report.apply_plan, null);
  assert.equal(report.diagnostic.code, 'settlement_persistence_failed');
  assert.match(report.next_action, /^blocked:/);
});
