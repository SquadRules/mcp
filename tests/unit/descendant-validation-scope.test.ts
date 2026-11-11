/**
 * Scoped descendant validation (G9).
 *
 * WHAT THIS PINS
 * A parent change validates every stored child, and each child is read in the space its
 * own graph node records — never in the parent's. An app-space parent is inherited by
 * children stored elsewhere (the documented parent fallback), so reading the child in the
 * parent's scope would validate a same-named neighbour, or nothing at all.
 *
 * The read gate is the shared space policy, and the three ways a child can be unreadable
 * (no recorded scope, a scope this request may not read, a missing record) are all
 * reported as `unavailable` rather than substituted or dropped: a gate that silently
 * skips a child it cannot see looks complete when it is not. Unavailability is never a
 * conflict — a read failure must not block the parent write.
 */
import { describe, expect, test } from '@jest/globals';

import type { GraphRepository } from '../../src/services/graph-db/graph-repository.js';
import type { AdapterChildRef } from '../../src/services/graph-db/graph-types.js';
import { attachGraphDb } from '../../src/services/graph-db/graph-owner.js';
import {
  DescendantValidationError,
  assertDescendantsValid,
  validateDescendantsForParentChange
} from '../../src/services/graph-db/descendant-validation.js';
import type { AdapterRecordSource } from '../../src/services/graph-db/adapter-graph-records.js';
import type { LayerRecord } from '../../src/services/vector-store/types.js';
import { runWithSpaceContextAsync } from '../../src/utils/tenant-context.js';
import type { SpaceContext } from '../../src/utils/tenant-context.js';

const PARENT_SPACE = 'space:parent-home';
const FOREIGN_SPACE = 'space:not-readable';

/** Prospective parent: declares nothing, so a child's `override:` has an unknown field. */
const PARENT_MARKDOWN = ['---', 'slug: parent', 'version: 2.0.0', '---', '', '# Parent'].join('\n');

function spaceContext(allowed: string[]): SpaceContext {
  return {
    userId: 'user-unit',
    groupIds: [],
    allowedSpaceIds: allowed,
    defaultWriteSpaceId: PARENT_SPACE,
    personalSpaceId: PARENT_SPACE,
    spaceNamesById: {},
    requestId: 'descendant-unit'
  };
}

/** One stored adapter head layer, in the space the record really lives in. */
function record(space: string, slug: string, frontmatter: Record<string, unknown>): LayerRecord {
  return {
    uuid: `${space}:${slug}`,
    payload: {
      uuid: `${space}:${slug}`,
      content_type: 'text/markdown',
      space_id: space,
      slug,
      text: `# ${slug}`,
      adapter: { id: `${space}:${slug}`, name: slug, layer_index: 1, layer_count: 1, frontmatter }
    }
  } as unknown as LayerRecord;
}

/** Record source that serves per-space contents and remembers every space it was asked for. */
function source(perSpace: Record<string, LayerRecord[]>): AdapterRecordSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async scrollSpace(spaceId: string): Promise<LayerRecord[]> {
      asked.push(spaceId);
      return perSpace[spaceId] ?? [];
    }
  };
}

/** Graph double exposing only the two calls the validator makes. */
function graphWith(children: AdapterChildRef[]): GraphRepository {
  return {
    isInitialized: () => true,
    getChildren: async () => children
  } as unknown as GraphRepository;
}

/** Attach a graph to a private owner object, so nothing outlives the test. */
function ownerWith(children: AdapterChildRef[]): object {
  const owner = {};
  attachGraphDb(graphWith(children), owner);
  return owner;
}

function child(slug: string, space: string): AdapterChildRef {
  return { key: `adapter:${space}:${slug}`, slug, space };
}

