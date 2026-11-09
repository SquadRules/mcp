/** UNIT: scoped reads against a record-source double, not database/integration evidence. */
import { describe, expect, test } from '@jest/globals';
import { SQUADRULES_APP_SPACE_ID as APP } from '../../src/config.js';
import {
  resolveStoredAdapterLayers,
  resolveStoredAdapterSnapshot,
  resolveStoredParentSnapshot,
  type AdapterRecordSource
} from '../../src/services/graph-db/adapter-graph-records.js';
import {
  inheritanceWriteStructureErrors,
  InheritanceValidationUnavailableError
} from '../../src/services/graph-db/inheritance-write-validation.js';
import type { LayerRecord } from '../../src/services/vector-store/types.js';

const OWN = 'user:unit:inheritance-owner';
const OTHER = 'user:unit:unrelated';
function record(spaceId: string, marker: string): LayerRecord {
  return { uuid: `${marker}-uuid`, payload: {
    slug: 'same-parent', space_id: spaceId, content_type: 'text/markdown',
    adapter: { id: `${marker}-id`, layer_index: 1, frontmatter: { marker } }
  } } as unknown as LayerRecord;
}
function sourceDouble(records: Map<string, LayerRecord[]>, failingSpace?: string) {
  const calls: string[] = [];
  const source: AdapterRecordSource = {
    async scrollSpace(spaceId, options) {
      calls.push(spaceId);
      expect(options).toEqual({ paginate: true });
      if (spaceId === failingSpace) throw new Error('unit record read unavailable');
      return records.get(spaceId) ?? [];
    }
  };
  return { source, calls };
}

describe('inheritance write integrity: scoped records (unit)', () => {
  test('same-slug own wins over app and other scopes', async () => {
    const { source, calls } = sourceDouble(new Map([
      [OWN, [record(OWN, 'own')]], [APP, [record(APP, 'app')]], [OTHER, [record(OTHER, 'other')]]
    ]));
    const parent = await resolveStoredParentSnapshot(source, 'same-parent', OWN);
    expect(parent?.spaceId).toBe(OWN);
    expect(parent?.snapshot.frontmatter['marker']).toBe('own');
    expect(calls).toEqual([OWN]);
  });

  test('app fallback follows successful own absence only', async () => {
    const { source, calls } = sourceDouble(new Map([[APP, [record(APP, 'app')]]]));
    const parent = await resolveStoredParentSnapshot(source, 'same-parent', OWN);
    expect(parent?.spaceId).toBe(APP);
    expect(parent?.snapshot.frontmatter['marker']).toBe('app');
    expect(calls).toEqual([OWN, APP]);
  });

  test('successful own/app absence returns null without querying other spaces', async () => {
    const { source, calls } = sourceDouble(new Map([[OTHER, [record(OTHER, 'other')]]]));
    expect(await resolveStoredParentSnapshot(source, 'same-parent', OWN)).toBeNull();
    expect(calls).toEqual([OWN, APP]);
  });

  test('own read failure cannot select a same-slug app record', async () => {
    const { source, calls } = sourceDouble(new Map([[APP, [record(APP, 'app')]]]), OWN);
    await expect(resolveStoredParentSnapshot(source, 'same-parent', OWN)).rejects.toMatchObject({
      code: 'INHERITANCE_VALIDATION_UNAVAILABLE', status: 'unavailable',
      details: { reason: 'read_unavailable', space_id: OWN, parent_slug: 'same-parent' }
    });
    expect(calls).toEqual([OWN]);
  });

  test('app read failure after own absence is unavailable, not absent', async () => {
    const { source, calls } = sourceDouble(new Map(), APP);
    await expect(resolveStoredParentSnapshot(source, 'same-parent', OWN)).rejects.toBeInstanceOf(
      InheritanceValidationUnavailableError
    );
    expect(calls).toEqual([OWN, APP]);
  });

  test('app children have exactly one scope candidate', async () => {
    const { source, calls } = sourceDouble(new Map());
    expect(await resolveStoredParentSnapshot(source, 'same-parent', APP)).toBeNull();
    expect(calls).toEqual([APP]);
  });

  test.each([resolveStoredAdapterSnapshot, resolveStoredAdapterLayers])(
    'snapshot/layer reads distinguish absent from unavailable', async (lookup) => {
      const absent = sourceDouble(new Map());
      expect(await lookup(absent.source, 'same-parent', OWN)).toBeNull();
      const failed = sourceDouble(new Map(), OWN);
      await expect(lookup(failed.source, 'same-parent', OWN)).rejects.toMatchObject({
        code: 'INHERITANCE_VALIDATION_UNAVAILABLE', details: { reason: 'read_unavailable' }
      });
    }
  );

  test('missing scope/source cannot certify absence', async () => {
    const { source, calls } = sourceDouble(new Map());
    await expect(resolveStoredParentSnapshot(source, 'same-parent', '')).rejects.toMatchObject({
      details: { reason: 'scope_unavailable', next_action: expect.any(String) }
    });
    expect(calls).toEqual([]);
    await expect(resolveStoredAdapterSnapshot({} as AdapterRecordSource, 'same-parent', OWN)).rejects.toMatchObject({
      details: { reason: 'source_unavailable', next_action: expect.any(String) }
    });
  });

  test('malformed read result is unavailable rather than a successful absence', async () => {
    const source = { scrollSpace: async () => null } as unknown as AdapterRecordSource;
    await expect(resolveStoredAdapterLayers(source, 'same-parent', OWN)).rejects.toMatchObject({
      details: { reason: 'read_unavailable' }
    });
  });
});

describe('inheritance write integrity: local structural vetoes (unit)', () => {
  test.each([undefined, 'same-parent'])('structural veto independent of inherits=%s', (inherits) => {
    const fm = { override: ['contract', 'tags', 'work_envelope'], ...(inherits ? { inherits } : {}) };
    expect(inheritanceWriteStructureErrors(fm).map((e) => e.field)).toEqual(['contract', 'work_envelope']);
  });
  test('no new unknown-field eligibility rule without a parent declaration', () => {
    expect(inheritanceWriteStructureErrors({ override: ['not-a-policy-decision'] })).toEqual([]);
  });
  test('ambiguous single-parent inputs fail locally', () => {
    expect(inheritanceWriteStructureErrors({ inherits: '[a, b]' })[0]?.code).toBe('single_parent');
  });
});
