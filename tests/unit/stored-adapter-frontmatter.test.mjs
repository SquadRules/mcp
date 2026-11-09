// Focused UNIT tests against actual parser/converter/attachment and pure row/readback code.
// Constructed Memory/payload fixtures are unit doubles, NOT native persistence evidence.
// Self-contained under plain `node --test` (Node 24/26): a bounded in-process hook maps
// the allowlisted source modules' `.js` specifiers to their `.ts` files and strips
// erasable types in memory. No Jest, compiled output, external --import loader,
// database, provider, backend or model imports.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { after, test } from 'node:test';

const src = new URL('../../src/', import.meta.url);
// Explicit UNIT double: real src/config.ts reads env and pulls runtime-mode/OIDC/redis
// helpers. Only this constant is consumed (fallback when payload space_id is absent;
// every fixture below sets space_id, so the value is never asserted on).
const doubles = new Map([
  ['config.ts', "export const SQUADRULES_APP_SPACE_ID = 'space:unit-app-double';"]
].map(([path, source]) => [new URL(path, src).href, source]));
// Exactly the pure production modules under test plus their one runtime dependency
// (adapter-inheritance.ts: parseOverrideList). Type-only imports are erased by stripping.
const production = new Set([
  'utils/frontmatter.ts',
  'services/memory/stored-adapter-frontmatter.ts',
  'services/graph-db/adapter-inheritance.ts',
  'services/vector-store/lancedb/lance-records-schema.ts',
  'services/memory/qdrant-point-to-memory.ts'
].map((path) => new URL(path, src).href));
// Bare specifiers the allowlisted modules may import; anything else is rejected.
const builtins = new Set(['node:crypto']);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('file:') || specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL ?? import.meta.url).href.replace(/\.js$/, '.ts');
      if (production.has(url) || doubles.has(url)) return { url, format: 'module', shortCircuit: true };
      if (url.startsWith(src.href) || production.has(context.parentURL)) {
        throw new Error(`Unexpected dependency in bounded unit check: ${url}`);
      }
    } else if (production.has(context.parentURL) && !builtins.has(specifier)) {
      throw new Error(`Unexpected bare import in bounded unit check: ${specifier} from ${context.parentURL}`);
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
const { parseFrontmatter } = await import(new URL('utils/frontmatter.ts', src));
const { toStoredAdapterFrontmatter, attachStoredAdapterFrontmatter } =
  await import(new URL('services/memory/stored-adapter-frontmatter.ts', src));
const { toRow } = await import(new URL('services/vector-store/lancedb/lance-records-schema.ts', src));
const { pointToMemory } = await import(new URL('services/memory/qdrant-point-to-memory.ts', src));
after(() => { hooks.deregister(); });

const fixture = `---
slug: child
version: 1.2.3
title: Child Title
inherits: parent
chain_root: entry
override: [domain, risk_level]
protocol_version: 2.0.0
risk_level: high
labels: [red, 'blue']
enabled: true
limit: -2.5
domain:
  slug: nested-child
  version: nested-version
  inherits: nested-parent
  chain_root: nested-entry
  override: [nested-only]
  inputs: [one, two]
  enabled: false
  limit: 3
  note: 'Keep me'
  empty:
anomaly:
  type: mismatch
  field: risk_level
---

# Child Body
`;
const expected = {
  slug: 'child', version: '1.2.3', title: 'Child Title', inherits: 'parent',
  chain_root: 'entry', override: ['domain', 'risk_level'], protocol_version: '2.0.0',
  risk_level: 'high', labels: ['red', 'blue'], enabled: true, limit: -2.5,
  domain: {
    slug: 'nested-child', version: 'nested-version', inherits: 'nested-parent',
    chain_root: 'nested-entry', override: ['nested-only'], inputs: ['one', 'two'],
    enabled: false, limit: 3, note: 'Keep me', empty: ''
  },
  anomaly: { type: 'mismatch', field: 'risk_level' }
};
function memoryFixture(index) {
  return {
    memory_uuid: `unit-layer-${index}`, slug: 'child', space_id: 'user:unit:owner',
    label: `Child ${index}`, tags: ['unit'], text: '# Child Body\n',
    llm_model_id: 'unit-fixture', created_at: '2026-01-01T00:00:00.000Z',
    adapter: { id: 'unit-child-id', name: 'Child', layer_index: index, layer_count: 2 }
  };
}

test('actual parser-supported mappings remain nested; identity/topology stay typed', () => {
  const parsed = parseFrontmatter(fixture);
  assert.equal(parsed.slugRaw, 'child');
  assert.equal(parsed.nested.domain.slug, 'nested-child');
  assert.equal(parsed.nested.domain.inputs, '[one, two]');
  assert.equal(parsed.fields.inputs, undefined);
  assert.equal(parsed.fields.type, undefined);
  assert.equal(parsed.body, '# Child Body\n');
  assert.deepEqual(toStoredAdapterFrontmatter(parsed), expected);
});

test('older-format scalar, inline-array, alias, quoted, lowercase and CRLF/tab formats', () => {
  const doc = "---\nSLUG: 'child'\nVERSION: 1\nCHAINROOT: entry\nOVERRIDE: domain, labels\nlabels: []\nzero: 0\nflag: false\nword: null\ndomain:\n\tINPUTS: [1, true]\n\tNOTE: \"hello\"\n---\n# Body\n";
  for (const text of [doc, doc.replaceAll('\n', '\r\n')]) {
    assert.deepEqual(toStoredAdapterFrontmatter(parseFrontmatter(text)), {
      slug: 'child', version: '1', chain_root: 'entry', override: ['domain', 'labels'],
      labels: [], zero: 0, flag: false, word: 'null',
      domain: { inputs: ['1', 'true'], note: 'hello' }
    });
  }
});

test('no declarations are still null; nested-only and empty parsed blocks persist', () => {
  for (const text of ['', '# Body', '---\nslug: child\n# Missing delimiter']) {
    assert.equal(toStoredAdapterFrontmatter(parseFrontmatter(text)), null);
  }
  assert.equal(toStoredAdapterFrontmatter(undefined), null);
  assert.deepEqual(toStoredAdapterFrontmatter(parseFrontmatter('---\ndomain:\n  flag: true\n---\n# Body')), {
    domain: { flag: true }
  });
  assert.deepEqual(toStoredAdapterFrontmatter(parseFrontmatter('---\nempty:\n---\n# Body')), { empty: {} });
});

test('scalar/block collisions preserve older-format scalar/array values in either order', () => {
  for (const scalar of ['high', '[red, blue]']) {
    for (const declarations of [
      `domain: ${scalar}\ndomain:\n  note: nested`,
      `domain:\n  note: nested\ndomain: ${scalar}`
    ]) {
      const result = toStoredAdapterFrontmatter(parseFrontmatter(`---\n${declarations}\n---\n# Body`));
      assert.deepEqual(result, { domain: scalar === 'high' ? 'high' : ['red', 'blue'] });
    }
  }
});

test('top-level typed names cannot be replaced or introduced by nested blocks', () => {
  const typed = ['slug', 'version', 'title', 'inherits', 'chain_root', 'chainroot', 'override', 'protocol_version'];
  const blocks = typed.map((key) => `${key}:\n  value: nested`).join('\n');
  const base = 'slug: child\nversion: 1.2.3\ntitle: Child\ninherits: parent\nchainroot: entry\noverride: [domain]\nprotocol_version: 2.0.0';
  assert.deepEqual(toStoredAdapterFrontmatter(parseFrontmatter(`---\n${base}\n${blocks}\n---\n# Body`)), {
    slug: 'child', version: '1.2.3', title: 'Child', inherits: 'parent',
    chain_root: 'entry', override: ['domain'], protocol_version: '2.0.0'
  });
  assert.equal(toStoredAdapterFrontmatter(parseFrontmatter(`---\n${blocks}\n---\n# Body`)), null);
});

test('converter filters own prototype-sensitive keys and never copies inherited entries (UNIT parsed double)', () => {
  // Do not send hostile blocks through the unowned parser: its own prototype handling is out of scope.
  const fields = JSON.parse('{"__proto__":"bad","constructor":"bad","prototype":"bad","safe":"true"}');
  const nested = JSON.parse('{"__proto__":{"bad":"true"},"constructor":{"bad":"true"},"prototype":{"bad":"true"},"domain":{"__proto__":"bad","constructor":"bad","prototype":"bad","safe":"false"}}');
  Object.setPrototypeOf(fields, { inherited_scalar: 'bad' });
  Object.setPrototypeOf(nested, { inherited_block: { bad: 'true' } });
  Object.setPrototypeOf(nested.domain, { inherited_leaf: 'bad' });
  const parsedDouble = { body: '', fields, nested };
  const before = JSON.stringify(parsedDouble);
  const result = toStoredAdapterFrontmatter(parsedDouble);
  assert.deepEqual(result, { safe: true, domain: { safe: false } });
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.getPrototypeOf(result.domain), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(result, '__proto__'), false);
  assert.equal(JSON.stringify(parsedDouble), before);
});

