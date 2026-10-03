/**
 * Multi-adapter and all_adapters coverage for skill_zip exports.
 *
 *  - skill_zip with a stored artifact: artifacts/<name> populated and SHA256SUMS
 *    lists the artifact's true content hash
 *  - skill_zip multi-adapter via adapters[]: each adapter is its own top-level folder
 *  - all_adapters + space_name on a **group** space (full dev: `/shared/ci-test`; skipped in
 *    `ENV=dev_simple` because simple/single mode has no shared `/shared/...` spaces)
 *
 * Single-adapter shape and layout-independence cases live in skill-export-coverage.test.ts.
 */

import { createHash } from 'node:crypto';
import { indexZipEntriesByPath } from '../../utils/zip-parser.js';
import { isHttpTransport } from '../../utils/auth-headers.js';
import {
  buildAdapterMarkdown,
  downloadSkillZip,
  exportJson,
  exportRaw,
  trainAdapterMarkdown,
  trainArtifact,
  type ExportSkillZipResponse,
  type SkillBundleManifest
} from '../skill-export-shared.js';

/** Integration Simple (`ENV=dev_simple`) exposes only personal/app surfaces, not group spaces. */
const allAdaptersSpaceExportSupported = process.env.ENV !== 'dev_simple';
const _d = isHttpTransport() ? describe : describe.skip;

