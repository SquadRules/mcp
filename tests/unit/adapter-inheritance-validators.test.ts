/**
 * Pure validator tests for adapter inheritance frontmatter (Touchpoint 3).
 *
 * Honest naming: no doubles and no I/O here — `validateInheritanceFrontmatter`,
 * `parseOverrideList` and `isInheritsArray` are pure functions, so this suite is direct
 * unit evidence for the validation rules and nothing more. The end-to-end behaviour
 * (fail before the memory write, warning surfacing on the MCP response) is covered by
 * `graph-db-train-unit.test.ts` and `graph-db-train-response.test.ts`.
 *
 * Split out of `graph-db-train-unit.test.ts` when that file exceeded the 350-line cap;
 * the describe blocks and assertions are unchanged.
 */
import { describe, expect, test } from '@jest/globals';

import {
  validateInheritanceFrontmatter,
  parseOverrideList,
  isInheritsArray,
  STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS,
  type InheritanceFrontmatter
} from '../../src/services/graph-db/adapter-inheritance.js';

describe('adapter-inheritance validators (Touchpoint 3)', () => {
  describe('parseOverrideList', () => {
    test('parses bracket-delimited list', () => {
      expect(parseOverrideList('[tags, metadata]')).toEqual(['tags', 'metadata']);
    });

    test('parses comma-separated list without brackets', () => {
      expect(parseOverrideList('tags, metadata')).toEqual(['tags', 'metadata']);
    });

    test('returns empty array for undefined/null/empty', () => {
      expect(parseOverrideList(undefined)).toEqual([]);
      expect(parseOverrideList(null)).toEqual([]);
      expect(parseOverrideList('')).toEqual([]);
      expect(parseOverrideList('[]')).toEqual([]);
    });

    test('strips quotes from values', () => {
      expect(parseOverrideList("['tags', \"metadata\"]")).toEqual(['tags', 'metadata']);
    });
  });

  describe('isInheritsArray', () => {
    test('detects bracket-delimited array', () => {
      expect(isInheritsArray('[parent-a, parent-b]')).toBe(true);
    });

    test('detects comma-separated values', () => {
      expect(isInheritsArray('parent-a, parent-b')).toBe(true);
    });

    test('returns false for single slug', () => {
      expect(isInheritsArray('critic-loop')).toBe(false);
    });

    test('returns false for undefined/null', () => {
      expect(isInheritsArray(undefined)).toBe(false);
      expect(isInheritsArray(null)).toBe(false);
    });
  });

  describe('validateInheritanceFrontmatter', () => {
    test('returns no errors/warnings when inherits is absent', () => {
      const result = validateInheritanceFrontmatter({ slug: 'test' }, null);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test('single_parent rejects array-style inherits', () => {
      const fm: InheritanceFrontmatter = {
        inherits: '[parent-a, parent-b]'
      };
      const result = validateInheritanceFrontmatter(fm, null);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe('single_parent');
      expect(result.errors[0]!.message).toContain('not an array');
    });

    test('single_parent rejects comma-separated inherits', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'parent-a, parent-b'
      };
      const result = validateInheritanceFrontmatter(fm, null);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe('single_parent');
    });

    test('structural_override_forbidden rejects contract field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['contract']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'contract')).toBe(true);
    });

    test('structural_override_forbidden rejects type field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['type']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'type')).toBe(true);
    });

    test('structural_override_forbidden rejects steps field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['steps']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'steps')).toBe(true);
    });

    test('structural_override_forbidden rejects chain_root field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['chain_root']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'chain_root')).toBe(true);
    });

    test('structural_override_forbidden rejects inherits field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['inherits']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'inherits')).toBe(true);
    });

    test('structural_override_forbidden rejects override field', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['override']
      };
      const result = validateInheritanceFrontmatter(fm, { slug: 'critic-loop', version: '1.0.0' });
      expect(result.errors.some((e) => e.code === 'structural_override_forbidden' && e.field === 'override')).toBe(true);
    });

    test('override_unknown_field rejects field not in parent frontmatter', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['nonexistent_field']
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '2.1.0'
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors.some((e) => e.code === 'override_unknown_field' && e.field === 'nonexistent_field')).toBe(true);
    });

    test('override_unknown_field allows field present in parent frontmatter', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['version']
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '2.1.0'
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors.filter((e) => e.code === 'override_unknown_field')).toHaveLength(0);
    });

    test('override_unknown_field allows known overridable fields (tags, metadata)', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['tags', 'metadata']
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '2.1.0'
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors.filter((e) => e.code === 'override_unknown_field')).toHaveLength(0);
    });

    test('parent_missing emits warning when parent frontmatter is null', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'unknown-parent',
        override: ['tags']
      };
      const result = validateInheritanceFrontmatter(fm, null);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.code).toBe('parent_missing');
      expect(result.warnings[0]!.message).toContain('unknown-parent');
    });

    test('parent_missing does NOT emit error (graceful degradation)', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'unknown-parent'
      };
      const result = validateInheritanceFrontmatter(fm, null);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });

    test('happy path: valid inheritance with known override fields', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['tags', 'metadata'],
        slug: 'specialized-reviewer',
        version: '1.0.0'
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '2.1.0',
        tags: ['review'],
        metadata: {}
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test('multiple errors are accumulated', () => {
      const fm: InheritanceFrontmatter = {
        inherits: 'critic-loop',
        override: ['contract', 'type', 'nonexistent']
      };
      const parentFm: InheritanceFrontmatter = {
        slug: 'critic-loop',
        version: '1.0.0'
      };
      const result = validateInheritanceFrontmatter(fm, parentFm);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.errors.filter((e) => e.code === 'structural_override_forbidden')).toHaveLength(2);
      expect(result.errors.filter((e) => e.code === 'override_unknown_field')).toHaveLength(1);
    });
  });

  describe('STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS', () => {
    test('contains all expected fields', () => {
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('contract')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('type')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('steps')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('chain_root')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('inherits')).toBe(true);
      expect(STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS.has('override')).toBe(true);
    });
  });
});
