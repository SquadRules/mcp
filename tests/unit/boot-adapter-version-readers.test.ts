/**
 * Regression tests for the boot-injection reuse skip (issue #24, ADR 0002).
 *
 * The skip only fires when a reader can resolve the version that the writers
 * actually stored. Writers nest it at `payload.adapter.protocol_version`; the
 * readers historically read the top-level `payload.protocol_version`, which is
 * always undefined, so every boot deleted and re-trained every adapter. These
 * tests lock the nested read path (with a top-level fallback for older rows)
 * at both the shared accessor and the LanceDB reader. Pure unit tests: no ONNX,
 * no embedding, no server.
 */
import { describe, expect, test } from '@jest/globals';
import { getPayloadAdapterVersion } from '../../src/services/memory/memory-accessors.js';
import { LanceRecordReader } from '../../src/services/vector-store/lancedb/lance-records-reads.js';

describe('getPayloadAdapterVersion', () => {
  test('reads the nested adapter.protocol_version that writers store', () => {
    expect(getPayloadAdapterVersion({ adapter: { protocol_version: '5.3.0' } })).toBe('5.3.0');
  });

  test('prefers the nested path over a conflicting top-level value', () => {
    expect(
      getPayloadAdapterVersion({ protocol_version: '0.0.1', adapter: { protocol_version: '5.3.0' } })
    ).toBe('5.3.0');
  });

  test('falls back to top-level protocol_version for older rows', () => {
    expect(getPayloadAdapterVersion({ protocol_version: '4.8.6' })).toBe('4.8.6');
  });

  test('returns undefined when no version is present', () => {
    expect(getPayloadAdapterVersion({ adapter: { id: 'x' } })).toBeUndefined();
    expect(getPayloadAdapterVersion({})).toBeUndefined();
  });

  test('returns undefined for blank or non-string versions', () => {
    expect(getPayloadAdapterVersion({ adapter: { protocol_version: '   ' } })).toBeUndefined();
    expect(getPayloadAdapterVersion({ adapter: { protocol_version: 530 } })).toBeUndefined();
  });

  test('returns undefined for a missing payload', () => {
    expect(getPayloadAdapterVersion(undefined)).toBeUndefined();
    expect(getPayloadAdapterVersion(null)).toBeUndefined();
  });
});

describe('LanceRecordReader.getStoredAdapterVersion (issue #24 regression)', () => {
  function readerReturning(payload: Record<string, unknown> | null) {
    const engine = {
      scroll: async () => (payload === null ? [] : [{ id: 'row-1', payload: JSON.stringify(payload) }])
    };
    return new LanceRecordReader(engine as never);
  }

  test('resolves the version from a stored app-space adapter row', async () => {
    const reader = readerReturning({ slug: 'author-adapter', adapter: { protocol_version: '5.3.0' } });
    await expect(reader.getStoredAdapterVersion('author-adapter')).resolves.toBe('5.3.0');
  });

  test('returns undefined when nothing is stored for the slug', async () => {
    const reader = readerReturning(null);
    await expect(reader.getStoredAdapterVersion('missing')).resolves.toBeUndefined();
  });
});
