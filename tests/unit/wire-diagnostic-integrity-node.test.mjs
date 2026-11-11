// Focused UNIT checks, not HTTP/native integration or TypeScript typechecking.
// Actual dispatcher, typed error helpers, URI parser, Zod schemas and JSON-schema
// converter. Tenant/space resolution, markdown writer, update/URI resolution and
// review gate are explicit unit doubles. The review double checks no proof and
// authorizes no real write; no fabricated review evidence is supplied.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { after, test } from 'node:test';
import ts from 'typescript';

// Node 26 strips erasable types only. Two small helpers use parameter properties;
// transpileModule handles those in memory, with no TS program/typecheck or output.
const nonErasable = new Set(['tools/version-cas.ts', 'types/index.ts']);
const src = new URL('../../src/', import.meta.url);
const bridgeKey = '__wireDiagnosticIntegrityUnit';
const state = { error: undefined, reviewCalls: 0 };
globalThis[bridgeKey] = state;
const doubles = new Map([
  ['utils/tenant-context.ts', "export const getSpaceContextFromStorage = () => ({ allowedSpaceIds: ['space:unit'] });"],
  ['utils/resolve-space-param.ts', "export const resolveSpaceParamForContext = () => ({ ok: true, spaceId: 'space:unit' });"],
  ['tools/review-evidence-check.ts', `export const assertReviewEvidencePassed = () => { globalThis.${bridgeKey}.reviewCalls++; };`],
  ['tools/tune-adapter-markdown.ts', `export const tuneAdapterMarkdownInPlace = async () => { throw globalThis.${bridgeKey}.error; };`],
  ['tools/update.ts', "export const executeUpdate = async () => ({ results: [{ uri: 'squadrules://layer/11111111-1111-4111-8111-111111111111', status: 'updated', message: 'unit update' }] });"],
  ['tools/tune-uri-resolution.ts', `
    export const assertTuneExpectedVersionForTarget = async () => {};
    export const collectLayerMemoryUuidsForTune = async () => [];
    export const normalizeTuneUri = async (_, uri) => uri;
    export const readAdapterRecordsByUuid = async () => null;
    export const reassignAdapterLayersToSpace = async () => {};
  `],
  // The derived pass and its lock are graph bookkeeping, not part of the diagnostic wire
  // shape this bounded check exercises. Doubling them keeps the real dispatcher under
  // test without pulling the whole graph subsystem (and its native backends) in.
  ['services/graph-db/adapter-write-lock.ts', `
    export const adapterIdentityLockKey = (id) => \`lock:\${id}\`;
    export const withAdapterWriteLock = async (_key, operation) => operation();
    export const adapterWriteLockDepth = () => 0;
  `],
  ['services/graph-db/adapter-write-finalize.ts', `
    export const finalizeAdapterMutation = async () => ({
      graph_degraded: false, projection: null,
      history: {
        version: null, anomaly_key: null, proposal_keys: [], skipped: null, no_change: false,
        change_type: null, snapshot_source: null, content_digest: null, degraded: []
      },
      snapshot_source: null, content_digest: null, degradations: [], residuals: []
    });
  `]
].map(([path, source]) => [new URL(path, src).href, source]));
const production = new Set([
  'tools/tune-execute.ts', 'tools/tune_schema.ts', 'tools/reward_schema.ts',
  'tools/version-cas.ts', 'tools/squadrules-uri.ts', 'tools/tune-messages.ts',
  'types/index.ts', 'utils/protocol-slug.ts', 'utils/zod-to-jsonschema.ts',
  'services/graph-db/inheritance-write-validation.ts',
  'services/graph-db/adapter-inheritance.ts'
].map((path) => new URL(path, src).href));
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('file:') || specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL ?? import.meta.url).href.replace(/\.js$/, '.ts');
      if (production.has(url) || doubles.has(url)) return { url, format: 'module', shortCircuit: true };
      if (url.startsWith(src.href)) throw new Error(`Unexpected dependency in bounded unit check: ${url}`);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (doubles.has(url)) return { source: doubles.get(url), format: 'module', shortCircuit: true };
    if (production.has(url)) return {
      source: nonErasable.has(url.slice(src.href.length))
        ? ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
        }).outputText
        : stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { sourceUrl: url }),
      format: 'module', shortCircuit: true
    };
    return nextLoad(url, context);
  }
});
const { executeTune } = await import(new URL('tools/tune-execute.ts', src));
const { tuneOutputSchema } = await import(new URL('tools/tune_schema.ts', src));
const { rewardOutputSchema } = await import(new URL('tools/reward_schema.ts', src));
const { InheritanceValidationUnavailableError } = await import(new URL('services/graph-db/inheritance-write-validation.ts', src));
const { VersionConflictError, VersionGuardUnsupportedError, versionGuardPayload } = await import(new URL('tools/version-cas.ts', src));
const { zodToOutputJsonSchema } = await import(new URL('utils/zod-to-jsonschema.ts', src));
after(() => { hooks.deregister(); delete globalThis[bridgeKey]; });

