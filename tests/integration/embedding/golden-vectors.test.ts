/**
 * Golden-vector equivalence gate (issue #252, ADR 0041 D4) — SINGLE lane only.
 *
 * Permanent regression guard for the fastembed -> @huggingface/transformers swap:
 * real inference runs in a CHILD process (ADR 0004: no ONNX inside a Jest
 * vm-realm; no jest imports/mocks under tests/integration). The child embeds the
 * fixed corpus and this suite asserts the measured tolerances against the
 * cross-platform-verified FastEmbed baseline fixture:
 *   dims 384; |norm-1| <= 1e-5; per-vector cosine >= 0.99; mean >= 0.999;
 *   query cosine >= 0.999; top-1 AND top-3 agreement; truncation 512 tokens.
 * A second child pass with TRANSFORMERS_OFFLINE=1 proves cache-only reuse.
 *
 * Also asserts the store-metadata identity after a real CLI boot and that a
 * restart reuses the model cache without re-download (ADR 0041 D5/D7).
 * Skipped on the HTTP/CLUSTER lane; requires dist (the SINGLE lane installs it).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { applyLocalStdioEnv } from '../../utils/stdio-simple-env.js';
import { isHttpTransport } from '../../utils/auth-headers.js';
import { MOCK_REVIEW_EVIDENCE } from '../../utils/mock-review-evidence.js';

const execFilePromise = promisify(execFile);
const ROOT = process.cwd();
const CHILD = join(ROOT, 'tests/integration/embedding/golden-child.mjs');
const FIXTURE_PATH = join(ROOT, 'tests/fixtures/embedding-golden-vectors.json');
const CORPUS_PATH = join(ROOT, 'tests/fixtures/embedding-golden-corpus.json');
const CLI_PATH = join(ROOT, 'dist/cli/index.js');
const TRAIN_FILE = join(ROOT, 'tests/test-data/cli-minimal-test.md');

interface GoldenResult {
  provider: string;
  modelId: string;
  texts: number[][];
  queries: Record<string, number[]>;
  truncationTokenCount: number;
  cacheBytes: number;
}
interface Fixture {
  provenance: { corpusSha256: string };
  dims: number;
  tolerances: { normAbs: number; perVectorCosine: number; meanCosine: number; queryCosine: number; truncationTokens: number };
  vectors: { texts: number[][]; queries: Record<string, number[]> };
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
const _d = isHttpTransport() ? describe.skip : describe;

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
function cosine(a: number[], b: number[]): number {
  return dot(a, b) / (Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b)));
}
function rankIndices(query: number[], texts: number[][]): number[] {
  return texts
    .map((vector, index) => ({ index, score: cosine(query, vector) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.index);
}
function dirBytes(dir: string): number {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? dirBytes(full) : statSync(full).size;
  }
  return total;
}
function cacheDir(): string {
  if (process.env.TRANSFORMERS_CACHE_DIR) return process.env.TRANSFORMERS_CACHE_DIR;
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'embedding-models');
}
function childEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) env[key] = value ?? '';
  Object.assign(env, {
    EMBEDDING_PROVIDER: 'transformers',
    OPENAI_API_KEY: '',
    TEI_BASE_URL: '',
    TRANSFORMERS_OFFLINE: '',
    LOG_LEVEL: 'error',
    SQUADRULES_LOG_STDERR: '1',
  }, overrides);
  return env;
}
async function runGoldenChild(overrides: Record<string, string> = {}): Promise<GoldenResult> {
  const { stdout } = await execFilePromise(process.execPath, [CHILD], {
    cwd: ROOT, env: childEnv(overrides), timeout: 300000, maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout) as GoldenResult;
}
async function runCli(args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  // Markdown adapter trains require critic-loop proof (cli-train reviewEvidenceFromEnv);
  // inject the sanctioned mock blob, same as tests/integration/cli-commands-shared.ts.
  const env = childEnv({
    SQUADRULES_NO_BROWSER: '1',
    SQUADRULES_REVIEW_EVIDENCE: JSON.stringify(MOCK_REVIEW_EVIDENCE),
  });
  applyLocalStdioEnv(env as Record<string, string | undefined>);
  return await execFilePromise(process.execPath, [CLI_PATH, ...args], {
    cwd: ROOT, env, timeout, maxBuffer: 16 * 1024 * 1024,
  });
}

let online: GoldenResult;

_d('golden-vector equivalence gate (real inference, child process)', () => {
  beforeAll(async () => {
    if (!existsSync(join(ROOT, 'dist/services/embedding/transformers-provider.js'))) {
      throw new Error('dist not built: run `npm run build` first (the SINGLE lane installs the package dist).');
    }
    online = await runGoldenChild();
  }, 360000);

  test('fixture corpus is byte-identical to the measured corpus (provenance sha)', () => {
    const sha = createHash('sha256').update(readFileSync(CORPUS_PATH)).digest('hex');
    expect(sha).toBe(fixture.provenance.corpusSha256);
  });

  test('identity reports repo@rev:dtype and dims are 384 everywhere', () => {
    expect(online.provider).toBe('transformers');
    expect(online.modelId).toMatch(/@[\da-f]{7}:fp16$/);
    expect(online.texts.length).toBe(fixture.vectors.texts.length);
    for (const vector of [...online.texts, ...Object.values(online.queries)]) {
      expect(vector.length).toBe(fixture.dims);
    }
  });

  test('all vectors are unit-norm within 1e-5', () => {
    for (const vector of [...online.texts, ...Object.values(online.queries)]) {
      expect(Math.abs(Math.sqrt(dot(vector, vector)) - 1)).toBeLessThanOrEqual(fixture.tolerances.normAbs);
    }
  });

  test('per-vector cosine >= 0.99 and mean >= 0.999 vs the fastembed baseline', () => {
    const cosines = online.texts.map((vector, i) => cosine(vector, fixture.vectors.texts[i]));
    for (const value of cosines) {
      expect(value).toBeGreaterThanOrEqual(fixture.tolerances.perVectorCosine);
    }
    const mean = cosines.reduce((sum, value) => sum + value, 0) / cosines.length;
    expect(mean).toBeGreaterThanOrEqual(fixture.tolerances.meanCosine);
  });

  test('query cosine >= 0.999 with top-1 and top-3 ranking agreement', () => {
    for (const query of corpus.queries as Array<{ id: string; text: string }>) {
      const actual = online.queries[query.id];
      const expected = fixture.vectors.queries[query.id];
      expect(cosine(actual, expected)).toBeGreaterThanOrEqual(fixture.tolerances.queryCosine);
      const actualRank = rankIndices(actual, online.texts);
      const expectedRank = rankIndices(expected, fixture.vectors.texts);
      expect(actualRank[0]).toBe(expectedRank[0]);
      expect([...actualRank.slice(0, 3)].sort()).toEqual([...expectedRank.slice(0, 3)].sort());
    }
  });

  test('the 600-word probe truncates to exactly 512 tokens', () => {
    expect(online.truncationTokenCount).toBe(fixture.tolerances.truncationTokens);
  });

  test('offline second pass reuses the cache: identical vectors, no byte growth', async () => {
    const offline = await runGoldenChild({ TRANSFORMERS_OFFLINE: '1' });
    expect(offline.texts).toEqual(online.texts);
    expect(offline.queries).toEqual(online.queries);
    expect(offline.cacheBytes).toBe(online.cacheBytes);
    expect(offline.cacheBytes).toBeGreaterThan(0);
  }, 360000);
});

_d('store metadata identity + restart cache reuse (embedded store boot)', () => {
  let trainedUri: string | null = null;
  let firstMetadata: { provider: string; model: string; dimension: number; created_at: string };
  const metadataPath = join(process.env.SQUADRULES_HOME || join(homedir(), '.squadrules'), 'lancedb', 'store-metadata.json');

  beforeAll(async () => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(`CLI not built: missing ${CLI_PATH}. Run \`npm run build\` first.`);
    }
    // train guarantees a store write, which stamps store-metadata.json with the
    // successful provider identity (reads alone never create the table).
    const { stdout } = await runCli(['train', '--force', TRAIN_FILE, '--format', 'json'], 240000);
    trainedUri = JSON.parse(stdout).items?.[0]?.uri ?? null;
    expect(trainedUri).toBeTruthy();
    firstMetadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  }, 300000);

  test('store metadata records the transformers identity at 384 dims', () => {
    expect(firstMetadata.provider).toBe('transformers');
    expect(firstMetadata.model).toBe(online.modelId);
    expect(firstMetadata.model).toMatch(/@[\da-f]{7}:fp16$/);
    expect(firstMetadata.dimension).toBe(384);
  });

  test('restart keeps the creating-provider stamp and reuses the model cache', async () => {
    const bytesBefore = dirBytes(cacheDir());
    expect(bytesBefore).toBeGreaterThan(0);
    await runCli(['spaces', '--format', 'json'], 120000);
    expect(dirBytes(cacheDir())).toBe(bytesBefore);
    const after = JSON.parse(readFileSync(metadataPath, 'utf8'));
    expect(after.created_at).toBe(firstMetadata.created_at);
    expect(after.provider).toBe(firstMetadata.provider);
    expect(after.model).toBe(firstMetadata.model);
    expect(after.dimension).toBe(384);
  }, 180000);

  afterAll(async () => {
    if (trainedUri) {
      await runCli(['delete', trainedUri, '--format', 'json'], 120000).catch(() => {});
    }
  }, 180000);
});