describe('descendant validation reads each child in its own scope', () => {
  test('a child stored elsewhere is read from that space, not from the parent scope', async () => {
    const records = source({
      'space:elsewhere': [
        record('space:elsewhere', 'shared-child', {
          slug: 'shared-child',
          version: '1.0.0',
          inherits: 'parent',
          override: ['has_fur']
        })
      ]
    });

    const owner = ownerWith([child('shared-child', 'space:elsewhere')]);
    const report = await runWithSpaceContextAsync(
      spaceContext([PARENT_SPACE, 'space:elsewhere']),
      () =>
        validateDescendantsForParentChange({
          owner,
          source: records,
          parentSlug: 'parent',
          spaceId: PARENT_SPACE,
          markdown: PARENT_MARKDOWN
        })
    );

    expect(records.asked).toEqual(['space:elsewhere']);
    expect(report.checked).toBe(1);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]).toMatchObject({
      child_slug: 'shared-child',
      space: 'space:elsewhere',
      code: 'override_unknown_field'
    });
  });

  test('a same-slug neighbour in the parent space is never used as a substitute', async () => {
    // The child node says `space:elsewhere`, but only the parent's own space holds a
    // record with that slug. Substituting it would validate the wrong adapter.
    const records = source({
      [PARENT_SPACE]: [
        record(PARENT_SPACE, 'shared-child', {
          slug: 'shared-child',
          version: '1.0.0',
          inherits: 'parent'
        })
      ]
    });

    const owner = {};
    attachGraphDb(graphWith([child('shared-child', 'space:elsewhere')]), owner);
    const report = await runWithSpaceContextAsync(
      spaceContext([PARENT_SPACE, 'space:elsewhere']),
      () =>
        validateDescendantsForParentChange({
          owner,
          source: records,
          parentSlug: 'parent',
          spaceId: PARENT_SPACE,
          markdown: PARENT_MARKDOWN
        })
    );

    expect(records.asked).toEqual(['space:elsewhere']);
    expect(report.checked).toBe(0);
    expect(report.conflicts).toHaveLength(0);
    expect(report.unavailable).toEqual([
      {
        key: 'adapter:space:elsewhere:shared-child',
        child_slug: 'shared-child',
        space: 'space:elsewhere'
      }
    ]);
  });

  test('a child outside the read scope is reported, not read', async () => {
    const records = source({
      [FOREIGN_SPACE]: [
        record(FOREIGN_SPACE, 'hidden-child', {
          slug: 'hidden-child',
          version: '1.0.0',
          inherits: 'parent',
          override: ['has_fur']
        })
      ]
    });

    const owner = {};
    attachGraphDb(graphWith([child('hidden-child', FOREIGN_SPACE)]), owner);
    const report = await runWithSpaceContextAsync(spaceContext([PARENT_SPACE]), () =>
      validateDescendantsForParentChange({
        owner,
        source: records,
        parentSlug: 'parent',
        spaceId: PARENT_SPACE,
        markdown: PARENT_MARKDOWN
      })
    );

    expect(records.asked).toEqual([]);
    expect(report.checked).toBe(0);
    expect(report.conflicts).toHaveLength(0);
    expect(report.unavailable.map((row) => row.space)).toEqual([FOREIGN_SPACE]);
  });

  test('a child node that records no scope is unavailable rather than guessed', async () => {
    const records = source({});
    const owner = {};
    attachGraphDb(graphWith([{ key: 'adapter:loose', slug: 'loose', space: '' }]), owner);

    const report = await runWithSpaceContextAsync(spaceContext([PARENT_SPACE]), () =>
      validateDescendantsForParentChange({
        owner,
        source: records,
        parentSlug: 'parent',
        spaceId: PARENT_SPACE,
        markdown: PARENT_MARKDOWN
      })
    );

    expect(records.asked).toEqual([]);
    expect(report.unavailable.map((row) => row.key)).toEqual(['adapter:loose']);
  });

  test('a stale edge whose record declares another parent is skipped', async () => {
    const records = source({
      [PARENT_SPACE]: [
        record(PARENT_SPACE, 'stale-child', {
          slug: 'stale-child',
          version: '1.0.0',
          inherits: 'some-other-parent'
        })
      ]
    });

    const owner = {};
    attachGraphDb(graphWith([child('stale-child', PARENT_SPACE)]), owner);
    const report = await runWithSpaceContextAsync(spaceContext([PARENT_SPACE]), () =>
      validateDescendantsForParentChange({
        owner,
        source: records,
        parentSlug: 'parent',
        spaceId: PARENT_SPACE,
        markdown: PARENT_MARKDOWN
      })
    );

    expect(report.checked).toBe(0);
    expect(report.conflicts).toHaveLength(0);
    expect(report.unavailable).toHaveLength(0);
  });

  test('a valid descendant is checked without producing a conflict', async () => {
    const records = source({
      [PARENT_SPACE]: [
        record(PARENT_SPACE, 'good-child', {
          slug: 'good-child',
          version: '1.0.0',
          inherits: 'parent'
        })
      ]
    });

    const owner = {};
    attachGraphDb(graphWith([child('good-child', PARENT_SPACE)]), owner);
    const report = await runWithSpaceContextAsync(spaceContext([PARENT_SPACE]), () =>
      validateDescendantsForParentChange({
        owner,
        source: records,
        parentSlug: 'parent',
        spaceId: PARENT_SPACE,
        markdown: PARENT_MARKDOWN
      })
    );

    expect(report.checked).toBe(1);
    expect(report.conflicts).toHaveLength(0);
  });

  test('no attached graph means nothing to validate, not a failure', async () => {
    const report = await runWithSpaceContextAsync(spaceContext([PARENT_SPACE]), () =>
      validateDescendantsForParentChange({
        owner: {},
        source: source({}),
        parentSlug: 'parent',
        spaceId: PARENT_SPACE,
        markdown: PARENT_MARKDOWN
      })
    );

    expect(report).toEqual({
      parent_slug: 'parent',
      checked: 0,
      conflicts: [],
      unavailable: []
    });
  });

  test('a conflicted parent change throws the actionable error', async () => {
    const records = source({
      [PARENT_SPACE]: [
        record(PARENT_SPACE, 'blocking-child', {
          slug: 'blocking-child',
          version: '1.0.0',
          inherits: 'parent',
          override: ['has_fur']
        })
      ]
    });

    const owner = {};
    attachGraphDb(graphWith([child('blocking-child', PARENT_SPACE)]), owner);

    await expect(
      runWithSpaceContextAsync(spaceContext([PARENT_SPACE]), () =>
        assertDescendantsValid({
          owner,
          source: records,
          parentSlug: 'parent',
          spaceId: PARENT_SPACE,
          markdown: PARENT_MARKDOWN
        })
      )
    ).rejects.toBeInstanceOf(DescendantValidationError);
  });
});
