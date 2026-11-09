// Focused UNIT regressions. Map-backed graph, tenant/auth, graph owner, logger,
// config and URI-parser doubles. No real backend, HTTP auth, provider or apply.
// Production evolution/reward/scope/actor/hash code is loaded from this worktree
// with in-memory Node type stripping; no compiled output or install is needed.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { after, test } from 'node:test';

const src = new URL('../../src/', import.meta.url);
const space = 'space:unit-evolution';
const app = 'space:unit-app';
const contextStore = new AsyncLocalStorage();
const bridgeKey = '__evolutionIntegrityUnit';
globalThis[bridgeKey] = {
  context: () => contextStore.getStore() ?? { userId: '', allowedSpaceIds: [] },
  graph: (owner) => owner.graph
};
const doubles = new Map([
  ['config.ts', `export const SQUADRULES_APP_SPACE_ID = '${app}';`],
  ['utils/tenant-context.ts', `export const getSpaceContextFromStorage = () => globalThis.${bridgeKey}.context();`],
  ['utils/structured-logger.ts', 'export const structuredLogger = { warn() {}, debug() {} };'],
  ['services/graph-db/graph-owner.ts', `export const getGraphDb = (owner) => globalThis.${bridgeKey}.graph(owner);`],
  ['tools/squadrules-uri.ts', String.raw`export function parseSquadrulesUriOrThrow(uri) {
    const match = /^squadrules:\/\/layer\/([^?]+)(?:\?.*)?$/.exec(uri);
    if (!match) throw new Error('unit parser: not a layer');
    return { kind: 'layer', id: match[1] };
  }`]
].map(([path, source]) => [new URL(path, src).href, source]));
const production = new Set([
  'services/graph-db/evolution/evolution.service.ts',
  'services/graph-db/evolution/consensus.ts',
  'services/graph-db/evolution/evolution-proposal-record.ts',
  'services/graph-db/evolution/evolution-plans.ts',
  'services/graph-db/graph-actor.ts',
  'services/graph-db/adapter-scope.ts',
  'utils/sha256.ts',
  'tools/reward-evolution.ts'
].map((path) => new URL(path, src).href));
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('node:')) return nextResolve(specifier, context);
    if (specifier.startsWith('file:') || specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL ?? import.meta.url).href.replace(/\.js$/, '.ts');
      if (doubles.has(url) || production.has(url)) return { url, format: 'module', shortCircuit: true };
      if (url.startsWith(src.href)) throw new Error(`Unexpected production dependency in unit harness: ${url}`);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (doubles.has(url)) return { source: doubles.get(url), format: 'module', shortCircuit: true };
    if (production.has(url)) {
      return {
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { sourceUrl: url }),
        format: 'module', shortCircuit: true
      };
    }
    return nextLoad(url, context);
  }
});
const evolution = await import(new URL('services/graph-db/evolution/evolution.service.ts', src));
const consensus = await import(new URL('services/graph-db/evolution/consensus.ts', src));
const reward = await import(new URL('tools/reward-evolution.ts', src));
const { adapterGraphKey } = await import(new URL('services/graph-db/adapter-scope.ts', src));
after(() => { hooks.deregister(); delete globalThis[bridgeKey]; });

function onSubject(userId, fn, allowedSpaceIds = [space, app]) {
  return contextStore.run({ userId, allowedSpaceIds, defaultWriteSpaceId: space }, fn);
}
function adapter(slug, scope = space, version = '4.2.0') {
  return { key: adapterGraphKey(scope, slug), type: 'adapter', slug, space: scope, version };
}
const target = adapter('parent');
const child = adapter('child');
function proposal(overrides = {}) {
  return {
    key: 'proposal:unit', type: 'proposal', target_key: target.key,
    target_slug: target.slug, space, change_type: 'parent_update', field: 'color',
    from_value: 'red', to_value: 'blue', reason: 'unit claim', source_child: child.key,
    evidence: { target_adapter_version: target.version }, evidence_digest: 'unit-digest-not-truth',
    status: 'proposed', created_at: '2026-01-01T00:00:00Z', created_by: 'author',
    actor_source: 'auth-subject', required_confirmations: 1, ...overrides
  };
}
function vote(overrides = {}) {
  return {
    key: 'confirmation:unit', type: 'confirmation', proposal_key: 'proposal:unit',
    actor: 'voter', actor_kind: 'agent', actor_source: 'auth-subject',
    decision: 'confirm', distinct_child: child.key, created_at: '2026-01-01T00:00:00Z', ...overrides
  };
}
function graphDouble(row = proposal(), votes = [vote()]) {
  const proposals = new Map(row ? [[row.key, structuredClone(row)]] : []);
  const adapters = new Map([target, child].map((node) => [node.key, structuredClone(node)]));
  const confirmations = new Map(votes.map((node) => [node.key, structuredClone(node)]));
  const writes = { proposals: 0, confirmations: 0, settlements: 0 };
  const graph = {
    isInitialized: () => true,
    getAdapter: async (key) => structuredClone(adapters.get(key) ?? null),
    getProposal: async (key) => structuredClone(proposals.get(key) ?? null),
    createProposal: async (node) => { writes.proposals++; proposals.set(node.key, structuredClone(node)); },
    listConfirmations: async (key) => [...confirmations.values()].filter((node) => node.proposal_key === key).map((node) => structuredClone(node)),
    recordConfirmation: async (node) => { writes.confirmations++; confirmations.set(node.key, structuredClone(node)); },
    updateProposalStatus: async (key, status, metadata) => {
      writes.settlements++;
      const previous = proposals.get(key);
      if (previous) proposals.set(key, { ...previous, status, metadata });
    },
    findPathToRoot: async (key) => key === child.key ? [{ ancestor: structuredClone(target), depth: 1 }] : [],
    listAnomalies: async () => []
  };
  return { graph, proposals, adapters, confirmations, writes };
}
async function settle(fixture) {
  return onSubject('voter', () => evolution.settleProposal(fixture.graph, 'proposal:unit'));
}
function assertBlocked(result, code) {
  assert.equal(result.consensus.decision, 'pending');
  assert.equal(result.apply_plan, null);
  assert.equal(result.diagnostic.code, code);
  assert.ok(result.diagnostic.recovery_action.length > 0);
}

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
    ['expert claim', 'expert_authority_unavailable', (f, input) => { input.actorKind = 'human_expert'; }]
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

function owner(f) {
  return { graph: f.graph, getMemoryByUUID: async () => ({ slug: child.slug, space_id: space }) };
}
const layerUri = 'squadrules://layer/00000000-0000-0000-0000-000000000001';
const anomaly = {
  child_key: child.key, space_id: space, discovered_by: child.slug, routes_to: target.slug,
  anomaly_key: 'anomaly:unit', severity: 'low', description: 'unit failed-reward claim'
};

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
