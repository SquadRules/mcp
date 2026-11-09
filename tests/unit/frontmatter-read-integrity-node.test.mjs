// Focused UNIT tests loading the actual pure parser and read/accessor source.
// Record rows, backend/connection, auth context, ID validation, metrics and config
// are explicit unit doubles. No native DB, persistence, auth integration or
// TypeScript typecheck is exercised. Hostile parser inputs run in fresh VM realms
// with separate built-in prototypes, never through the shared-process parser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const src = new URL('../../src/', import.meta.url);
const bridgeKey = '__frontmatterReadIntegrityUnit';
const appSpace = 'app:unit';
const allowedSpace = 'user:unit:allowed';
const deniedSpace = 'user:unit:denied';
const uuid = '11111111-1111-4111-8111-111111111111';
const state = { allowedSpaceIds: [allowedSpace], validatedIds: [], metricCalls: [] };
globalThis[bridgeKey] = state;
const doubles = new Map([
  ['config.ts', `export const SQUADRULES_APP_SPACE_ID = '${appSpace}';`],
  ['utils/tenant-context.ts', `
    export const getSpaceContext = () => ({ allowedSpaceIds: globalThis.${bridgeKey}.allowedSpaceIds });
    export const getTenantId = () => 'unit-tenant';
    export const getSearchSpaceIds = () => globalThis.${bridgeKey}.allowedSpaceIds;
  `],
  ['services/qdrant/connection.ts', 'export class QdrantConnection {}'],
  ['services/qdrant/utils.ts', `export const validateAndConvertId = (id) => {
    globalThis.${bridgeKey}.validatedIds.push(id); return id;
  };`],
  ['services/metrics/qdrant-metrics.ts', `
    export const qdrantOperations = { inc: (labels) => globalThis.${bridgeKey}.metricCalls.push(labels) };
    export const qdrantOperationDuration = { startTimer: () => () => {} };
  `],
  ['utils/space-filter.ts', `
    export const buildSpaceFilter = () => { throw new Error('Unexpected scroll in read UNIT test'); };
    export const buildAdapterSiblingScrollFilter = buildSpaceFilter;
  `],
  ['tools/artifact-mime.ts', 'export const ALLOWED_ARTIFACT_MIMES = [];'],
  ['utils/structured-logger.ts', 'export const structuredLogger = { warn: () => {} };'],
  ['services/memory/memory-accessors.ts', `export const getPayloadAdapterVersion = () => {
    throw new Error('Unexpected version lookup in read UNIT test');
  };`]
].map(([path, source]) => [new URL(path, src).href, source]));
const lanceUrl = new URL('services/vector-store/lancedb/lance-records-reads.ts', src).href;
const parserUrl = new URL('utils/frontmatter.ts', src);
const production = new Set([
  parserUrl.href, lanceUrl,
  new URL('services/qdrant/memory-retrieval.ts', src).href,
  new URL('services/memory/qdrant-point-to-memory.ts', src).href
]);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('file:') || specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL ?? import.meta.url).href.replace(/\.js$/, '.ts');
      if (production.has(url) || doubles.has(url)) return { url, format: 'module', shortCircuit: true };
      if (url.startsWith(src.href)) throw new Error(`Unexpected dependency in bounded read UNIT test: ${url}`);
    }
    if (context.parentURL?.startsWith(src.href) && !specifier.startsWith('node:')) {
      throw new Error(`Unexpected external dependency in bounded read UNIT test: ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (doubles.has(url)) return { source: doubles.get(url), format: 'module', shortCircuit: true };
    if (production.has(url)) {
      const source = readFileSync(new URL(url), 'utf8');
      return {
        // Node 26 strips erasable syntax only. Lance's constructor parameter
        // property requires this one-file in-memory transpilation on Node 24/26.
        source: url === lanceUrl
          ? ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
          }).outputText
          : stripTypeScriptTypes(source, { sourceUrl: url }),
        format: 'module', shortCircuit: true
      };
    }
    return nextLoad(url, context);
  }
});
const { parseFrontmatter } = await import(parserUrl);
const { LanceRecordReader } = await import(lanceUrl);
const qdrant = await import(new URL('services/qdrant/memory-retrieval.ts', src));
const { pointToMemory } = await import(new URL('services/memory/qdrant-point-to-memory.ts', src));
after(() => { hooks.deregister(); delete globalThis[bridgeKey]; });

// Trusted source is transformed only to remove the ESM export for VM execution.
// No parser implementation is copied and no hostile text is interpolated as code.
const parserModule = stripTypeScriptTypes(readFileSync(parserUrl, 'utf8'), { sourceUrl: parserUrl.href });
assert.equal((parserModule.match(/^export function parseFrontmatter\b/gm) ?? []).length, 1);
const parserScript = parserModule.replace(/^export function parseFrontmatter\b/m, 'function parseFrontmatter');
function isolatedParse(doc, seedInherited = false) {
  return JSON.parse(runInNewContext(`${parserScript}
    const inheritedDomain = { inherited_leaf: 'unit inherited' };
    const inheritedAnomaly = { type: 'unit phantom' };
    if (seedInherited) {
      Object.defineProperty(Object.prototype, 'domain', { value: inheritedDomain, configurable: true, writable: true });
      Object.defineProperty(Object.prototype, 'anomaly', { value: inheritedAnomaly, configurable: true, writable: true });
    }
    const targets = [Object.prototype, Object, inheritedDomain, inheritedAnomaly];
    const snapshots = targets.map((target) => Object.getOwnPropertyDescriptors(target));
    const parsed = parseFrontmatter(doc);
    const unchanged = targets.every((target, index) => {
      const before = snapshots[index];
      const after = Object.getOwnPropertyDescriptors(target);
      const keys = Reflect.ownKeys(before);
      return keys.length === Reflect.ownKeys(after).length && keys.every((key) => {
        const a = before[key], b = after[key];
        return b && a.value === b.value && a.get === b.get && a.set === b.set &&
          a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable;
      });
    });
    const ordinaryMaps = Object.getPrototypeOf(parsed.fields) === Object.prototype &&
      Object.getPrototypeOf(parsed.nested) === Object.prototype &&
      Object.values(parsed.nested).every((block) => Object.getPrototypeOf(block) === Object.prototype);
    JSON.stringify({ parsed, unchanged, ordinaryMaps });
  `, { doc, seedInherited }, { timeout: 1000 }));
}

for (const key of ['__proto__', 'constructor', 'prototype', '__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE']) {
  test(`parser filters ${key} at scalar, block and leaf writes in fresh UNIT realms`, () => {
    for (const declarations of [
      `${key}: unit bad\nsafe: unit good`,
      `${key}:\n  unit_probe: unit bad\nsafe: unit good`,
      `domain:\n  before: one\n  ${key}: unit bad\n  after: two`,
      `domain:\n  before: one\n  ${key}:\n  after: two`
    ]) {
      const { parsed, unchanged, ordinaryMaps } = isolatedParse(`---\n${declarations}\n---\n# Body`);
      assert.equal(unchanged, true);
      assert.equal(ordinaryMaps, true);
      for (const map of [parsed.fields, parsed.nested, ...Object.values(parsed.nested)]) {
        for (const forbidden of ['__proto__', 'constructor', 'prototype']) assert.equal(Object.hasOwn(map, forbidden), false);
      }
      if (parsed.nested.domain) assert.deepEqual(parsed.nested.domain, { before: 'one', after: 'two' });
      else assert.equal(parsed.fields.safe, 'unit good');
    }
  });
}

