/**
 * Unit tests for the version readers behind the boot-injection reuse rule (issue #24).
 *
 * `injectMemResourcesAtBoot()` skips retraining only when `getStoredAdapterVersion()`
 * returns a version. Both store backends implement that read, and both originally looked
 * at the payload *root* while every writer nests the value under the adapter object
 * (`adapter.protocol_version`), so the read always returned undefined and the skip was
 * dead — every boot re-embedded every shipped adapter.
 *
 * These tests pin the depth rule on both readers plus the shared accessor that gives the
 * rule one home. No Qdrant, no LanceDB, no Redis, no ONNX in the loop.
 * See docs/adr/0002-boot-injection-reuse-rule.md.
 */
import { describe, expect, jest, test } from '@jest/globals';
import type { MemoryQdrantStore } from '../../src/services/memory/store.js';
import { getPayloadAdapterVersion } from '../../src/services/memory/memory-accessors.js';
import { LanceRecordReader } from '../../src/services/vector-store/lancedb/lance-records-reads.js';
import type { LanceRecordRow } from '../../src/services/vector-store/lancedb/lance-records-schema.js';
import { SQUADRULES_APP_SPACE_ID } from '../../src/config.js';

const SLUG = 'squadrules-begin';

/** Exactly what the writers persist: the version inside `adapter`. */
const NESTED_PAYLOAD = {
  slug: SLUG,
  space_id: SQUADRULES_APP_SPACE_ID,
  adapter: { id: 'adapter-id', protocol_version: '4.5.6' }
};

/** The shape the pre-#24 readers expected (version at the payload root) — never written. */
const ROOT_ONLY_PAYLOAD = {
  slug: SLUG,
  space_id: SQUADRULES_APP_SPACE_ID,
  protocol_version: '4.5.6'
};

/**
 * Qdrant transport double. The REST client is replaced at the package boundary so the test
 * never constructs a real client (which fires a background compatibility probe at a local
 * Qdrant and logs after the run). `store.js` is imported dynamically so the mock is in place
 * before the module under test is evaluated; the type-only import above is erased at runtime.
 */
const qdrantScroll = jest.fn<() => Promise<{ points: Array<{ id: string; payload?: unknown }> }>>(async () => ({
  points: []
}));

jest.unstable_mockModule('@qdrant/js-client-rest', () => ({
  QdrantClient: class FakeQdrantClient {
    scroll = qdrantScroll;
  }
}));

/** The real reader over the stubbed transport (`unit-test-collection` needs no alias resolution). */
async function qdrantReader(payload: unknown): Promise<{ store: MemoryQdrantStore; scroll: jest.Mock }> {
  qdrantScroll.mockResolvedValue(payload === undefined ? { points: [] } : { points: [{ id: '1', payload }] });
  const { MemoryQdrantStore } = await import('../../src/services/memory/store.js');
  const store = new MemoryQdrantStore({ url: 'http://127.0.0.1:6333', collection: 'unit-test-collection' });
  return { store, scroll: qdrantScroll };
}

/** Lance reader over a stubbed engine scroll (the class takes the engine by construction). */
function lanceReader(rows: LanceRecordRow[]): { reader: LanceRecordReader; scroll: jest.Mock } {
  const scroll = jest.fn(async () => rows);
  const reader = new LanceRecordReader({ scroll } as unknown as ConstructorParameters<typeof LanceRecordReader>[0]);
  return { reader, scroll };
}

/**
 * A stored row: payload JSON plus the promoted `protocol_version` column. The column value
 * is deliberately different from the payload so a read proves which source is consulted.
 */
function rowFor(payload: unknown): LanceRecordRow {
  return { id: '1', protocol_version: '9.9.9', payload: JSON.stringify(payload) } as unknown as LanceRecordRow;
}

describe('getPayloadAdapterVersion() — one home for the depth rule', () => {
  test('resolves the version nested under adapter', () => {
    expect(getPayloadAdapterVersion(NESTED_PAYLOAD)).toBe('4.5.6');
  });

  test('does not read a version off the payload root', () => {
    expect(getPayloadAdapterVersion(ROOT_ONLY_PAYLOAD)).toBe(undefined);
  });

  test('returns undefined for a missing payload, adapter object or non-string value', () => {
    expect(getPayloadAdapterVersion(undefined)).toBe(undefined);
    expect(getPayloadAdapterVersion({ slug: SLUG })).toBe(undefined);
    expect(getPayloadAdapterVersion({ adapter: { protocol_version: 5 } })).toBe(undefined);
  });
});

describe('MemoryQdrantStore.getStoredAdapterVersion() (Qdrant backend)', () => {
  test('resolves the stored version from adapter.protocol_version', async () => {
    const { store } = await qdrantReader(NESTED_PAYLOAD);
    await expect(store.getStoredAdapterVersion(SLUG)).resolves.toBe('4.5.6');
  });

  test('yields undefined when the payload only carries a root protocol_version', async () => {
    const { store } = await qdrantReader(ROOT_ONLY_PAYLOAD);
    await expect(store.getStoredAdapterVersion(SLUG)).resolves.toBe(undefined);
  });

  test('yields undefined when no point matches the slug', async () => {
    const { store } = await qdrantReader(undefined);
    await expect(store.getStoredAdapterVersion(SLUG)).resolves.toBe(undefined);
  });

  test('reads one point by app-space + slug, payload only', async () => {
    const { store, scroll } = await qdrantReader(NESTED_PAYLOAD);
    scroll.mockClear();
    await store.getStoredAdapterVersion(SLUG);
    expect(scroll).toHaveBeenCalledTimes(1);
    const [collection, options] = scroll.mock.calls[0] as [string, Record<string, unknown>];
    expect(collection).toBe('unit-test-collection');
    expect(options['limit']).toBe(1);
    expect(options['with_payload']).toBe(true);
    expect(options['with_vector']).toBe(false);
    const keys = (options['filter'] as { must: Array<{ key: string }> }).must.map((clause) => clause.key);
    expect(keys).toEqual(['space_id', 'slug']);
  });
});

describe('LanceRecordReader.getStoredAdapterVersion() (embedded backend)', () => {
  test('resolves the stored version from the payload adapter object', async () => {
    const { reader } = lanceReader([rowFor(NESTED_PAYLOAD)]);
    await expect(reader.getStoredAdapterVersion(SLUG)).resolves.toBe('4.5.6');
  });

  test('ignores the promoted protocol_version column and a root payload key', async () => {
    const { reader } = lanceReader([rowFor(ROOT_ONLY_PAYLOAD)]);
    await expect(reader.getStoredAdapterVersion(SLUG)).resolves.toBe(undefined);
  });

  test('yields undefined when the table holds no matching row', async () => {
    const { reader } = lanceReader([]);
    await expect(reader.getStoredAdapterVersion(SLUG)).resolves.toBe(undefined);
  });

  test('scans app-space rows for the slug, capped at one', async () => {
    const { reader, scroll } = lanceReader([rowFor(NESTED_PAYLOAD)]);
    await reader.getStoredAdapterVersion(SLUG);
    expect(scroll).toHaveBeenCalledTimes(1);
    const [filter, limit] = scroll.mock.calls[0] as [{ must: Array<{ key: string; match: { value?: unknown } }> }, number];
    expect(limit).toBe(1);
    expect(filter.must.map((clause) => [clause.key, clause.match.value])).toEqual([
      ['space_id', SQUADRULES_APP_SPACE_ID],
      ['slug', SLUG]
    ]);
  });
});
