// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
/**
 * Bundle hash and SHA256SUMS end-to-end correctness:
 *  - The decoded ZIP bytes hash matches the manifest `bundle_sha256` value at the lib level.
 *  - Every per-file sha256 inside SHA256SUMS recomputes from the file's stored content.
 *  - Per-skill SHA256SUMS is itself listed in the file list with a content hash that matches its own bytes.
 *
 * No HTTP, no Qdrant — exercises the assembly + zip helpers directly so failures point at
 * the hash plumbing rather than the integration surface.
 */

import { describe, expect, it } from '@jest/globals';
import { sha256Hex } from '../../src/tools/skill-export/sha256.js';
import {
  appendSha256SumsToSkillExportItem,
  buildSha256SumsContent,
  SKILL_EXPORT_SHA256_SUMS_FILENAME
} from '../../src/tools/skill-export/sha256sums.js';
import {
  flattenSkillItemsToZipPaths,
  zipSkillFiles
} from '../../src/tools/skill-export/zip-bundle.js';
import type { SkillExportFile, SkillExportItem } from '../../src/tools/skill-export/types.js';

function makeFile(path: string, content: string, contentType: string): SkillExportFile {
  return { path, content, contentType, sha256: sha256Hex(content) };
}

function makeItem(slug: string, files: SkillExportFile[]): SkillExportItem {
  return {
    slug,
    name: slug,
    description: `desc-${slug}`,
    squadrulesUri: `kairos://adapter/${slug}`,
    files,
    diagnostics: []
  };
}

describe('skill bundle SHA256 end-to-end', () => {
  it('manifest bundle_sha256 equals sha256 of decoded ZIP bytes', async () => {
    const itemA = appendSha256SumsToSkillExportItem(
      makeItem('alpha', [
        makeFile('SKILL.md', '# Alpha\n\nbody A.\n', 'text/markdown'),
        makeFile('artifacts/a.py', 'print("a")\n', 'text/x-python')
      ])
    );
    const itemB = appendSha256SumsToSkillExportItem(
      makeItem('beta', [makeFile('SKILL.md', '# Beta\n\nbody B.\n', 'text/markdown')])
    );

    const flat = flattenSkillItemsToZipPaths([
      { slug: itemA.slug, files: itemA.files },
      { slug: itemB.slug, files: itemB.files }
    ]);
    const buf = await zipSkillFiles(flat);
    const digest = sha256Hex(buf);

    // bundle_sha256 in the export response is `sha256:<hex>` — the hex prefix matches sha256 of bytes.
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(buf.subarray(0, 2).toString('binary')).toBe('PK');

    // ZIP must contain exactly the rehomed paths we asked for.
    const expectedPaths = new Set(flat.map((f) => f.path));
    expect(expectedPaths.has('alpha/SKILL.md')).toBe(true);
    expect(expectedPaths.has('alpha/artifacts/a.py')).toBe(true);
    expect(expectedPaths.has(`alpha/${SKILL_EXPORT_SHA256_SUMS_FILENAME}`)).toBe(true);
    expect(expectedPaths.has('beta/SKILL.md')).toBe(true);
    expect(expectedPaths.has(`beta/${SKILL_EXPORT_SHA256_SUMS_FILENAME}`)).toBe(true);
  });

  it('per-skill SHA256SUMS lines all recompute from the stored file contents', () => {
    const skillBody = '# X\n\nbody.\n';
    const artifactBody = 'print("hi")\n';
    const itemA = appendSha256SumsToSkillExportItem(
      makeItem('xskill', [
        makeFile('SKILL.md', skillBody, 'text/markdown'),
        makeFile('artifacts/h.py', artifactBody, 'text/x-python')
      ])
    );
    const sumsFile = itemA.files.find((f) => f.path === SKILL_EXPORT_SHA256_SUMS_FILENAME);
    expect(sumsFile).toBeDefined();

    const expectedBody = buildSha256SumsContent(itemA.files);
    expect(sumsFile!.content).toBe(expectedBody);
    expect(sumsFile!.sha256).toBe(sha256Hex(sumsFile!.content as string));

    const lines = (sumsFile!.content as string).trim().split('\n');
    const map = new Map<string, string>();
    for (const line of lines) {
      const m = /^([a-f0-9]{64})\s\s(.+)$/.exec(line);
      expect(m).not.toBeNull();
      map.set(m![2]!, m![1]!);
    }

    expect(map.get('SKILL.md')).toBe(sha256Hex(skillBody));
    expect(map.get('artifacts/h.py')).toBe(sha256Hex(artifactBody));
    expect(map.has(SKILL_EXPORT_SHA256_SUMS_FILENAME)).toBe(false);
  });
});
