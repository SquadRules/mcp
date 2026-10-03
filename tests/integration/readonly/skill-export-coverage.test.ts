/**
 * Single-adapter coverage for skill_tree / skill_zip exports.
 *
 *  - skill_tree single-adapter shape (lists SKILL.md and SHA256SUMS, no fabricated artifacts/)
 *  - skill_zip without any stored artifact memories: JSON returns download_ref,
 *    downloaded ZIP has no fabricated artifacts/
 *  - layout independence: export resolves stored content via URI without depending on any
 *    on-disk source layout (proven by training a unique slug and round-tripping the body)
 *
 * The multi-adapter and all_adapters cases live in skill-export-multi.test.ts.
 */

import { indexZipEntriesByPath } from '../../utils/zip-parser.js';
import { isHttpTransport } from '../../utils/auth-headers.js';
import {
  buildAdapterMarkdown,
  downloadSkillZip,
  exportJson,
  trainAdapterMarkdown,
  type ExportSkillTreeResponse,
  type ExportSkillZipResponse,
  type SkillBundleManifest
} from '../skill-export-shared.js';

const _d = isHttpTransport() ? describe : describe.skip;

_d('skill-export single-adapter coverage', () => {
  test('skill_tree single-adapter shape: lists files including SKILL.md and SHA256SUMS', async () => {
    const ts = Date.now().toString();
    const slug = `tree-single-${ts}`;
    const a = await trainAdapterMarkdown(buildAdapterMarkdown(slug, `Tree Single ${ts}`));

    const data = await exportJson<ExportSkillTreeResponse>({ uri: a.adapterUri, format: 'skill_tree' });
    expect(data.format).toBe('skill_tree');
    expect(data.content_type).toBe('application/json');
    expect(data.export_adapter_count).toBe(1);

    const tree = JSON.parse(data.content) as {
      format: string;
      version: number;
      skills: Array<{
        slug: string;
        version?: string | null;
        squadrules_uri: string;
        files: Array<{ path: string; content: string }>;
        diagnostics: Array<unknown>;
      }>;
    };
    expect(tree.format).toBe('skill_tree');
    expect(tree.version).toBe(1);
    expect(tree.skills.length).toBe(1);
    const skill = tree.skills[0]!;
    expect(skill.slug).toBe(slug);
    // version field must be present in the per-skill object (null when adapter has no version)
    expect(skill).toHaveProperty('version');
    // skill_tree may carry the adapter slug (`squadrules://adapter/<slug>`) or the head layer row (`squadrules://layer/<uuid>`).
    expect(skill.squadrules_uri).toMatch(
      /^squadrules:\/\/(?:adapter\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|layer\/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12})/i
    );

    const paths = skill.files.map((f) => f.path);
    expect(paths).toContain('SKILL.md');
    expect(paths).toContain('SHA256SUMS');
    expect(paths.some((p) => p.startsWith('artifacts/'))).toBe(false);
    expect(skill.files.find((f) => f.path === 'SKILL.md')!.content).toContain(`# Tree Single ${ts}`);
  }, 60000);

  test('skill_zip with no artifacts: download_ref ZIP has no fabricated artifacts/', async () => {
    const ts = Date.now().toString();
    const slug = `zip-no-art-${ts}`;
    const a = await trainAdapterMarkdown(
      buildAdapterMarkdown(slug, `Zip No Art ${ts}`, 'See artifacts/sort.py for details (no such artifact stored).')
    );

    const data = await exportJson<ExportSkillZipResponse>({ uri: a.adapterUri, format: 'skill_zip' });
    expect(data.format).toBe('skill_zip');
    expect(data.download_ref?.url).toContain('/export/skill-zip/');
    expect(data.content_encoding).toBeUndefined();

    const manifest = JSON.parse(data.skill_bundle_manifest) as SkillBundleManifest;
    expect(manifest.type).toBe('skill_bundle');
    expect(manifest.skills.length).toBe(1);
    expect(manifest.skills[0]!.slug).toBe(slug);
    expect(manifest.skills[0]!.entrypoint).toBe(`${slug}/SKILL.md`);
    // version field must be present in the manifest per-skill entry
    expect(manifest.skills[0]!).toHaveProperty('version');
    // No artifact memory was trained for this adapter; the bundle must NOT fabricate one
    // even though the markdown body mentions an artifact path.
    expect(manifest.skills[0]!.artifacts).toEqual([]);

    const entries = indexZipEntriesByPath(await downloadSkillZip(data));
    expect(entries.has(`${slug}/SKILL.md`)).toBe(true);
    expect(entries.has(`${slug}/SHA256SUMS`)).toBe(true);
    for (const path of entries.keys()) {
      expect(path.startsWith(`${slug}/artifacts/`)).toBe(false);
    }
  }, 60000);

  test('layout independence: export resolves stored content via URI even with no on-disk source for that adapter', async () => {
    const ts = Date.now().toString();
    const slug = `layout-indep-${ts}`;
    const distinctiveBody = `unique-text-${ts} that exists only in the trained content`;
    const md = buildAdapterMarkdown(slug, `Layout Indep ${ts}`, distinctiveBody);
    const a = await trainAdapterMarkdown(md);

    // The slug is brand-new; nothing on disk could have provided it. Markdown export by URI
    // must round-trip the trained body, proving the export reads from the store, not from
    // any local source-tree layout.
    const mdResp = await exportJson<{ content: string; format: string }>({
      uri: a.adapterUri,
      format: 'markdown'
    });
    expect(mdResp.format).toBe('markdown');
    expect(mdResp.content).toContain(distinctiveBody);

    const treeResp = await exportJson<ExportSkillTreeResponse>({
      uri: a.adapterUri,
      format: 'skill_tree'
    });
    const tree = JSON.parse(treeResp.content) as {
      skills: Array<{ slug: string; files: Array<{ path: string; content: string }> }>;
    };
    expect(tree.skills.length).toBe(1);
    expect(tree.skills[0]!.slug).toBe(slug);
    expect(tree.skills[0]!.files.find((f) => f.path === 'SKILL.md')!.content).toContain(distinctiveBody);
  }, 60000);
});