const uri = 'squadrules://adapter/unit-child';
const tuneInput = { uris: [uri], content: ['unit markdown dispatch input, not a reviewed adapter'] };
const json = (value) => JSON.parse(JSON.stringify(value));
async function tuneFailure(error) {
  state.error = error;
  const output = await executeTune({}, tuneInput);
  assert.equal(output.total_failed, 1);
  assert.equal(output.total_updated, 0);
  assert.equal(output.results[0].status, 'error');
  assert.equal(output.results[0].message, `Failed to update adapter layer: ${error instanceof Error ? error.message : String(error)}`);
  assert.deepEqual(tuneOutputSchema.parse(json(output)), json(output));
  return output.results[0];
}

for (const reason of ['scope_unavailable', 'source_unavailable', 'read_unavailable']) {
  test(`typed ${reason} retains code/status/details in dispatcher + JSON + actual Zod parse`, async () => {
    const error = new InheritanceValidationUnavailableError(reason, 'unit-parent', reason === 'scope_unavailable' ? '' : 'space:unit');
    assert.equal(versionGuardPayload(error), undefined);
    const row = await tuneFailure(error);
    assert.deepEqual(row.error, { code: error.code, status: error.status, details: error.details });
    assert.equal(row.error.details.reason, reason);
    assert.equal(row.error.details.must_obey, true);
    assert.ok(row.error.details.next_action.length > 0);
    assert.equal('expected' in row.error, false);
    assert.equal('current' in row.error, false);
  });
}

test('details record retains non-version nested diagnostic data through the schema parser', async () => {
  const error = new InheritanceValidationUnavailableError('read_unavailable', 'unit-parent', 'space:unit');
  error.details.unit_extra = { nested: ['unit data', null], count: 2 };
  const row = await tuneFailure(error);
  assert.deepEqual(row.error.details, error.details);
});

test('structural/ordinary/message-only/lookalike errors are not relabeled unavailable', async () => {
  for (const error of [
    new Error('Inheritance validation failed: [structural_override_forbidden] unit veto'),
    new Error('INHERITANCE_VALIDATION_UNAVAILABLE: unit message only'),
    Object.assign(new Error('unit lookalike'), { code: 'INHERITANCE_VALIDATION_UNAVAILABLE', status: 'unavailable', details: {} }),
    'unit non-Error failure'
  ]) {
    const row = await tuneFailure(error);
    assert.equal('error' in row, false);
  }
});

test('both existing version guard variants preserve their payload/message and parse', async () => {
  const conflict = new VersionConflictError('VERSION_CONFLICT: unit stale', { target: uri, expected: '1.0.0', actual: '2.0.0' });
  assert.deepEqual((await tuneFailure(conflict)).error, { code: conflict.code, target: uri, expected: '1.0.0', current: '2.0.0' });
  const unsupported = new VersionGuardUnsupportedError('VERSION_GUARD_UNSUPPORTED: unit unknown', { target: uri, expected: '1.0.0', reason: 'unit missing head' });
  assert.deepEqual((await tuneFailure(unsupported)).error, { code: unsupported.code, target: uri, expected: '1.0.0', reason: 'unit missing head' });
});

test('ordinary successful update row remains diagnostic-free', async () => {
  const output = await executeTune({}, { uris: [uri], updates: { unit: true } });
  assert.equal(output.total_updated, 1);
  assert.equal(output.total_failed, 0);
  assert.equal('error' in output.results[0], false);
  assert.deepEqual(tuneOutputSchema.parse(json(output)), json(output));
});

function rewardReport(evolution) {
  return { results: [], total_rated: 0, total_failed: 0, ...(evolution === undefined ? {} : { evolution }), next_call: null };
}
const emptyEvolution = {
  proposal: null, status: null, decision: null, decided_by: null,
  required_confirmations: null, distinct_children: null, anomaly: null,
  apply_plan: null, next_action: 'unit no plan'
};
const plan = {
  target_uri: 'squadrules://adapter/unit-parent', target_key: 'adapter:space:unit:unit-parent',
  target_space: 'space:unit', expected_version: '4.2.0', field: 'unit-field',
  from_value: null, to_value: 'unit-value', instructions: 'unit schema fixture, no apply performed'
};

