/** UNIT: train write-boundary doubles. No native store, embedding or integration claim. */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  makeAdapterStore, registerMocks, resetTrainDoubles, storedHead, validMarkdown
} from './graph-db-train-unit-harness.js';
import { parseFrontmatter } from '../../src/utils/frontmatter.js';
import { toStoredAdapterFrontmatter } from '../../src/services/memory/stored-adapter-frontmatter.js';

async function loadTrain() {
  jest.resetModules();
  registerMocks();
  return import('../../src/tools/train-store.js');
}

describe('inheritance write integrity: train (unit)', () => {
  beforeEach(resetTrainDoubles);

  test.each(['own', 'app'])('fork from %s preserves declarations at the store boundary', async (origin) => {
    const { executeTrainStore } = await loadTrain();
    const { SQUADRULES_APP_SPACE_ID: app } = await import('../../src/config.js');
    const { defaultSpaceContext, runWithSpaceContext } = await import('../../src/utils/tenant-context.js');
    const ctx = defaultSpaceContext();
    const parentSpace = origin === 'own' ? ctx.defaultWriteSpaceId : app;
    const original = validMarkdown({ slug: 'same-slug', frontmatter: [
      'title: "Title: untouched"', 'chain_root: entry', 'inherits: parent', 'override: [risk_level]',
      'risk_level: high', 'labels: [red, blue]', 'enabled: true', 'attempts: 3',
      'domain:', '  slug: nested-not-identity', '  inputs: [one, two]'
    ] });
    const parent = { uuid: 'parent-layer', payload: {
      slug: 'parent', space_id: parentSpace,
      adapter: { id: 'parent-id', layer_index: 1, frontmatter: { risk_level: 'low' } }
    } };
    const minted = storedHead({ uuid: 'unit-minted-uuid', slug: 'same-slug-2', spaceId: ctx.defaultWriteSpaceId });
    const store = makeAdapterStore({ head: minted });
    store.scrollSpace.mockImplementation(async (spaceId: string) => spaceId === parentSpace ? [parent] : []);
    let captured = '';
    let capturedFrontmatter: unknown;
    store.storeAdapter.mockImplementation(async (docs: string[]) => {
      captured = docs[0]!;
      // The actual production converter, with only the final persistence surface doubled.
      capturedFrontmatter = toStoredAdapterFrontmatter(parseFrontmatter(captured));
      return [minted];
    });
    const result = await runWithSpaceContext(ctx, () => executeTrainStore(store as any, {
      content: original, llm_model_id: 'unit-model', fork_new_adapter: true
    } as any, async (fn) => fn()));
    expect(result.status).toBe('stored');
    expect(captured).toBe(original.replace('slug: same-slug\n', ''));
    const expectedParsed = parseFrontmatter(original);
    delete expectedParsed.slugRaw;
    delete expectedParsed.fields['slug'];
    expect(parseFrontmatter(captured)).toEqual(expectedParsed);
    expect(capturedFrontmatter).toEqual({
      version: '1.0.0', title: 'Title: untouched', chain_root: 'entry', inherits: 'parent',
      override: ['risk_level'], risk_level: 'high', labels: ['red', 'blue'], enabled: true, attempts: 3,
      domain: { slug: 'nested-not-identity', inputs: ['one', 'two'] }
    });
    // `toStoredAdapterFrontmatter` carries every parser-supported scalar and nested
    // declaration onto the stored adapter payload (see the module docstring), so the
    // `domain:` block reaches the store boundary alongside the flat fields above.
    expect(parseFrontmatter(captured).nested).toEqual(parseFrontmatter(original).nested);
    expect(store.storeAdapter).toHaveBeenCalledWith([captured], 'unit-model', { forceUpdate: false, forkNewAdapter: true });
    expect(parseFrontmatter(captured).slugRaw).toBeUndefined();
  });

  test('fork identity helper preserves raw arrays, nested data, CRLF and body whitespace', async () => {
    const { markdownWithoutAuthorSlugForFork: rewrite } = await loadTrain();
    const original = ' \n---\r\nslug: original\r\nvalues:\r\n  - one\r\n  - two\r\ndomain:\r\n  slug: nested\r\n---\r\n\r\n  # Body\r\n';
    expect(rewrite(original)).toBe(original.replace('slug: original\r\n', ''));
    expect(rewrite(rewrite(original))).toBe(rewrite(original));
    expect(rewrite('# Plain\n')).toBe('# Plain\n');
    expect(rewrite('---\nslug: first\nslug: second\n---\n# Body')).toBe('---\n\n---\n# Body');
    expect(rewrite('---\nslug:\nversion: 1.0.0\n---\n# Body')).toBe('---\nversion: 1.0.0\n---\n# Body');
  });

  test('unsafe parser roundtrip fails rather than silently changing a nested identity block', async () => {
    const { markdownWithoutAuthorSlugForFork: rewrite } = await loadTrain();
    expect(() => rewrite('---\nslug:\n  value: ambiguous\n---\n# Body')).toThrow(/without altering/);
  });

  test.each(['own-failed', 'app-failed', 'source-missing', 'scope-missing'])(
    '%s required validation rejects before runStore/storeAdapter', async (failure) => {
      const { executeTrainStore } = await loadTrain();
      const { SQUADRULES_APP_SPACE_ID: app } = await import('../../src/config.js');
      const { defaultSpaceContext, runWithSpaceContext } = await import('../../src/utils/tenant-context.js');
      const ctx = defaultSpaceContext();
      if (failure === 'scope-missing') ctx.defaultWriteSpaceId = '';
      const store = makeAdapterStore({});
      store.scrollSpace.mockImplementation(async (spaceId: string) => {
        if (failure === 'own-failed' || (failure === 'app-failed' && spaceId === app)) throw new Error('unit unavailable');
        return [];
      });
      if (failure === 'source-missing') (store as any).scrollSpace = undefined;
      const runStore = jest.fn<any>();
      await expect(runWithSpaceContext(ctx, () => executeTrainStore(store as any, {
        content: validMarkdown({ frontmatter: ['inherits: parent'] }), llm_model_id: 'unit-model'
      } as any, runStore))).rejects.toMatchObject({
        name: 'TrainError', code: 'INHERITANCE_VALIDATION_UNAVAILABLE',
        details: { must_obey: true, next_action: expect.any(String) }
      });
      expect(store.storeAdapter).not.toHaveBeenCalled();
      expect(runStore).not.toHaveBeenCalled();
      if (failure === 'own-failed') expect(store.scrollSpace).toHaveBeenCalledTimes(1);
    }
  );

  test.each([{ lines: [] }, { lines: ['inherits: parent'] }])('structural veto with/without inherits precedes reads (%j)', async ({ lines }) => {
    const { executeTrainStore } = await loadTrain();
    const store = makeAdapterStore({});
    const runStore = jest.fn<any>();
    await expect(executeTrainStore(store as any, {
      content: validMarkdown({ frontmatter: [...lines, 'override: [contract]'] }), llm_model_id: 'unit-model'
    } as any, runStore)).rejects.toMatchObject({
      code: 'INHERITANCE_STRUCTURE_INVALID', details: { items: [{ code: 'structural_override_forbidden', field: 'contract' }] }
    });
    expect(store.scrollSpace).not.toHaveBeenCalled();
    expect(store.storeAdapter).not.toHaveBeenCalled();
    expect(runStore).not.toHaveBeenCalled();
  });

  test('genuine own/app absence retains successful-write warning policy', async () => {
    const { executeTrainStore } = await loadTrain();
    const store = makeAdapterStore({ head: storedHead({ uuid: 'child-unit', slug: 'child' }) });
    const result = await executeTrainStore(store as any, {
      content: validMarkdown({ frontmatter: ['inherits: absent', 'override: [tags]'] }), llm_model_id: 'unit-model'
    } as any, async (fn) => fn());
    expect(result.status).toBe('stored');
    expect(result.warnings?.[0]?.code).toBe('parent_missing');
    expect(store.storeAdapter).toHaveBeenCalledTimes(1);
  });
});
