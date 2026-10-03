/**
 * Regression: activate/search output schemas include per-choice slug (github.com/jakub-plichcinski/squadrules-mcp#306).
 * Non-null slugs must satisfy {@link AUTHOR_SLUG_RE} (same as protocol frontmatter / train).
 * Valid examples are derived via {@link slugifyFromTitle} / {@link normalizeAuthorSlug} — not string literals.
 */

import { describe, expect, test } from '@jest/globals';
import {
  AUTHOR_SLUG_RE,
  normalizeAuthorSlug,
  slugifyFromTitle
} from '../../src/utils/protocol-slug.js';
import { getAdapterSlugForSearchOutput } from '../../src/services/memory/memory-accessors.js';
import { activateOutputSchema } from '../../src/tools/activate_schema.js';
import { searchOutputSchema } from '../../src/tools/search_schema.js';

const SAMPLE_ADAPTER_URI = 'squadrules://adapter/sample-adapter';

function slugWithUnderscoreBetweenSegments(): string {
  return [slugifyFromTitle('Left'), slugifyFromTitle('Right')].join('_');
}

function slugWithLeadingHyphen(): string {
  return `-${slugifyFromTitle('Tail')}`;
}

describe('AUTHOR_SLUG_RE (contract for non-null activate/search choice slugs)', () => {
  test('accepts outputs of slugifyFromTitle', () => {
    const fromH1 = slugifyFromTitle('Standardize Project — Analyze');
    expect(AUTHOR_SLUG_RE.test(fromH1)).toBe(true);
    expect(AUTHOR_SLUG_RE.test(slugifyFromTitle('Z'))).toBe(true);
  });

  test('accepts outputs of normalizeAuthorSlug for well-formed input', () => {
    const n = normalizeAuthorSlug(`${slugifyFromTitle('A')}-${slugifyFromTitle('B')}`);
    expect(n).not.toBeNull();
    expect(AUTHOR_SLUG_RE.test(n!)).toBe(true);
  });

  test('rejects empty string', () => {
    expect(AUTHOR_SLUG_RE.test('')).toBe(false);
  });

  test('rejects underscore, spaces, and leading hyphen without hardcoded fake slugs', () => {
    expect(AUTHOR_SLUG_RE.test(slugWithUnderscoreBetweenSegments())).toBe(false);
    expect(AUTHOR_SLUG_RE.test(`${slugifyFromTitle('A')} ${slugifyFromTitle('B')}`)).toBe(false);
    expect(AUTHOR_SLUG_RE.test(slugWithLeadingHyphen())).toBe(false);
  });

  test('rejects uppercase by mutating a normalized slug', () => {
    const lower = slugifyFromTitle('Qux');
    const mixed = lower.length > 0 ? lower[0]!.toUpperCase() + lower.slice(1) : lower;
    expect(AUTHOR_SLUG_RE.test(mixed)).toBe(false);
  });
});

describe('getAdapterSlugForSearchOutput', () => {
  test('trims and returns non-empty slug', () => {
    const inner = slugifyFromTitle('Whitespace Trim');
    expect(getAdapterSlugForSearchOutput({ slug: `  ${inner}  ` })).toBe(inner);
  });

  test('returns null for missing or blank slug', () => {
    expect(getAdapterSlugForSearchOutput({})).toBeNull();
    expect(getAdapterSlugForSearchOutput({ slug: '' })).toBeNull();
    expect(getAdapterSlugForSearchOutput({ slug: '   ' })).toBeNull();
  });
});

describe('searchOutputSchema slug field', () => {
  test('parses choices with slug null', () => {
    const r = searchOutputSchema.safeParse({
      must_obey: true,
      message: 'm',
      next_action: 'n',
      choices: [
        {
          uri: SAMPLE_ADAPTER_URI,
          label: 'l',
          adapter_name: 'a',
          score: 0.5,
          role: 'match',
          tags: [],
          next_action: 'x',
          adapter_version: '1.0.0',
          space_name: 'Personal',
          slug: null
        }
      ]
    });
    expect(r.success).toBe(true);
  });

  test('parses choices with slug string that matches AUTHOR_SLUG_RE', () => {
    const slug = slugifyFromTitle('Search Schema Choice');
    expect(AUTHOR_SLUG_RE.test(slug)).toBe(true);
    const r = searchOutputSchema.safeParse({
      must_obey: true,
      message: 'm',
      next_action: 'n',
      choices: [
        {
          uri: SAMPLE_ADAPTER_URI,
          label: 'l',
          adapter_name: 'a',
          score: 0.5,
          role: 'match',
          tags: [],
          next_action: 'x',
          adapter_version: '1.0.0',
          space_name: 'Personal',
          slug
        }
      ]
    });
    expect(r.success).toBe(true);
  });

  test('rejects choice object without slug', () => {
    const r = searchOutputSchema.safeParse({
      must_obey: true,
      message: 'm',
      next_action: 'n',
      choices: [
        {
          uri: SAMPLE_ADAPTER_URI,
          label: 'l',
          adapter_name: 'a',
          score: 0.5,
          role: 'match',
          tags: [],
          next_action: 'x',
          adapter_version: '1.0.0',
          space_name: 'Personal'
        }
      ]
    });
    expect(r.success).toBe(false);
  });
});

describe('activateOutputSchema slug field', () => {
  test('parses choices with slug', () => {
    const matchSlug = slugifyFromTitle('Activate Output Match');
    expect(AUTHOR_SLUG_RE.test(matchSlug)).toBe(true);
    const r = activateOutputSchema.safeParse({
      must_obey: true,
      message: 'm',
      next_action: 'n',
      query: 'q',
      choices: [
        {
          uri: SAMPLE_ADAPTER_URI,
          label: 'l',
          adapter_name: 'a',
          activation_score: 0.5,
          role: 'match',
          tags: [],
          next_action: 'x',
          adapter_version: '1.0.0',
          space_name: 'Personal',
          slug: matchSlug,
          forward_first_call: {
            uri: `squadrules://adapter/${matchSlug}`
          },
          linked_artifacts: [
            {
              slug: 'helper-py',
              filename: 'helper.py',
              relative_path: 'artifacts/helper.py',
              download_url: 'https://example.test/export/artifact/token',
              sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              content_type: 'text/x-python',
              materialize:
                'curl -fsSL https://example.test/export/artifact/token -o "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/helper.py"'
            }
          ]
        },
        {
          uri: 'squadrules://adapter/refine-search',
          label: 'refine',
          adapter_name: 'refine',
          activation_score: null,
          role: 'refine',
          tags: [],
          next_action: 'r',
          adapter_version: null,
          space_name: null,
          slug: null,
          forward_first_call: {
            uri: 'squadrules://adapter/refine-search'
          }
        }
      ]
    });
    expect(r.success).toBe(true);
  });
});