test('parser reuses only own duplicate blocks and does not synthesize an inherited anomaly (isolated UNIT realm)', () => {
  const { parsed, unchanged, ordinaryMaps } = isolatedParse('---\ndomain:\n  first: one\ndomain:\n  second: two\n---\n# Body', true);
  assert.equal(unchanged, true);
  assert.equal(ordinaryMaps, true);
  assert.deepEqual(parsed.nested.domain, { first: 'one', second: 'two' });
  assert.equal(Object.hasOwn(parsed, 'anomaly'), false);
});

test('rejected top-level block closes the prior block; orphan indentation keeps the older-format scalar fallback (isolated UNIT realm)', () => {
  const { parsed, unchanged } = isolatedParse('---\ndomain:\n  safe: one\n__proto__:\n  unit_orphan: two\nanomaly:\n  type: mismatch\n---\n# Body');
  assert.equal(unchanged, true);
  assert.deepEqual(parsed.fields, { unit_orphan: 'two' });
  assert.deepEqual(parsed.nested.domain, { safe: 'one' });
  assert.deepEqual(parsed.anomaly, { type: 'mismatch' });
});

test('parser supported scalar/typed/quoted/raw values, CRLF/tabs and duplicate-block semantics remain unchanged', () => {
  const doc = `---
SLUG: 'child'
VERSION: 1.2.3
TITLE: "Child"
CHAINROOT: entry
inherits: parent
override: [domain, risk_level]
risk_level: low
risk_level: high
labels: [red, blue]
flag: false
empty: ''
domain: scalar
domain:
\tSLUG: nested-child
  note: 'first'

ignored line without colon
orphan: value
domain:
  note: "last"
  limit: -2.5
  empty:
anomaly:
  type: mismatch
---

# Body
`;
  for (const text of [doc, doc.replaceAll('\n', '\r\n')]) {
    const parsed = parseFrontmatter(text);
    assert.deepEqual(parsed.fields, {
      slug: 'child', version: '1.2.3', title: 'Child', chainroot: 'entry',
      inherits: 'parent', override: '[domain, risk_level]', risk_level: 'high',
      labels: '[red, blue]', flag: 'false', domain: 'scalar', orphan: 'value'
    });
    assert.deepEqual(parsed.nested, {
      empty: {}, domain: { slug: 'nested-child', note: 'last', limit: '-2.5', empty: '' },
      anomaly: { type: 'mismatch' }
    });
    assert.equal(parsed.slugRaw, 'child');
    assert.equal(parsed.version, '1.2.3');
    assert.equal(parsed.title, 'Child');
    assert.equal(parsed.chainRoot, 'entry');
    assert.equal(parsed.inherits, 'parent');
    assert.equal(parsed.overrideRaw, '[domain, risk_level]');
    assert.strictEqual(parsed.anomaly, parsed.nested.anomaly);
    assert.equal(parsed.body, text.endsWith('\r\n') ? '# Body\r\n' : '# Body\n');
  }
  for (const text of ['', '# Body', '---\nslug: child\n# Missing delimiter']) {
    assert.deepEqual(parseFrontmatter(text), { body: text, fields: {}, nested: {} });
  }
  for (const declarations of ['domain: high\ndomain:\n  note: nested', 'domain:\n  note: nested\ndomain: high']) {
    const parsed = parseFrontmatter(`---\n${declarations}\n---\n# Body`);
    assert.deepEqual(parsed.fields, { domain: 'high' });
    assert.deepEqual(parsed.nested, { domain: { note: 'nested' } });
  }
});

