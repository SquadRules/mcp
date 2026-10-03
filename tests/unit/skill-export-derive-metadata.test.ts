import { describe, expect, it } from '@jest/globals';
import { deriveSkillMetadata, stripLeadingFrontmatter } from '../../src/tools/skill-export/derive-metadata.js';
import { buildSkillMdFile } from '../../src/tools/skill-export/build-skill-md.js';

describe('deriveSkillMetadata', () => {
  it('uses frontmatter name, slug, and description when present', () => {
    const md = `---
name: my-skill
slug: my-skill
description: From YAML
---

# Ignored Title

Body here.`;
    const out = deriveSkillMetadata({
      protocolMarkdown: md,
      label: 'L',
      squadrulesUri: 'squadrules://adapter/uuid'
    });
    expect(out.name).toBe('my-skill');
    expect(out.slug).toBe('my-skill');
    expect(out.description).toBe('From YAML');
  });

  it('falls back to first paragraph after H1 when no frontmatter description', () => {
    const md = `# Title Here

First para line one.
Second line still same paragraph.

## Next`;

    const out = deriveSkillMetadata({
      protocolMarkdown: md,
      label: 'Lab',
      squadrulesUri: 'squadrules://adapter/uuid'
    });
    expect(out.description).toContain('First para');
    expect(out.slug.length).toBeGreaterThan(0);
  });

  it('preserves contract wording in source markdown (caller strips frontmatter for body)', () => {
    const md = `# X\n\n\`\`\`json\n{"contract":{}}\n\`\`\`\n`;
    const stripped = stripLeadingFrontmatter(md);
    expect(stripped).toContain('"contract"');
  });
});

describe('buildSkillMdFile', () => {
  const baseMeta = { slug: 'test-skill', name: 'test-skill', description: 'A test skill' };
  const body = '# Test Skill\n\nBody content.';

  it('emits version in frontmatter when provided', () => {
    const out = buildSkillMdFile(baseMeta, body, '1.2.3');
    expect(out).toContain('version: 1.2.3');
    expect(out).toContain('name: test-skill');
    expect(out).toContain('description: A test skill');
  });

  it('omits version from frontmatter when null or undefined', () => {
    const outNull = buildSkillMdFile(baseMeta, body, null);
    const outUndef = buildSkillMdFile(baseMeta, body);
    expect(outNull).not.toContain('version:');
    expect(outUndef).not.toContain('version:');
    expect(outNull).toContain('name: test-skill');
    expect(outUndef).toContain('name: test-skill');
  });
});
