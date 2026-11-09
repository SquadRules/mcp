/**
 * Backend-neutral inheritance merge — UNIT, against the real function.
 *
 * This suite calls `mergeResolvedProperties()` itself, the function both repositories
 * (LadybugDB and ArangoDB) hand their root-first ancestor chain to, so "effective
 * properties" cannot drift between backends (ADR 0043, docs/specs/graph-schema.md §5.4).
 * It replaces an earlier suite that re-implemented the algorithm inline and asserted the
 * copy: that version encoded `version` as inheritable and `space` as inheritable, both of
 * which production treats as identity fields.
 *
 * Semantics pinned here:
 *   - the root ancestor contributes every field it declares;
 *   - a later level contributes a field only when the field is absent or the level names
 *     it in its own `override:` list;
 *   - identity and structural fields always come from the child;
 *   - an empty ancestor list yields the child unchanged.
 */
import { describe, expect, jest, test } from '@jest/globals';

import {
  INHERITANCE_IDENTITY_FIELDS,
  mergeResolvedProperties
} from '../../src/services/graph-db/inheritance-merge.js';
import type { AdapterNode } from '../../src/services/graph-db/graph-types.js';

const SPACE = 'space:test';

function node(overrides: Partial<AdapterNode> & { slug: string }): AdapterNode {
  return {
    key: `adapter:${SPACE}:${overrides.slug}`,
    type: 'adapter',
    version: '1.0.0',
    title: overrides.slug,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides
  } as AdapterNode;
}

describe('mergeResolvedProperties — override semantics (ADR 0043)', () => {
  test('fields in the child override list come from the child; others from the parent', () => {
    const parent = node({
      slug: 'parent',
      version: '2.0.0',
      title: 'Parent Title',
      layer_count: 5,
      contract_types: ['shell'],
      space: 'personal',
      tags: ['parent-tag'],
      metadata: {}
    });
    const child = node({
      slug: 'child',
      version: '1.0.0',
      title: 'Child Title',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      frontmatter: { slug: 'child', version: '1.0.0', inherits: 'parent', override: ['tags'] },
      layer_count: 0,
      contract_types: [],
      space: 'personal',
      tags: ['child-tag'],
      metadata: {}
    });

    const merged = mergeResolvedProperties(child, [parent]);

    // `tags` is named in the child's override list → the child's value wins.
    expect(merged.tags).toEqual(['child-tag']);
    // Not overridden and already present from the parent → the parent's value survives.
    expect(merged.title).toBe('Parent Title');
    expect(merged.layer_count).toBe(5);
    expect(merged.contract_types).toEqual(['shell']);
    // Identity fields always come from the child, even though the parent disagrees.
    expect(merged.key).toBe(`adapter:${SPACE}:child`);
    expect(merged.slug).toBe('child');
    expect(merged.type).toBe('adapter');
    expect(merged.created_at).toBe('2026-01-02T00:00:00Z');
    expect(merged.updated_at).toBe('2026-01-02T00:00:00Z');
    expect(merged.version).toBe('1.0.0');
  });

  test('multi-level merge: child overrides parent overrides grandparent', () => {
    const grandparent = node({
      slug: 'grandparent',
      version: '3.0.0',
      title: 'Grandparent Title',
      layer_count: 10,
      contract_types: ['shell', 'forward'],
      space: 'team',
      tags: ['gp-tag'],
      metadata: { origin: 'grandparent' }
    });
    const parent = node({
      slug: 'parent',
      version: '2.0.0',
      title: 'Parent Title',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      frontmatter: { slug: 'parent', version: '2.0.0', inherits: 'grandparent', override: ['title', 'tags'] },
      layer_count: 0,
      contract_types: [],
      space: 'team',
      tags: ['parent-tag'],
      metadata: {}
    });
    const child = node({
      slug: 'child',
      version: '1.0.0',
      title: 'Child Title',
      created_at: '2026-01-03T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
      frontmatter: { slug: 'child', version: '1.0.0', inherits: 'parent', override: ['version'] },
      layer_count: 0,
      contract_types: [],
      space: 'personal',
      tags: ['child-tag'],
      metadata: {}
    });

    // Root-first, as both repositories hand the chain over.
    const merged = mergeResolvedProperties(child, [grandparent, parent]);

    // `version` is an identity field: the child's value wins regardless of `override:`.
    expect(merged.version).toBe('1.0.0');
    // parent named title/tags in its override list → parent's values beat the grandparent's.
    expect(merged.title).toBe('Parent Title');
    expect(merged.tags).toEqual(['parent-tag']);
    // Not overridden by anyone → the grandparent's values survive two levels down.
    expect(merged.layer_count).toBe(10);
    expect(merged.contract_types).toEqual(['shell', 'forward']);
    expect(merged.metadata).toEqual({ origin: 'grandparent' });
    // `space` is identity too: the child's scope wins over the grandparent's 'team'.
    expect(merged.space).toBe('personal');
    expect(merged.key).toBe(`adapter:${SPACE}:child`);
    expect(merged.slug).toBe('child');
  });

  test('no ancestors: the child is returned unchanged', () => {
    const child = node({ slug: 'standalone', frontmatter: { slug: 'standalone', version: '1.0.0' } });

    const merged = mergeResolvedProperties(child, []);

    expect(merged.slug).toBe('standalone');
    expect(merged.key).toBe(`adapter:${SPACE}:standalone`);
    expect(merged).not.toBe(child);
    expect(merged).toEqual({ ...child });
  });

  test('structural fields a descendant must never inherit are enumerated', () => {
    // A regression guard for the list itself: `verdict`/`work_envelope` are a worker's
    // evidence, `frontmatter` carries `inherits:`/`override:` — none may be inherited.
    for (const field of ['key', 'type', 'slug', 'version', 'space', 'frontmatter', 'verdict', 'work_envelope']) {
      expect(INHERITANCE_IDENTITY_FIELDS).toContain(field);
    }
  });

  test('an ancestor cannot smuggle a verdict or work envelope down the chain', () => {
    const ancestor = node({
      slug: 'ancestor',
      title: 'Ancestor Title',
      verdict: 'PASS' as any,
      work_envelope: { attempts: 3 } as any
    });
    const child = node({ slug: 'child' });

    const merged = mergeResolvedProperties(child, [ancestor]);

    expect(merged.title).toBe('Ancestor Title');
    expect(merged.verdict).toBeUndefined();
    expect(merged.work_envelope).toBeUndefined();
  });
});

describe('mergeResolvedProperties — function shape', () => {
  test('does not mutate the child or its ancestors', () => {
    const ancestor = node({ slug: 'ancestor', tags: ['a'] });
    const child = node({ slug: 'child', tags: ['c'] });
    const beforeChild = JSON.stringify(child);
    const beforeAncestor = JSON.stringify(ancestor);

    mergeResolvedProperties(child, [ancestor]);

    expect(JSON.stringify(child)).toBe(beforeChild);
    expect(JSON.stringify(ancestor)).toBe(beforeAncestor);
  });

  test('is a pure function of its arguments (no spy surface)', () => {
    expect(jest.isMockFunction(mergeResolvedProperties)).toBe(false);
  });
});