const clone = (value) => JSON.parse(JSON.stringify(value));
function payloadFixture(frontmatter) {
  return {
    space_id: allowedSpace, slug: ' unit-child ', label: 'Child', text: '# Body',
    tags: ['unit'], created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
    adapter: {
      id: 'unit-adapter-id', name: 'Child', layer_index: 2, layer_count: 3,
      protocol_version: '1.2.3', activation_patterns: ['unit'], reward_signal: 'unit signal', chain_root: 'entry',
      ...(frontmatter === undefined ? {} : { frontmatter })
    }
  };
}
function readFixture(payload, present = true, failure) {
  const calls = { lance: [], qdrant: [], reconnects: 0 };
  const reader = new LanceRecordReader({
    async retrieveRaw(id) {
      calls.lance.push(id);
      if (failure) throw failure;
      return present ? { id: uuid, payload: JSON.stringify(payload) } : null;
    }
  });
  const conn = {
    collectionName: 'unit-records',
    async executeWithReconnect(callback) { calls.reconnects++; return callback(); },
    client: {
      async retrieve(collection, options) {
        calls.qdrant.push({ collection, options });
        if (failure) throw failure;
        return present ? [{ id: uuid, payload: clone(payload) }] : [];
      }
    }
  };
  return { reader, conn, calls };
}

