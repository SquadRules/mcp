/** UNIT: tune pre-write gates with record/Qdrant-surface doubles; not persisted-state evidence. */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { registerMocks, resetTrainDoubles, validMarkdown } from './graph-db-train-unit-harness.js';

async function loadTune() {
  jest.resetModules();
  registerMocks();
  return import('../../src/tools/tune-adapter-markdown.js');
}

async function qdrantDouble() {
  const { IDGenerator } = await import('../../src/services/id-generator.js');
  const { defaultSpaceContext } = await import('../../src/utils/tenant-context.js');
  const spaceId = defaultSpaceContext().defaultWriteSpaceId;
  const adapterId = IDGenerator.generateAdapterUUIDv5('Test Adapter');
  const payload = {
    slug: 'test-adapter', space_id: spaceId,
    adapter: { id: adapterId, name: 'Test Adapter', layer_index: 1, layer_count: 1, protocol_version: '1.0.0' }
  };
  return {
    spaceId,
    service: {
      findFirstStepMemoryUuidBySlug: jest.fn<any>().mockResolvedValue({ layerUuid: 'unit-head' }),
      getMemoryByUUID: jest.fn<any>().mockResolvedValue(payload),
      getAdapterLayers: jest.fn<any>().mockResolvedValue([{ uuid: 'unit-head', payload }]),
      updateMemory: jest.fn<any>()
    }
  };
}

describe('inheritance write integrity: tune (unit)', () => {
  beforeEach(resetTrainDoubles);

  test.each(['source-missing', 'own-failed', 'app-failed'])(
    '%s required validation blocks updateMemory', async (failure) => {
      const { tuneAdapterMarkdownInPlace } = await loadTune();
      const { SQUADRULES_APP_SPACE_ID: app } = await import('../../src/config.js');
      const { service } = await qdrantDouble();
      const scrollSpace = jest.fn<any>().mockImplementation(async (spaceId: string) => {
        if (failure === 'own-failed' || (failure === 'app-failed' && spaceId === app)) throw new Error('unit read failed');
        return [];
      });
      const store = failure === 'source-missing' ? undefined : { scrollSpace };
      await expect(tuneAdapterMarkdownInPlace(service as any, 'squadrules://adapter/test-adapter',
        validMarkdown({ frontmatter: ['inherits: parent', 'override: [tags]'] }), store as any
      )).rejects.toMatchObject({
        code: 'INHERITANCE_VALIDATION_UNAVAILABLE',
        details: { must_obey: true, next_action: expect.any(String) }
      });
      expect(service.updateMemory).not.toHaveBeenCalled();
      if (failure === 'own-failed') expect(scrollSpace).toHaveBeenCalledTimes(1);
      if (failure === 'app-failed') expect(scrollSpace).toHaveBeenCalledTimes(2);
    }
  );

  test.each([{ lines: [] }, { lines: ['inherits: parent'] }])(
    'structural veto before reads/writes (%j)', async ({ lines }) => {
      const { tuneAdapterMarkdownInPlace } = await loadTune();
      const { service } = await qdrantDouble();
      const store = { scrollSpace: jest.fn<any>().mockRejectedValue(new Error('must not read')) };
      await expect(tuneAdapterMarkdownInPlace(service as any, 'squadrules://adapter/test-adapter',
        validMarkdown({ frontmatter: [...lines, 'override: [contract]'] }), store as any
      )).rejects.toThrow(/structural_override_forbidden/);
      expect(store.scrollSpace).not.toHaveBeenCalled();
      expect(service.updateMemory).not.toHaveBeenCalled();
    }
  );

  test('blank scope is unavailable, not a parent-missing warning', async () => {
    const { assertTuneInheritanceValid } = await loadTune();
    const store = { scrollSpace: jest.fn<any>().mockResolvedValue([]) };
    await expect(assertTuneInheritanceValid('---\ninherits: parent\n---\n# Body', store as any, '')).rejects.toMatchObject({
      code: 'INHERITANCE_VALIDATION_UNAVAILABLE', details: { reason: 'scope_unavailable' }
    });
    expect(store.scrollSpace).not.toHaveBeenCalled();
  });

  test('successful absence retains current missing-parent policy', async () => {
    const { assertTuneInheritanceValid } = await loadTune();
    const store = { scrollSpace: jest.fn<any>().mockResolvedValue([]) };
    const warnings = await assertTuneInheritanceValid('---\ninherits: parent\n---\n# Body', store as any, 'user:unit:owner');
    expect(warnings.map((w) => w.code)).toEqual(['parent_missing']);
    expect(store.scrollSpace).toHaveBeenCalledTimes(2);
  });

  test('same-slug own parent controls eligibility even if app declares the overridden field', async () => {
    const { assertTuneInheritanceValid } = await loadTune();
    const { SQUADRULES_APP_SPACE_ID: app } = await import('../../src/config.js');
    const own = 'user:unit:owner';
    const scrollSpace = jest.fn<any>().mockImplementation(async (spaceId: string) => [{ uuid: `${spaceId}-head`, payload: {
      slug: 'parent', space_id: spaceId,
      adapter: { id: `${spaceId}-parent`, layer_index: 1, frontmatter: spaceId === app ? { domain: 'app-only' } : {} }
    } }]);
    await expect(assertTuneInheritanceValid('---\ninherits: parent\noverride: [domain]\n---\n# Body',
      { scrollSpace } as any, own
    )).rejects.toThrow(/override_unknown_field/);
    expect(scrollSpace).toHaveBeenCalledTimes(1);
  });

  test('nonstructural override without inherits has no new eligibility policy or read requirement', async () => {
    const { assertTuneInheritanceValid } = await loadTune();
    expect(await assertTuneInheritanceValid('---\noverride: [unresolved-policy-field]\n---\n# Body', undefined, '')).toEqual([]);
  });
});
