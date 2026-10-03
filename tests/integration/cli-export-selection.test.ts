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
      execAsync(`node ${CLI_PATH} export --url ${BASE_URL} --format markdown`)
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/selection/i)
    });
  }, 15000);

  test('rejects positional uri combined with --adapters', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const fakeUri = 'squadrules://adapter/fake-adapter-aa';
    await expect(
      execAsync(
        `node ${CLI_PATH} export --url ${BASE_URL} --format skill_zip ${fakeUri} --adapters ${fakeUri}`
      )
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/exactly one selection/i)
    });
  }, 15000);

  test('rejects --all-adapters without --space-name', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    await expect(
      execAsync(
        `node ${CLI_PATH} export --url ${BASE_URL} --format skill_zip --all-adapters`
      )
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/space-name/i)
    });
  }, 15000);

  test('rejects --space-name without --all-adapters', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const fakeUri = 'squadrules://adapter/fake-adapter-bb';
    await expect(
      execAsync(
        `node ${CLI_PATH} export --url ${BASE_URL} --format markdown ${fakeUri} --space-name personal`
      )
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/--space-name is only valid with --all-adapters/)
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

    const { stderr } = await execAsync(
      `node ${CLI_PATH} export --url ${BASE_URL} --format skill_zip --adapters ${a.adapterUri} --adapters ${b.adapterUri} --zip-out ${zipOut}`
    );
    expect(stderr).toBe('');

    const buf = readFileSync(zipOut);
    expect(buf.length).toBeGreaterThan(64);
    expect(buf.subarray(0, 2).toString('binary')).toBe('PK');

    // The CLI text path writes only the ZIP bytes — to verify slug presence we re-run with --output json
    // which prints the structured response including skill_bundle_manifest.
    const { stdout: jsonStdout } = await execAsync(
      `node ${CLI_PATH} export --url ${BASE_URL} --format skill_zip --output json --adapters ${a.adapterUri} --adapters ${b.adapterUri}`
    );
    const response = JSON.parse(jsonStdout);
    expect(response.format).toBe('skill_zip');
    expect(response.export_adapter_count).toBe(2);
    const manifest = JSON.parse(response.skill_bundle_manifest);
    const slugs = manifest.skills.map((s: { slug: string }) => s.slug);
    expect(slugs).toEqual(expect.arrayContaining([slugA, slugB]));
  }, 60000);

  test('positional <uri> still works for single-uri markdown export', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const ts = Date.now().toString();
    const slug = `cli-single-${ts}`;
    const a = await trainAdapterMarkdown(buildAdapterMarkdown(slug, `CLI Single ${ts}`));

    const { stdout, stderr } = await execAsync(
      `node ${CLI_PATH} export --url ${BASE_URL} --format markdown ${a.adapterUri}`
    );
    expect(stderr).toBe('');
    expect(stdout).toContain('First step body');
  }, 30000);

  test('--adapters with markdown format is rejected by the schema (selection / format mismatch)', async () => {
    requireMcpServerAndCliLogin(serverAvailable, cliLoggedIn);
    const ts = Date.now().toString();
    const slug = `cli-md-rej-${ts}`;
    const a = await trainAdapterMarkdown(buildAdapterMarkdown(slug, `CLI MD Rej ${ts}`));

    await expect(
      execAsync(
        `node ${CLI_PATH} export --url ${BASE_URL} --format markdown --adapters ${a.adapterUri}`
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
      `node ${CLI_PATH} export --url ${BASE_URL} --format skill_zip --zip-out ${zipOut} ${a.adapterUri}`
    );
    expect(stderr).toBe('');
    // Text path with --zip-out should be silent on stdout (binary handled via file).
    expect(stdout.trim()).toBe('');
    const buf = readFileSync(zipOut);
    expect(buf.length).toBeGreaterThan(64);
    expect(buf.subarray(0, 2).toString('binary')).toBe('PK');
  }, 30000);
});
