/**
 * CLI export selection tests — exercises the --adapters / --all-adapters parity with HTTP/MCP.
 * Trains adapters via /api/train/raw, then runs the compiled CLI to export them and asserts
 * the same selection union behaves the way the schema does (and rejects illegal combinations).
 */

import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  execAsync,
  BASE_URL,
  CLI_PATH,
  setupServerCheck,
  setupCliConfigWithLogin,
  requireMcpServerAndCliLogin
} from './cli-commands-shared.js';
import { getAuthHeaders, isHttpTransport } from '../utils/auth-headers.js';
import { MOCK_REVIEW_EVIDENCE } from '../utils/mock-review-evidence.js';

const _d = isHttpTransport() ? describe : describe.skip;

interface TrainItem {
  uri?: string;
  adapter_uri?: string;
}

interface TrainResponse {
  status: string;
  items: TrainItem[];
}

async function trainAdapterMarkdown(markdown: string): Promise<{ adapterUri: string; layerUri: string }> {
  const res = await fetch(`${BASE_URL}/api/train/raw?force=true&review_evidence=${encodeURIComponent(JSON.stringify(MOCK_REVIEW_EVIDENCE))}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/markdown',
      'X-LLM-Model-ID': 'test-model',
      ...getAuthHeaders()
    },
    body: markdown
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`train failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as TrainResponse;
  const item = json.items?.[0];
  if (!item?.uri || !item.adapter_uri) {
    throw new Error(`train response missing uri or adapter_uri: ${JSON.stringify(json)}`);
  }
  return { adapterUri: item.adapter_uri, layerUri: item.uri };
}

function buildAdapterMarkdown(slug: string, title: string): string {
  return `---
slug: ${slug}
---

# ${title}

## Activation Patterns
Run when user asks for ${slug}.

## Step 1
First step body.

\`\`\`json
{"contract":{"type":"comment","description":"step 1 of ${slug}"}}
\`\`\`

## Reward Signal
Done.`;
}

_d('CLI export selection union (--adapters / --all-adapters)', () => {
  let serverAvailable = false;
  let cliLoggedIn = false;

  beforeAll(async () => {
    serverAvailable = await setupServerCheck();
    cliLoggedIn = await setupCliConfigWithLogin();
  }, 60000);

  test('rejects no selection at all', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    await expect(
      execAsync(`node ${CLI_PATH} export --url ${BASE_URL} --as markdown`)
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/selection/i)
    });
  }, 15000);

  test('rejects positional uri combined with --adapters', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const fakeUri = 'squadrules://adapter/fake-adapter-aa';
    await expect(
      execAsync(
        `node ${CLI_PATH} export --url ${BASE_URL} --as skill_zip ${fakeUri} --adapters ${fakeUri}`
      )
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/exactly one selection/i)
    });
  }, 15000);

  test('rejects --all-adapters without --space', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    await expect(
      execAsync(
        `node ${CLI_PATH} export --url ${BASE_URL} --as skill_zip --all-adapters`
      )
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/--space/i)
    });
  }, 15000);

  test('rejects --space without --all-adapters', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const fakeUri = 'squadrules://adapter/fake-adapter-bb';
    await expect(
      execAsync(
        `node ${CLI_PATH} export --url ${BASE_URL} --as markdown ${fakeUri} --space personal`
      )
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/--space is only valid with --all-adapters/)
    });
  }, 15000);

  test('--adapters with multiple repeated flags exports a multi-skill skill_zip bundle', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);

    const ts = Date.now().toString();
    const slugA = `cli-multi-a-${ts}`;
    const slugB = `cli-multi-b-${ts}`;
    const a = await trainAdapterMarkdown(buildAdapterMarkdown(slugA, `CLI Multi A ${ts}`));
    const b = await trainAdapterMarkdown(buildAdapterMarkdown(slugB, `CLI Multi B ${ts}`));

    const tmpDir = mkdtempSync(join(tmpdir(), 'cli-export-'));
    const zipOut = join(tmpDir, 'bundle.zip');

    // B2: export writes the bundle to --zip-out and, in JSON mode, prints a compact manifest of
    // what was written — never the bundle bytes. `--as` is the content format; the global
    // `--format json` selects the machine manifest. The manifest reports export_adapter_count
    // (the bundle-membership signal the CLI surfaces); slug presence is read from the ZIP's
    // plaintext central-directory entries below.
    const { stdout, stderr } = await execAsync(
      `node ${CLI_PATH} export --url ${BASE_URL} --as skill_zip --format json --adapters ${a.adapterUri} --adapters ${b.adapterUri} --zip-out ${zipOut}`
    );
    expect(stderr).toBe('');

    const buf = readFileSync(zipOut);
    expect(buf.length).toBeGreaterThan(64);
    expect(buf.subarray(0, 2).toString('binary')).toBe('PK');

    const manifest = JSON.parse(stdout);
    expect(manifest.format).toBe('skill_zip');
    expect(manifest.export_adapter_count).toBe(2);
    expect(manifest.written).toEqual([
      expect.objectContaining({ path: zipOut, format: 'skill_zip' })
    ]);
    // ZIP entry names are stored uncompressed, so both slugs appear in the raw bytes.
    const zipListing = buf.toString('binary');
    expect(zipListing).toContain(slugA);
    expect(zipListing).toContain(slugB);
  }, 60000);

  test('positional <uri> still works for single-uri markdown export', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const ts = Date.now().toString();
    const slug = `cli-single-${ts}`;
    const a = await trainAdapterMarkdown(buildAdapterMarkdown(slug, `CLI Single ${ts}`));

    // B2: markdown content is written to --out as <name>.md; stdout (auto→json when piped)
    // carries the compact manifest, not the content bytes.
    const outDir = mkdtempSync(join(tmpdir(), 'cli-export-md-'));
    const { stdout, stderr } = await execAsync(
      `node ${CLI_PATH} export --url ${BASE_URL} --as markdown --out ${outDir} ${a.adapterUri}`
    );
    expect(stderr).toBe('');
    const manifest = JSON.parse(stdout);
    expect(manifest.format).toBe('markdown');
    const writtenPath = manifest.written[0].path as string;
    expect(writtenPath.startsWith(outDir)).toBe(true);
    expect(readFileSync(writtenPath, 'utf8')).toContain('First step body');
  }, 30000);

  test('--adapters with markdown format is rejected by the schema (selection / format mismatch)', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const ts = Date.now().toString();
    const slug = `cli-md-rej-${ts}`;
    const a = await trainAdapterMarkdown(buildAdapterMarkdown(slug, `CLI MD Rej ${ts}`));

    await expect(
      execAsync(
        `node ${CLI_PATH} export --url ${BASE_URL} --as markdown --adapters ${a.adapterUri}`
      )
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/markdown.*single.*uri|requires a single `uri`/i)
    });
  }, 30000);

  test('writes a CLI input file pinned by selection mode (regression for --zip-out)', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const ts = Date.now().toString();
    const slug = `cli-zipout-${ts}`;
    const a = await trainAdapterMarkdown(buildAdapterMarkdown(slug, `CLI ZipOut ${ts}`));

    const tmpDir = mkdtempSync(join(tmpdir(), 'cli-export-zipout-'));
    const zipOut = join(tmpDir, 'single.zip');

    const { stdout, stderr } = await execAsync(
      `node ${CLI_PATH} export --url ${BASE_URL} --as skill_zip --format json --zip-out ${zipOut} ${a.adapterUri}`
    );
    expect(stderr).toBe('');
    // B2: --zip-out pins the bundle path; the compact manifest reports exactly what was written
    // (the ZIP bytes never go to stdout).
    const manifest = JSON.parse(stdout);
    expect(manifest.written).toEqual([
      expect.objectContaining({ path: zipOut, format: 'skill_zip' })
    ]);
    const buf = readFileSync(zipOut);
    expect(buf.length).toBeGreaterThan(64);
    expect(buf.subarray(0, 2).toString('binary')).toBe('PK');
  }, 30000);

  // Regression for the artifact materialize command (ADR 0026, linked_artifacts[].materialize):
  // stdio transport has no HTTP listener, so it calls `export --as source --to <file>`. The
  // payload must be the artifact bytes at the exact path — never the printed summary path that a
  // stdout redirect would capture.
  test('--to writes the payload to the exact path (artifact materialize regression)', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const ts = Date.now().toString();
    const slug = `cli-to-${ts}`;
    const a = await trainAdapterMarkdown(buildAdapterMarkdown(slug, `CLI To ${ts}`));

    const tmpDir = mkdtempSync(join(tmpdir(), 'cli-export-to-'));
    const target = join(tmpDir, 'nested', 'adapter.md');

    const { stdout, stderr } = await execAsync(
      `node ${CLI_PATH} export --url ${BASE_URL} --as markdown --format json --to ${target} ${a.adapterUri}`
    );
    expect(stderr).toBe('');
    const manifest = JSON.parse(stdout);
    expect(manifest.written).toEqual([
      expect.objectContaining({ path: target, format: 'markdown' })
    ]);
    const written = readFileSync(target, 'utf8');
    expect(written).toContain(`# CLI To ${ts}`);
    expect(written).toContain('```json');
  }, 30000);
});
