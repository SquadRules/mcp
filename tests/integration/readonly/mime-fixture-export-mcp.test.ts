// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import path from 'node:path';
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson } from '../../utils/expect-with-raw.js';
import {
  assertArtifactSumsMatchFixture,
  assertBundleSelfVerifies,
  assertSumsBodyByteIdentical,
  extractSumsFromSkillTree,
  extractSumsFromZip,
  loadFixtureSums
} from '../../utils/skill-bundle-sha-assert.js';
import {
  skillTreeToTrainInput,
  skillZipToTrainInput
} from '../../utils/skill-bundle-to-train-input.js';
import { cleanupViaMcp } from '../../utils/artifact-fixture-cleanup.js';
import { loadMimeArtifactContract, readMimeFixtureUtf8 } from '../../utils/mime-artifact-fixture-contract.js';
import {
  dumpMimeFixtureExport,
  ensureMimeFixtureExportDumpRootCleanBeforeMimeTests
} from '../../utils/mime-fixture-export-dump.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

async function trainStage0Fixture(mcp: Awaited<ReturnType<typeof createMcpConnection>>) {
  const contract = loadMimeArtifactContract();
  const trainAdapter = await mcp.client.callTool({
    name: 'train',
    arguments: { content: readMimeFixtureUtf8('SKILL.md'), llm_model_id: 'test-model', force_update: true,
      review_evidence: MOCK_REVIEW_EVIDENCE
    }
  });
  const adapterParsed = parseMcpJson(trainAdapter, 'mcp stage0 train adapter');
  const adapterUri = adapterParsed.items?.[0]?.adapter_uri as string;
  const artifactUris: string[] = [];
  for (const relPath of contract.artifactPaths) {
    const mime = contract.mimeByPath[relPath];
    if (!mime) throw new Error(`missing mime for ${relPath}`);
    const trainArtifactRes = await mcp.client.callTool({
      name: 'train',
      arguments: {
        content: readMimeFixtureUtf8(relPath),
        llm_model_id: 'test-model',
        mime,
        artifact_name: path.basename(relPath),
        adapter_uri: adapterUri,
        relative_path: relPath,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const artifactParsed = parseMcpJson(trainArtifactRes, `mcp stage0 train artifact ${relPath}`);
    const artifactUuid = String(artifactParsed.items?.[0]?.artifact_uuid ?? '');
    if (!artifactUuid) throw new Error(`missing artifact_uuid for ${relPath}`);
    artifactUris.push(`kairos://layer/${artifactUuid}`);
  }
  return { adapterUri, artifactUris };
}

async function exportBundle(
  mcp: Awaited<ReturnType<typeof createMcpConnection>>,
  adapterUri: string,
  format: 'skill_tree' | 'skill_zip'
): Promise<{ slug: string; sumsBody: string; sumsRows: Map<string, string>; files: Map<string, Buffer> }> {
  if (format === 'skill_tree') {
    const exported = await mcp.client.callTool({
      name: 'export',
      arguments: { uri: adapterUri, format: 'skill_tree' }
    });
    const parsed = parseMcpJson(exported, 'mcp export skill_tree');
    const tree = parsed.content as string;
    const treeObj = JSON.parse(tree) as {
      skills: Array<{ slug: string; files: Array<{ path: string; content: string }> }>;
    };
    const slug = treeObj.skills[0]!.slug;
    const files = new Map<string, Buffer>();
    for (const f of treeObj.skills[0]!.files) files.set(f.path, Buffer.from(f.content, 'utf8'));
    const sums = extractSumsFromSkillTree(tree, slug);
    return { slug, sumsBody: sums.body, sumsRows: sums.rows, files };
  }

  const exported = await mcp.client.callTool({
    name: 'export',
    arguments: { uri: adapterUri, format: 'skill_zip', delivery: 'inline_base64' }
  });
  const parsed = parseMcpJson(exported, 'mcp export skill_zip');
  const manifest = JSON.parse(parsed.skill_bundle_manifest as string) as { skills: Array<{ slug: string }> };
  const slug = manifest.skills[0]!.slug;
  const zip = Buffer.from(String(parsed.content), 'base64');
  const sums = extractSumsFromZip(zip, slug);
  return { slug, sumsBody: sums.body, sumsRows: sums.rows, files: sums.files };
}

async function retrainFromBundle(
  mcp: Awaited<ReturnType<typeof createMcpConnection>>,
  format: 'skill_tree' | 'skill_zip',
  slug: string,
  payload: string | Buffer
): Promise<{ adapterUri: string; artifactUris: string[] }> {
  const input = format === 'skill_tree' ? skillTreeToTrainInput(String(payload), slug) : skillZipToTrainInput(payload as Buffer, slug);
  const trainAdapter = await mcp.client.callTool({
    name: 'train',
    arguments: { content: input.skillMd, llm_model_id: 'test-model', force_update: true,
      review_evidence: MOCK_REVIEW_EVIDENCE
    }
  });
  const adapterParsed = parseMcpJson(trainAdapter, 'mcp roundtrip train adapter');
  const adapterUri = adapterParsed.items?.[0]?.adapter_uri as string;
  const artifactUris: string[] = [];
  for (const artifact of input.artifacts) {
    const trainArtifactRes = await mcp.client.callTool({
      name: 'train',
      arguments: {
        content: artifact.content,
        llm_model_id: 'test-model',
        mime: artifact.mime,
        artifact_name: artifact.artifact_name,
        adapter_uri: adapterUri,
        relative_path: artifact.relative_path,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    });
    const artifactParsed = parseMcpJson(trainArtifactRes, `mcp roundtrip train artifact ${artifact.relative_path}`);
    const artifactUuid = String(artifactParsed.items?.[0]?.artifact_uuid ?? '');
    if (!artifactUuid) throw new Error(`missing artifact_uuid for ${artifact.relative_path}`);
    artifactUris.push(`kairos://layer/${artifactUuid}`);
  }
  return { adapterUri, artifactUris };
}

describe('mime fixture export parity via MCP transport', () => {
  let mcp: Awaited<ReturnType<typeof createMcpConnection>>;

  beforeAll(async () => {
    ensureMimeFixtureExportDumpRootCleanBeforeMimeTests();
    mcp = await createMcpConnection();
  }, 60000);

  afterAll(async () => {
    if (mcp) await mcp.close();
  });

  test.each(['skill_tree', 'skill_zip'] as const)(
    'Stage 0/1/2 SHA contract for %s',
    async (format) => {
      const contract = loadMimeArtifactContract();
      const fixtureRows = loadFixtureSums();
      const stage0 = await trainStage0Fixture(mcp);
      const b0 = await exportBundle(mcp, stage0.adapterUri, format);
      dumpMimeFixtureExport({
        transport: 'mcp',
        format,
        stage: 0,
        slug: b0.slug,
        files: b0.files,
        sumsBody: b0.sumsBody
      });
      assertArtifactSumsMatchFixture(b0.sumsRows, fixtureRows, contract.artifactPaths);
      assertBundleSelfVerifies(b0.files, b0.sumsBody);

      const sourceRes = await mcp.client.callTool({
        name: 'export',
        arguments: { uri: stage0.adapterUri, format: 'source' }
      });
      const source = parseMcpJson(sourceRes, 'mcp export source');
      const sourcePayload = JSON.parse(String(source.content)) as { artifacts?: Array<{ slug: string }> };
      const sourceSlugs = (sourcePayload.artifacts ?? []).map((a) => a.slug).sort();
      expect(sourceSlugs).toEqual([...contract.expectedArtifactSlugs].sort());

      const stage1Input =
        format === 'skill_tree'
          ? parseMcpJson(
              await mcp.client.callTool({ name: 'export', arguments: { uri: stage0.adapterUri, format: 'skill_tree' } }),
              'mcp stage1 input tree'
            ).content
          : Buffer.from(
              String(
                parseMcpJson(
                  await mcp.client.callTool({
                    name: 'export',
                    arguments: { uri: stage0.adapterUri, format: 'skill_zip', delivery: 'inline_base64' }
                  }),
                  'mcp stage1 input zip'
                ).content
              ),
              'base64'
            );

      await cleanupViaMcp(mcp, stage0.adapterUri, stage0.artifactUris);
      const stage1 = await retrainFromBundle(mcp, format, b0.slug, stage1Input);
      const b1 = await exportBundle(mcp, stage1.adapterUri, format);
      dumpMimeFixtureExport({
        transport: 'mcp',
        format,
        stage: 1,
        slug: b1.slug,
        files: b1.files,
        sumsBody: b1.sumsBody
      });
      assertSumsBodyByteIdentical(b0.sumsBody, b1.sumsBody);
      assertBundleSelfVerifies(b1.files, b1.sumsBody);

      const stage2Input =
        format === 'skill_tree'
          ? parseMcpJson(
              await mcp.client.callTool({ name: 'export', arguments: { uri: stage1.adapterUri, format: 'skill_tree' } }),
              'mcp stage2 input tree'
            ).content
          : Buffer.from(
              String(
                parseMcpJson(
                  await mcp.client.callTool({
                    name: 'export',
                    arguments: { uri: stage1.adapterUri, format: 'skill_zip', delivery: 'inline_base64' }
                  }),
                  'mcp stage2 input zip'
                ).content
              ),
              'base64'
            );

      await cleanupViaMcp(mcp, stage1.adapterUri, stage1.artifactUris);
      const stage2 = await retrainFromBundle(mcp, format, b1.slug, stage2Input);
      const b2 = await exportBundle(mcp, stage2.adapterUri, format);
      dumpMimeFixtureExport({
        transport: 'mcp',
        format,
        stage: 2,
        slug: b2.slug,
        files: b2.files,
        sumsBody: b2.sumsBody
      });
      assertSumsBodyByteIdentical(b1.sumsBody, b2.sumsBody);
      assertBundleSelfVerifies(b2.files, b2.sumsBody);

      await cleanupViaMcp(mcp, stage2.adapterUri, stage2.artifactUris);
    },
    120000
  );
});
