import { describe, expect, it } from '@jest/globals';
import { extractArtifactMetadata } from '../../src/services/memory/artifact-metadata.js';

describe('extractArtifactMetadata', () => {
  it('parses python header after shebang', () => {
    const content = `#!/usr/bin/env python3
# squadrules-artifact:
#   slug: sort-jira-py
#   version: 2
print("ok")`;
    expect(extractArtifactMetadata(content, 'fallback.py')).toEqual({
      slug: 'sort-jira-py',
      version: '2',
      slug_source: 'header'
    });
  });

  it('falls back to slug from artifact name and default version', () => {
    const content = 'echo "ok"';
    expect(extractArtifactMetadata(content, 'verify_briefing.sh')).toEqual({
      slug: 'verify-briefing-sh',
      version: '1',
      slug_source: 'name'
    });
  });

  it('rejects invalid slug in header', () => {
    const content = `# squadrules-artifact:
#   slug: Invalid_Slug
#   version: 1
echo "ok"`;
    expect(() => extractArtifactMetadata(content, 'fallback.sh')).toThrow('Invalid artifact slug');
  });
});