for (const frontmatter of [
  { risk_level: 'high', domain: { inputs: ['one', 'two'], enabled: false, limit: -2.5, empty: '' }, anomaly: { type: 'mismatch' } },
  {}, []
]) {
  test(`ancillary UUID reads retain frontmatter like neutral reads; additive shape only (UNIT records/auth/backends: ${JSON.stringify(frontmatter)})`, async () => {
    const payload = payloadFixture(frontmatter);
    const before = clone(payload);
    const { reader, conn, calls } = readFixture(payload);
    const lance = await reader.getMemoryByUUID(uuid);
    const remote = await qdrant.getMemoryByUUID(conn, uuid);
    const neutral = await reader.getMemory(uuid);
    const point = await qdrant.retrieveAccessiblePointById(conn, uuid);
    const neutralQdrant = pointToMemory(point);
    for (const memory of [lance, remote, neutral, neutralQdrant]) {
      assert.deepEqual(memory.adapter.frontmatter, frontmatter);
      assert.equal(memory.memory_uuid, uuid);
      assert.equal(memory.space_id, allowedSpace);
      assert.equal(memory.slug, 'unit-child');
      assert.equal(memory.text, '# Body');
    }
    assert.deepEqual(lance, remote);
    assert.deepEqual(Object.keys(lance).sort(), [
      'id', 'space_id', 'slug', 'label', 'text', 'domain', 'task', 'type', 'tags', 'protocol',
      'quality_metrics', 'quality_metadata', 'memory_uuid', 'adapter', 'inference_contract',
      'embedding', 'access_count', 'last_accessed', 'relevance_score', 'created_at',
      'peak_contexts', 'certainty', 'entropy'
    ].sort());
    assert.equal(lance.id, uuid);
    assert.deepEqual(lance.adapter, payload.adapter);
    assert.deepEqual(lance.embedding, []);
    assert.equal(lance.type, 'context');
    assert.equal(lance.access_count, 0);
    assert.deepEqual(lance.last_accessed, new Date(payload.updated_at));
    assert.deepEqual(lance.created_at, new Date(payload.created_at));
    assert.deepEqual(payload, before);
    assert.deepEqual(calls.lance, [uuid, uuid]);
    assert.equal(calls.reconnects, 2);
    assert.deepEqual(calls.qdrant, Array.from({ length: 2 }, () => ({
      collection: 'unit-records', options: { ids: [uuid], with_payload: true, with_vector: false }
    })));
    assert.ok(state.validatedIds.includes(uuid));
  });
}

test('absent/null/scalar frontmatter stays omitted, matching neutral projection (UNIT records)', async () => {
  for (const value of [undefined, null, '', 'scalar', false, 0, 42]) {
    const { reader, conn } = readFixture(payloadFixture(value));
    for (const memory of [await reader.getMemoryByUUID(uuid), await qdrant.getMemoryByUUID(conn, uuid), await reader.getMemory(uuid)]) {
      assert.equal(Object.hasOwn(memory.adapter, 'frontmatter'), false);
      assert.equal(memory.adapter.id, 'unit-adapter-id');
    }
  }
  const { reader, conn } = readFixture({ created_at: '2026-01-01T00:00:00.000Z' });
  assert.equal((await reader.getMemoryByUUID(uuid)).adapter, undefined);
  assert.equal((await qdrant.getMemoryByUUID(conn, uuid)).adapter, undefined);
});

test('missing/denied return null; app and default-app remain readable through actual gates (UNIT auth/backend doubles)', async () => {
  const missing = readFixture(payloadFixture({ safe: 'unit' }), false);
  assert.equal(await missing.reader.getMemoryByUUID(uuid), null);
  assert.equal(await qdrant.getMemoryByUUID(missing.conn, uuid), null);
  assert.deepEqual(await qdrant.retrievePointAccessById(missing.conn, uuid), { status: 'not_found' });
  for (const spaceId of [deniedSpace, appSpace, undefined]) {
    const payload = payloadFixture({ safe: 'unit' });
    if (spaceId === undefined) delete payload.space_id;
    else payload.space_id = spaceId;
    const { reader, conn } = readFixture(payload);
    const lance = await reader.getMemoryByUUID(uuid);
    const remote = await qdrant.getMemoryByUUID(conn, uuid);
    const access = await qdrant.retrievePointAccessById(conn, uuid);
    if (spaceId === deniedSpace) {
      assert.equal(lance, null);
      assert.equal(remote, null);
      assert.equal(await reader.getMemory(uuid), null);
      assert.deepEqual(access, { status: 'forbidden', pointId: uuid, spaceId: deniedSpace });
    } else {
      assert.deepEqual(lance.adapter.frontmatter, { safe: 'unit' });
      assert.deepEqual(remote.adapter.frontmatter, { safe: 'unit' });
      assert.equal(access.status, 'allowed');
      assert.equal(Object.hasOwn(lance, 'space_id'), spaceId !== undefined);
      assert.equal(Object.hasOwn(remote, 'space_id'), spaceId !== undefined);
    }
  }
});

test('backend errors still propagate; no ancillary empty/success fallback (UNIT backend failure)', async () => {
  const error = new Error('unit read unavailable');
  const { reader, conn } = readFixture(payloadFixture({ safe: 'unit' }), true, error);
  await assert.rejects(reader.getMemoryByUUID(uuid), (actual) => actual === error);
  await assert.rejects(qdrant.getMemoryByUUID(conn, uuid), (actual) => actual === error);
});
