/**
 * Qualified-match selection (activation filtering).
 *
 * HONEST NAMING: this is a **unit** test of one pure function. It passes literal
 * candidate arrays and asserts the exact selection the pure selector produces. No store,
 * no graph, no embedding, no tool call. The end-to-end path (real LanceDB scores through
 * `selectQualifiedResults` into an `activate` response) is not covered here; the
 * production effective-content/forward path is covered by the real-DB integration suite.
 *
 * What it pins:
 *   - `>= MIN_QUALIFIED_MATCHES` qualified matches surface as the qualified set, capped at
 *     `MAX_QUALIFIED_MATCHES`, with no warning.
 *   - Fewer than that surfaces the real top `FALLBACK_MATCH_COUNT` matches plus a warning
 *     that states the exact counts — never a padded or synthesised row.
 *   - The threshold is a caller-supplied value, so the same candidates select differently
 *     at different thresholds.
 */
import { describe, expect, test } from '@jest/globals';

import type { Memory } from '../../src/types/memory.js';
import {
  FALLBACK_MATCH_COUNT,
  MAX_QUALIFIED_MATCHES,
  MIN_QUALIFIED_MATCHES,
  normalizePublicSearchScore,
  selectQualifiedResults
} from '../../src/tools/search_output.js';

interface CandidateInput {
  memory: Memory;
  score: number;
}

/** A minimal real memory: only the fields the pure selector reads. */
function memoryFor(slug: string): Memory {
  return {
    memory_uuid: `uuid-${slug}`,
    label: `${slug} label`,
    tags: [],
    text: '',
    llm_model_id: 'test-model',
    created_at: '2026-01-01T00:00:00.000Z',
    slug
  };
}

function candidate(slug: string, score: number): CandidateInput {
  return { memory: memoryFor(slug), score };
}

/** Slugs of a selection, in selection order. */
function slugsOf(selection: { results: Array<{ memory: Memory }> }): string[] {
  return selection.results.map((entry) => entry.memory.slug ?? '');
}

