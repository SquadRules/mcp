// Shared doubles and in-memory TypeScript loader for the evolution UNIT suites.
//
// WHY A SHARED MODULE
// The settlement-integrity suite and the consensus/scoped-frequency suite need the same
// map-backed graph, tenant/auth, graph-owner and URI-parser doubles, and the same
// dependency allowlist: production `.ts` is loaded from this worktree with in-memory type
// stripping, so any `src` import outside `production` is a harness error. One copy is what
// makes that allowlist meaningful — a duplicated loader would let one suite resolve a
// dependency the other forbids, and a suite would then be testing a different graph than
// the one the other suite proves.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const src = new URL('../../src/', import.meta.url);
export const space = 'space:unit-evolution';
export const app = 'space:unit-app';
export const contextStore = new AsyncLocalStorage();
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
  'services/graph-db/evolution/scoped-frequency.ts',
  'services/graph-db/graph-actor.ts',
  'services/graph-db/adapter-scope.ts',
  'utils/sha256.ts',
  'tools/reward-evolution.ts'
].map((path) => new URL(path, src).href));
export const hooks = registerHooks({
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
export const evolution = await import(new URL('services/graph-db/evolution/evolution.service.ts', src));
export const consensus = await import(new URL('services/graph-db/evolution/consensus.ts', src));
export const reward = await import(new URL('tools/reward-evolution.ts', src));
export const { adapterGraphKey } = await import(new URL('services/graph-db/adapter-scope.ts', src));

/** Drop the process-global bridge; `hooks.deregister()` belongs to the suite that owns the run. */
export function releaseHarness() {
  delete globalThis[bridgeKey];
}

export function onSubject(userId, fn, allowedSpaceIds = [space, app]) {
  return contextStore.run({ userId, allowedSpaceIds, defaultWriteSpaceId: space }, fn);
}
export function adapter(slug, scope = space, version = '4.2.0') {
  return { key: adapterGraphKey(scope, slug), type: 'adapter', slug, space: scope, version };
}
export const target = adapter('parent');
export const child = adapter('child');
export function proposal(overrides = {}) {
  return {
    key: 'proposal:unit', type: 'proposal', target_key: target.key,
    target_slug: target.slug, space, change_type: 'parent_update', field: 'color',
    from_value: 'red', to_value: 'blue', reason: 'unit claim', source_child: child.key,
    evidence: { target_adapter_version: target.version }, evidence_digest: 'unit-digest-not-truth',
    status: 'proposed', created_at: '2026-01-01T00:00:00Z', created_by: 'author',
    actor_source: 'auth-subject', required_confirmations: 1, ...overrides
  };
}
export function vote(overrides = {}) {
  return {
    key: 'confirmation:unit', type: 'confirmation', proposal_key: 'proposal:unit',
    actor: 'voter', actor_kind: 'agent', actor_source: 'auth-subject',
    decision: 'confirm', distinct_child: child.key, created_at: '2026-01-01T00:00:00Z', ...overrides
  };
}
export function graphDouble(row = proposal(), votes = [vote()]) {
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
export async function settle(fixture) {
  return onSubject('voter', () => evolution.settleProposal(fixture.graph, 'proposal:unit'));
}
export function assertBlocked(result, code) {
  assert.equal(result.consensus.decision, 'pending');
  assert.equal(result.apply_plan, null);
  assert.equal(result.diagnostic.code, code);
  assert.ok(result.diagnostic.recovery_action.length > 0);
}
export function owner(f) {
  return { graph: f.graph, getMemoryByUUID: async () => ({ slug: child.slug, space_id: space }) };
}
export const layerUri = 'squadrules://layer/00000000-0000-0000-0000-000000000001';
export const anomaly = {
  child_key: child.key, space_id: space, discovered_by: child.slug, routes_to: target.slug,
  anomaly_key: 'anomaly:unit', severity: 'low', description: 'unit failed-reward claim'
};
