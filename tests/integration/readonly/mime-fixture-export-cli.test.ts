/**
 * CLI cannot ingest non-markdown artifact MIME inputs today.
 * This test pre-trains the fixture via API in beforeAll, then validates
 * Stage 0 export parity via CLI-only export/delete commands.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { isHttpTransport } from '../../utils/auth-headers.js';
import {
  BASE_URL,
  CLI_PATH,
  execAsync,
  requireMcpServerAndCliLogin,
  setupCliConfigWithLogin,
  setupServerCheck
} from '../cli-commands-shared.js';
import {
  trainAdapterMarkdown,
  trainArtifact,
  trainArtifactCleanupUri
} from '../skill-export-shared.js';
import {
  assertArtifactSumsMatchFixture,
  assertBundleSelfVerifies,
  extractSumsFromSkillTree,
  extractSumsFromZip,
  loadFixtureSums
} from '../../utils/skill-bundle-sha-assert.js';
import { cleanupViaCli } from '../../utils/artifact-fixture-cleanup.js';
import { loadMimeArtifactContract, readMimeFixtureUtf8 } from '../../utils/mime-artifact-fixture-contract.js';
import {
  dumpMimeFixtureExport,
  ensureMimeFixtureExportDumpRootCleanBeforeMimeTests
} from '../../utils/mime-fixture-export-dump.js';

async function pretrainFixtureViaApi(): Promise<{ adapterUri: string; artifactLayerUris: string[] }> {
  const contract = loadMimeArtifactContract();
  const adapter = await trainAdapterMarkdown(readMimeFixtureUtf8('SKILL.md'));
  const artifactLayerUris: string[] = [];
  for (const relPath of contract.artifactPaths) {
    const mime = contract.mimeByPath[relPath];
    if (!mime) throw new Error(`missing mime for ${relPath}`);
    const r = await trainArtifact(adapter.adapterUri, path.basename(relPath), mime, readMimeFixtureUtf8(relPath), {
      relative_path: relPath
    });
    artifactLayerUris.push(trainArtifactCleanupUri(r));
  }
  return { adapterUri: adapter.adapterUri, artifactLayerUris };
}

const _d = isHttpTransport() ? describe : describe.skip;

_d('mime fixture export parity via CLI transport', () => {
  let serverAvailable = false;
  let cliLoggedIn = false;
  let adapterUri = '';
  let artifactLayerUris: string[] = [];

  beforeAll(async () => {
    ensureMimeFixtureExportDumpRootCleanBeforeMimeTests();
    serverAvailable = await setupServerCheck();
    cliLoggedIn = await setupCliConfigWithLogin();
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const trained = await pretrainFixtureViaApi();
    adapterUri = trained.adapterUri;
    artifactLayerUris = trained.artifactLayerUris;
  }, 120000);

  afterAll(async () => {
    if (adapterUri) {
      await cleanupViaCli(adapterUri, artifactLayerUris);
    }
  });

  test('Stage 0 CLI skill_tree + skill_zip exports match fixture artifact rows', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const contract = loadMimeArtifactContract();
    const fixtureRows = loadFixtureSums();

    // B2: skill_tree content is written to --out as <name>.json; stdout (auto→json when piped)
    // carries the compact manifest. Read the tree JSON back from the written file.
    const treeOutDir = mkdtempSync(join(tmpdir(), 'mime-fixture-cli-tree-'));
    const { stdout: treeManifestStdout } = await execAsync(
      `node ${CLI_PATH} export --url ${BASE_URL} --as skill_tree --out ${treeOutDir} ${adapterUri}`
    );
    const treeManifest = JSON.parse(treeManifestStdout) as { written: Array<{ path: string }> };
    const treeStdout = readFileSync(treeManifest.written[0]!.path, 'utf8');
    const treeParsed = JSON.parse(treeStdout) as {
      skills: Array<{ slug: string; files: Array<{ path: string; content: string }> }>;
    };
    const slug = treeParsed.skills[0]!.slug;
    const tree = extractSumsFromSkillTree(treeStdout, slug);
    assertArtifactSumsMatchFixture(tree.rows, fixtureRows, contract.artifactPaths);
    const treeFiles = new Map<string, Buffer>();
    for (const f of treeParsed.skills[0]!.files) treeFiles.set(f.path, Buffer.from(f.content, 'utf8'));
    assertBundleSelfVerifies(treeFiles, tree.body);
    dumpMimeFixtureExport({
      transport: 'cli',
      format: 'skill_tree',
      stage: 0,
      slug,
      files: treeFiles,
      sumsBody: tree.body
    });

    const outDir = mkdtempSync(join(tmpdir(), 'mime-fixture-cli-'));
    const zipOut = join(outDir, 'bundle.zip');
    await execAsync(`node ${CLI_PATH} export --url ${BASE_URL} --as skill_zip --zip-out ${zipOut} ${adapterUri}`);
    const zipBytes = readFileSync(zipOut);
    const zip = extractSumsFromZip(zipBytes, slug);
    assertArtifactSumsMatchFixture(zip.rows, fixtureRows, contract.artifactPaths);
    assertBundleSelfVerifies(zip.files, zip.body);
    dumpMimeFixtureExport({
      transport: 'cli',
      format: 'skill_zip',
      stage: 0,
      slug,
      files: zip.files,
      sumsBody: zip.body
    });

    expect(zip.body).toBe(tree.body);
  }, 120000);
});