test('reward report preserves omitted, undefined, null and populated diagnostic behavior', () => {
  for (const evolution of [
    undefined, emptyEvolution,
    { ...emptyEvolution, diagnostic: undefined },
    { ...emptyEvolution, diagnostic: null },
    { ...emptyEvolution, diagnostic: { code: 'settlement_unverified', recovery_action: 'unit restore reads' } }
  ]) {
    const output = rewardReport(evolution);
    assert.deepEqual(rewardOutputSchema.parse(output), output);
    assert.deepEqual(rewardOutputSchema.parse(json(output)), json(output));
  }
});

test('reward apply plan retains target space and nonnull observed-version fixture through parse', () => {
  const output = rewardReport({ ...emptyEvolution, apply_plan: plan, diagnostic: null });
  const parsed = rewardOutputSchema.parse(json(output));
  assert.deepEqual(parsed, output);
  assert.equal(parsed.evolution.apply_plan.expected_version, '4.2.0');
  assert.equal(parsed.evolution.apply_plan.target_space, 'space:unit');
});

test('reward rejects missing/empty/null plan version and missing/empty target space; null plan remains valid', () => {
  for (const version of [undefined, null, '']) {
    const output = rewardReport({ ...emptyEvolution, apply_plan: { ...plan, expected_version: version } });
    assert.equal(rewardOutputSchema.safeParse(output).success, false);
  }
  for (const targetSpace of [undefined, '']) {
    assert.equal(rewardOutputSchema.safeParse(rewardReport({ ...emptyEvolution, apply_plan: { ...plan, target_space: targetSpace } })).success, false);
  }
  assert.equal(rewardOutputSchema.safeParse(rewardReport(emptyEvolution)).success, true);
});

test('malformed structured diagnostics fail actual schema validation', () => {
  for (const error of [
    { code: 'INHERITANCE_VALIDATION_UNAVAILABLE', status: 'error', details: {} },
    { code: 'INHERITANCE_VALIDATION_UNAVAILABLE', status: 'unavailable' },
    { code: 'INHERITANCE_VALIDATION_UNAVAILABLE', status: 'unavailable', details: null }
  ]) {
    assert.equal(tuneOutputSchema.safeParse({ results: [{ uri, status: 'error', message: 'unit failure', error }], total_updated: 0, total_failed: 1 }).success, false);
  }
  assert.equal(rewardOutputSchema.safeParse(rewardReport({ ...emptyEvolution, diagnostic: { code: 'unit missing recovery' } })).success, false);
});

test('actual tools/list converter advertises separate tune diagnostic union without empty-schema fallback', () => {
  const advertised = zodToOutputJsonSchema(tuneOutputSchema);
  const row = advertised.properties.results.items;
  const variants = row.properties.error.anyOf;
  assert.equal(variants.length, 2);
  assert.deepEqual(variants[0].properties.code.enum, ['VERSION_CONFLICT', 'VERSION_GUARD_UNSUPPORTED']);
  assert.equal(variants[1].properties.code.const, 'INHERITANCE_VALIDATION_UNAVAILABLE');
  assert.equal(variants[1].properties.status.const, 'unavailable');
  assert.deepEqual(variants[1].required, ['code', 'status', 'details']);
  assert.equal(row.required.includes('error'), false);
});

test('actual tools/list converter advertises optional/nullable reward diagnostic and nullable versioned scoped plan', () => {
  const advertised = zodToOutputJsonSchema(rewardOutputSchema);
  const evolution = advertised.properties.evolution;
  assert.equal(advertised.required.includes('evolution'), false);
  assert.equal(evolution.required.includes('diagnostic'), false);
  assert.ok(evolution.properties.diagnostic.anyOf.some((variant) => variant.type === 'null'));
  const diagnostic = evolution.properties.diagnostic.anyOf.find((variant) => variant.type === 'object');
  assert.deepEqual(diagnostic.required, ['code', 'recovery_action']);
  const planVariants = evolution.properties.apply_plan.anyOf;
  assert.ok(planVariants.some((variant) => variant.type === 'null'));
  const advertisedPlan = planVariants.find((variant) => variant.type === 'object');
  assert.ok(advertisedPlan.required.includes('target_space'));
  assert.ok(advertisedPlan.required.includes('expected_version'));
  assert.equal(advertisedPlan.properties.expected_version.type, 'string');
  assert.equal(advertisedPlan.properties.expected_version.minLength, 1);
  assert.equal(advertisedPlan.properties.target_space.type, 'string');
});
