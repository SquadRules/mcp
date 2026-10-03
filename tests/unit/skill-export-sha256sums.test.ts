// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import {
  appendSha256SumsToSkillExportItem,
  buildSha256SumsContent,
  SKILL_EXPORT_SHA256_SUMS_FILENAME
} from '../../src/tools/skill-export/sha256sums.js';
import { sha256Hex } from '../../src/tools/skill-export/sha256.js';
import type { SkillExportFile } from '../../src/tools/skill-export/types.js';

describe('skill export SHA256SUMS', () => {
  it('builds GNU-style lines sorted by path and excludes the sums file from input', () => {
    const a: SkillExportFile = {
      path: 'artifacts/b.py',
      content: 'b',
      contentType: 'text/x-python',
      sha256: sha256Hex('b')
    };
    const skill: SkillExportFile = {
      path: 'SKILL.md',
      content: '# x',
      contentType: 'text/markdown',
      sha256: sha256Hex('# x')
    };
    const body = buildSha256SumsContent([a, skill]);
    const lines = body.trim().split('\n');
    expect(lines[0]).toContain('  SKILL.md');
    expect(lines[1]).toContain('  artifacts/b.py');
    expect(body.endsWith('\n')).toBe(true);
  });

  it('appends SHA256SUMS whose hash matches its UTF-8 bytes', () => {
    const item = appendSha256SumsToSkillExportItem({
      slug: 's',
      name: 'n',
      description: 'd',
      squadrulesUri: 'kairos://adapter/x',
      files: [
        {
          path: 'SKILL.md',
          content: 'body',
          contentType: 'text/markdown',
          sha256: sha256Hex('body')
        }
      ],
      diagnostics: []
    });
    const sums = item.files.find((f) => f.path === SKILL_EXPORT_SHA256_SUMS_FILENAME);
    expect(sums).toBeDefined();
    expect(sums!.contentType).toBe('text/plain');
    expect(typeof sums!.content).toBe('string');
    expect(sums!.sha256).toBe(sha256Hex(sums!.content as string));
    expect((sums!.content as string).trim().split('\n')).toHaveLength(1);
  });
});
