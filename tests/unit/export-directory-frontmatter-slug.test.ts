/**
 * Issue #201 gap 2: directory exports must be named `<slug>.md` using the human-facing
 * slug from the adapter document's frontmatter. `all_adapters` selections enumerate
 * canonical `squadrules://adapter/{uuid}` URIs, so the URI id alone would name files by
 * UUID and break scripted `tune squadrules://adapter/<slug> --file <slug>.md` round-trips.
 */
import { describe, expect, it } from '@jest/globals';
import { markdownFrontmatterSlug } from '../../src/tools/export.js';

describe('markdownFrontmatterSlug (issue #201 gap 2)', () => {
  it('extracts the slug from YAML frontmatter', () => {
    expect(markdownFrontmatterSlug('---\nslug: writing-for-humans\nversion: 1.2.3\n---\n\n# Title\n')).toBe(
      'writing-for-humans'
    );
  });

  it('handles CRLF frontmatter', () => {
    expect(markdownFrontmatterSlug('---\r\nslug: task-isolation\r\n---\r\n\r\n# Title\r\n')).toBe('task-isolation');
  });

  it('returns empty when there is no frontmatter', () => {
    expect(markdownFrontmatterSlug('# Just a document\n\nslug: not-frontmatter\n')).toBe('');
  });

  it('returns empty when the frontmatter has no slug key', () => {
    expect(markdownFrontmatterSlug('---\nversion: 1.0.0\n---\n\n# Title\n')).toBe('');
  });

  it('ignores slug-looking lines outside the frontmatter block', () => {
    expect(markdownFrontmatterSlug('---\nversion: 1.0.0\n---\n\nBody text\nslug: decoy\n')).toBe('');
  });
});