describe('selectQualifiedResults (unit)', () => {
  test('an empty candidate list selects nothing and does not warn', () => {
    const selection = selectQualifiedResults([], 0.5);

    expect(selection.results).toEqual([]);
    expect(selection.qualified_count).toBe(0);
    expect(selection.fallback).toBe(false);
    expect(selection.warning).toBeUndefined();
  });

  test('MIN_QUALIFIED_MATCHES qualified matches surface as the qualified set, in order, without a warning', () => {
    const candidates = [
      candidate('strong', 0.9),
      candidate('good', 0.7),
      candidate('ok', 0.6),
      candidate('edge', 0.55),
      candidate('weak', 0.1)
    ];

    const selection = selectQualifiedResults(candidates, 0.5);

    expect(MIN_QUALIFIED_MATCHES).toBe(3);
    expect(selection.qualified_count).toBe(4);
    expect(selection.fallback).toBe(false);
    expect(selection.warning).toBeUndefined();
    expect(slugsOf(selection)).toEqual(['strong', 'good', 'ok', 'edge']);
  });

  test('a large qualified set is capped at MAX_QUALIFIED_MATCHES', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => candidate(`adapter-${index}`, 0.9));

    const selection = selectQualifiedResults(candidates, 0.5);

    expect(selection.qualified_count).toBe(12);
    expect(selection.fallback).toBe(false);
    expect(selection.results).toHaveLength(MAX_QUALIFIED_MATCHES);
    expect(MAX_QUALIFIED_MATCHES).toBe(10);
  });

  test('too few qualified matches fall back to the real top 3 with the exact counts in the warning', () => {
    const candidates = [
      candidate('first', 0.9),
      candidate('second', 0.8),
      candidate('third', 0.2),
      candidate('fourth', 0.2),
      candidate('fifth', 0.2),
      candidate('sixth', 0.2),
      candidate('seventh', 0.2),
      candidate('eighth', 0.2)
    ];

    const selection = selectQualifiedResults(candidates, 0.5);

    expect(selection.qualified_count).toBe(2);
    expect(selection.fallback).toBe(true);
    expect(slugsOf(selection)).toEqual(['first', 'second', 'third']);
    expect(selection.results).toHaveLength(FALLBACK_MATCH_COUNT);
    expect(selection.warning).toBe(
      'Only 2 of 8 match(es) scored at or above the 0.5 threshold; returning the top 3 real match(es) instead.'
    );
  });

  test('zero qualified matches still return real candidates, never invented ones', () => {
    const candidates = [
      candidate('alpha', 0.11),
      candidate('beta', 0.12),
      candidate('gamma', 0.13),
      candidate('delta', 0.14)
    ];

    const selection = selectQualifiedResults(candidates, 0.5);

    expect(selection.qualified_count).toBe(0);
    expect(selection.fallback).toBe(true);
    expect(slugsOf(selection)).toEqual(['alpha', 'beta', 'gamma']);
    expect(selection.warning).toContain('Only 0 of 4 match(es)');
    // Every surfaced row is one of the inputs, in the input's real score.
    const inputSlugs = new Set(candidates.map((entry) => entry.memory.slug));
    for (const entry of selection.results) {
      expect(inputSlugs.has(entry.memory.slug)).toBe(true);
    }
  });

  test('the threshold is caller-supplied: the same candidates select differently at 0.5 and at 3', () => {
    const candidates = [
      candidate('three', 3),
      candidate('one', 1),
      candidate('point-six', 0.6),
      candidate('point-four', 0.4),
      candidate('point-two', 0.2)
    ];

    const atHalf = selectQualifiedResults(candidates, 0.5);
    expect(atHalf.qualified_count).toBe(3);
    expect(atHalf.fallback).toBe(false);
    expect(slugsOf(atHalf)).toEqual(['three', 'one', 'point-six']);

    const atThree = selectQualifiedResults(candidates, 3);
    expect(atThree.qualified_count).toBe(1);
    expect(atThree.fallback).toBe(true);
    expect(slugsOf(atThree)).toEqual(['three', 'one', 'point-six']);
    expect(atThree.warning).toContain('Only 1 of 5 match(es) scored at or above the 3 threshold');
  });

  test('maxChoices caps the qualified set only; the fallback set keeps FALLBACK_MATCH_COUNT rows', () => {
    const qualifiedCandidates = [
      candidate('q1', 0.9),
      candidate('q2', 0.9),
      candidate('q3', 0.9),
      candidate('q4', 0.9),
      candidate('q5', 0.9)
    ];
    const capped = selectQualifiedResults(qualifiedCandidates, 0.5, { maxChoices: 2 });
    expect(capped.fallback).toBe(false);
    expect(capped.qualified_count).toBe(5);
    expect(slugsOf(capped)).toEqual(['q1', 'q2']);

    const thinCandidates = [
      candidate('t1', 0.9),
      candidate('t2', 0.8),
      candidate('t3', 0.1),
      candidate('t4', 0.1)
    ];
    const fallback = selectQualifiedResults(thinCandidates, 0.5, { maxChoices: 1 });
    expect(fallback.fallback).toBe(true);
    expect(slugsOf(fallback)).toEqual(['t1', 't2', 't3']);
  });

  test('normalizePublicSearchScore is a bounded, monotonic confidence', () => {
    expect(normalizePublicSearchScore(0)).toBe(0);
    expect(normalizePublicSearchScore(undefined)).toBe(0);
    expect(normalizePublicSearchScore(Number.NaN)).toBe(0);
    expect(normalizePublicSearchScore(0.5)).toBeCloseTo(0.5, 10);
    expect(normalizePublicSearchScore(1)).toBeCloseTo(2 / 3, 10);
    expect(normalizePublicSearchScore(3)).toBeCloseTo(0.857142857, 8);
    expect(normalizePublicSearchScore(1)).toBeGreaterThan(normalizePublicSearchScore(0.5));
  });
});