test('conversion creates independent mapping/array values without mutating parser views', () => {
  const parsed = parseFrontmatter(fixture);
  const before = structuredClone(parsed);
  const first = toStoredAdapterFrontmatter(parsed);
  const second = toStoredAdapterFrontmatter(parsed);
  first.domain.inputs.push('changed');
  first.labels.push('changed');
  first.override.push('changed');
  first.anomaly.field = 'changed';
  assert.deepEqual(second, expected);
  assert.deepEqual(parsed, before);
});

test('attachment clones each layer and leaves child identity/body and non-adapters alone (UNIT memories)', () => {
  const memories = [memoryFixture(1), memoryFixture(2), { ...memoryFixture(3), adapter: undefined }];
  const before = structuredClone(memories);
  attachStoredAdapterFrontmatter(memories, parseFrontmatter(fixture));
  for (let i = 0; i < 2; i++) {
    const { frontmatter, ...identity } = memories[i].adapter;
    assert.deepEqual(frontmatter, expected);
    assert.deepEqual(identity, before[i].adapter);
    assert.deepEqual({ ...memories[i], adapter: identity }, before[i]);
  }
  assert.deepEqual(memories[2], before[2]);
  const first = memories[0].adapter.frontmatter;
  first.domain.inputs.push('changed');
  first.labels.push('changed');
  first.override.push('changed');
  first.anomaly.field = 'changed';
  assert.deepEqual(memories[1].adapter.frontmatter, expected);
  attachStoredAdapterFrontmatter(memories, parseFrontmatter('# No frontmatter'));
  assert.deepEqual(memories[1].adapter.frontmatter, expected);
});

test('actual attachment -> pure Lance toRow -> JSON payload -> pointToMemory roundtrip (UNIT payloads, no DB)', () => {
  const memories = [memoryFixture(1), memoryFixture(2)];
  attachStoredAdapterFrontmatter(memories, parseFrontmatter(fixture));
  for (const memory of memories) {
    // Payload construction is a UNIT fixture; native write handlers are NOT executed here.
    const row = toRow({ id: memory.memory_uuid, payload: { ...memory } });
    assert.equal(row.slug, 'child');
    assert.equal(row.adapter_id, 'unit-child-id');
    assert.equal(row.layer_index, memory.adapter.layer_index);
    const reloaded = pointToMemory({ id: row.id, payload: JSON.parse(row.payload) });
    assert.deepEqual(reloaded.adapter.frontmatter, expected);
    assert.equal(reloaded.slug, memory.slug);
    assert.equal(reloaded.adapter.id, memory.adapter.id);
    assert.equal(reloaded.space_id, memory.space_id);
    assert.equal(reloaded.text, memory.text);
  }
});