_d('skill-export multi-adapter coverage', () => {
  test('skill_zip with artifact: artifacts/<name> populated; SHA256SUMS lists artifact hash', async () => {
    const ts = Date.now().toString();
    const slug = `zip-with-art-${ts}`;
    const artifactName = `tool-${ts}.py`;
    const artifactSlug = `tool-${ts}-py`;
    // No leading/trailing whitespace: executeTrain trims input.content before storage,
    // so a trailing newline here would not survive the round-trip and would cause a
    // misleading byte-equality failure. Keeping the body trimmed is the actual contract.
    const artifactBody = [
      '#!/usr/bin/env python3',
      '# squadrules-artifact:',
      `#   slug: ${artifactSlug}`,
      '#   version: 1',
      '',
      `print("artifact ${ts}")`
    ].join('\n');

    const a = await trainAdapterMarkdown(buildAdapterMarkdown(slug, `Zip With Art ${ts}`));
    await trainArtifact(a.adapterUri, artifactName, 'text/x-python', artifactBody);

    const data = await exportJson<ExportSkillZipResponse>({ uri: a.adapterUri, format: 'skill_zip' });
    expect(data.download_ref?.url).toContain('/export/skill-zip/');
    const buf = await downloadSkillZip(data);

    const manifest = JSON.parse(data.skill_bundle_manifest) as SkillBundleManifest;
    expect(manifest.skills.length).toBe(1);
    expect(manifest.skills[0]!.artifacts).toContain(`${slug}/artifacts/${artifactName}`);

    const entries = indexZipEntriesByPath(buf);
    const skillEntry = entries.get(`${slug}/SKILL.md`);
    const artifactEntry = entries.get(`${slug}/artifacts/${artifactName}`);
    const sumsEntry = entries.get(`${slug}/SHA256SUMS`);
    expect(skillEntry).toBeDefined();
    expect(artifactEntry).toBeDefined();
    expect(sumsEntry).toBeDefined();
    expect(artifactEntry!.content.toString('utf8')).toBe(artifactBody);

    const sumsLines = sumsEntry!.content.toString('utf8').trim().split('\n');
    const sumsByPath = new Map<string, string>();
    for (const line of sumsLines) {
      const m = /^([a-f0-9]{64})\s\s(.+)$/.exec(line);
      if (m) sumsByPath.set(m[2]!, m[1]!);
    }
    expect(sumsByPath.get('SKILL.md')).toBe(
      createHash('sha256').update(skillEntry!.content).digest('hex')
    );
    expect(sumsByPath.get(`artifacts/${artifactName}`)).toBe(
      createHash('sha256').update(artifactEntry!.content).digest('hex')
    );
    expect(sumsByPath.has('SHA256SUMS')).toBe(false);
  }, 60000);

  test('skill_zip multi-adapter via adapters[]: each adapter is its own top-level folder', async () => {
    const ts = Date.now().toString();
    const slugA = `multi-a-${ts}`;
    const slugB = `multi-b-${ts}`;
    const slugC = `multi-c-${ts}`;
    const adapters = [
      (await trainAdapterMarkdown(buildAdapterMarkdown(slugA, `Multi A ${ts}`))).adapterUri,
      (await trainAdapterMarkdown(buildAdapterMarkdown(slugB, `Multi B ${ts}`))).adapterUri,
      (await trainAdapterMarkdown(buildAdapterMarkdown(slugC, `Multi C ${ts}`))).adapterUri
    ];

    const data = await exportJson<ExportSkillZipResponse>({ adapters, format: 'skill_zip' });
    expect(data.export_adapter_count).toBe(3);
    const manifest = JSON.parse(data.skill_bundle_manifest) as SkillBundleManifest;
    const slugs = manifest.skills.map((s) => s.slug).sort();
    expect(slugs).toEqual([slugA, slugB, slugC].sort());
    // version field must be present in every manifest per-skill entry
    for (const s of manifest.skills) {
      expect(s).toHaveProperty('version');
    }

    const buf = await downloadSkillZip(data);
    const entries = indexZipEntriesByPath(buf);
    for (const slug of [slugA, slugB, slugC]) {
      expect(entries.has(`${slug}/SKILL.md`)).toBe(true);
      expect(entries.has(`${slug}/SHA256SUMS`)).toBe(true);
    }
    // Each top-level folder is exactly one of our three slugs (no leakage from other test data).
    const topLevels = new Set<string>();
    for (const path of entries.keys()) {
      topLevels.add(path.split('/')[0]!);
    }
    expect([...topLevels].sort()).toEqual([slugA, slugB, slugC].sort());
  }, 90000);

  (allAdaptersSpaceExportSupported ? test : test.skip)(
    'all_adapters + space_name positive path includes freshly trained adapters',
    async () => {
      expect.hasAssertions();
    // Use the ci-test group space rather than personal: squadrules-tester accumulates adapters in
    // personal across runs, and at scale it exceeds EXPORT_MAX_ADAPTERS=256 which is a separate
    // contract we test as a unit rejection elsewhere. The ci-test group is purpose-built for
    // integration runs and stays well under cap. The handler still rejects an over-cap space
    // with a 4xx, which we surface as an actionable failure if it ever happens here too.
    // Not run under dev_simple: that profile has no `/shared/...` group spaces (Personal + app only).
    const SPACE_NAME = '/shared/ci-test';
    const ts = Date.now().toString();
    const slugA = `all-a-${ts}`;
    const slugB = `all-b-${ts}`;
    await trainAdapterMarkdown(buildAdapterMarkdown(slugA, `All A ${ts}`), { space: SPACE_NAME });
    await trainAdapterMarkdown(buildAdapterMarkdown(slugB, `All B ${ts}`), { space: SPACE_NAME });

    // Qdrant upserts in store-adapter-default-handler / store-adapter-header-handler do not
    // pass `wait: true`. Poll the all_adapters export for a bounded time and assert that BOTH
    // freshly trained slugs appear in the manifest before giving up.
    const deadline = Date.now() + 30_000;
    let lastResStatus = 0;
    let lastBody: string | null = null;
    let data: ExportSkillZipResponse | null = null;
    let manifest: SkillBundleManifest | null = null;
    while (Date.now() < deadline) {
      const res = await exportRaw({
        all_adapters: true,
        space_name: SPACE_NAME,
        format: 'skill_zip'
      });
      lastResStatus = res.status;
      const bodyText = await res.text();
      if (res.status >= 400) {
        // Gate: target space exceeds EXPORT_MAX_ADAPTERS or another schema-level rejection.
        // Fail loudly with an actionable message rather than silently passing.
        throw new Error(
          `all_adapters export rejected (HTTP ${res.status}): ${bodyText}\n` +
            'Fix: clean accumulated adapters from the target space, or pick a less-poisoned space, before re-running.'
        );
      }
      data = JSON.parse(bodyText) as ExportSkillZipResponse;
      manifest = JSON.parse(data.skill_bundle_manifest) as SkillBundleManifest;
      const slugs = manifest.skills.map((s) => s.slug);
      if (slugs.includes(slugA) && slugs.includes(slugB)) break;
      lastBody = bodyText.slice(0, 200);
      data = null;
      manifest = null;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!data || !manifest) {
      throw new Error(
        `all_adapters export never included both fresh slugs within deadline; last status=${lastResStatus} body=${lastBody}`
      );
    }
    expect(data.format).toBe('skill_zip');
    expect(data.export_adapter_count).toBeGreaterThanOrEqual(2);

    const slugs = manifest.skills.map((s) => s.slug);
    expect(slugs).toContain(slugA);
    expect(slugs).toContain(slugB);

    const buf = await downloadSkillZip(data);
    const entries = indexZipEntriesByPath(buf);
    expect(entries.has(`${slugA}/SKILL.md`)).toBe(true);
    expect(entries.has(`${slugB}/SKILL.md`)).toBe(true);
  },
  120000
  );
});
