#!/usr/bin/env node
/**
 * TEMPORARY evidence infrastructure for issue #252 (fastembed ->
 * @huggingface/transformers). Removed before the final PR merges.
 *
 * FastEmbed baseline harness: measures the SHIPPED fastembed@3.0.0 provider
 * path on real hardware (CI linux glibc amd64/arm64, macOS). Platform-neutral;
 * on hosts where the native chain cannot load, the report records
 * status:"host-blocked" with the exact error and NO vectors.
 *
 * Usage:
 *   node harness-fastembed.mjs <output-report.json> [corpus.json]
 * Defaults: corpus = ./corpus.json relative to this script.
 * Exit codes: 0 = ok, 2 = host-blocked, 1 = error (usage/harness failure).
 *
 * Provider fidelity (src/services/embedding/fastembed-provider.ts @ 2f517571):
 * lazy `await import('fastembed')`, then
 * `FlagEmbedding.init({ model: 'fast-bge-small-en-v1.5', cacheDir })` with NO
 * other options; embeddings via `for await (const batch of model.embed(arr))`
 * (default batchSize 256, no query/passage prefixes). Env resolution mirrors
 * src/config/embedding-fastembed.ts + getEmbeddingModelsCacheDir().
 *
 * Install context (run-variant.sh): scratch dir with fastembed@3.0.0 and
 * overrides {"@anush008/tokenizers":"^0.6.0","global-agent":"^4.1.3"} — the two
 * fastembed-chain overrides from the shipped root package.json.
 *
 * Report schema: issue-252-equivalence/1 (shared with harness-transformers.mjs
 * and consumed by compare.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2];
if (!outPath) {
  console.error('usage: node harness-fastembed.mjs <output-report.json> [corpus.json]');
  process.exit(1);
}
const corpusPath = process.argv[3] || path.join(here, 'corpus.json');
const VARIANT = process.env.EQUIV_VARIANT || 'fastembed-baseline';

// --- provider-identical env/config resolution -------------------------------
const FASTEMBED_MODEL = process.env.FASTEMBED_MODEL || 'fast-bge-small-en-v1.5';
function getEmbeddingModelsCacheDir() {
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
  return path.join(base, 'embedding-models');
}
const FASTEMBED_CACHE_DIR = process.env.FASTEMBED_CACHE_DIR || getEmbeddingModelsCacheDir();

// --- helpers -----------------------------------------------------------------
function readPkgVersion(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch (err) {
    return `unresolved: ${err.code || err.message}`;
  }
}
function dirBytes(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirBytes(p);
    else if (e.isFile()) { try { total += fs.statSync(p).size; } catch { /* raced */ } }
  }
  return total;
}
function l2norm(v) { return Math.sqrt(v.reduce((a, x) => a + x * x, 0)); }
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / Math.max(l2norm(a) * l2norm(b), 1e-12);
}
function errInfo(err) {
  return {
    name: err?.name ?? typeof err,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    code: err?.code,
  };
}
function libc() {
  const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
  if (glibc) return `glibc ${glibc}`;
  if (process.platform === 'android') return 'bionic';
  if (process.platform === 'linux' && fs.existsSync('/etc/alpine-release')) return 'musl';
  return 'non-glibc (musl/bionic/other)';
}

const report = {
  schema: 'issue-252-equivalence/1',
  variant: VARIANT,
  status: 'error',
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch, libc: libc() },
  config: {
    provider: 'fastembed',
    model: FASTEMBED_MODEL,
    cacheDir: FASTEMBED_CACHE_DIR,
    initOptions: 'model+cacheDir only (provider-identical)',
    hfRepo: 'Qdrant/bge-small-en-v1.5-onnx-Q',
    modelFile: 'model_optimized.onnx',
    pooling: 'cls',
    normalize: 'L2 epsilon 1e-12',
    padding: 'fixed 512 (fastembed setPadding maxLength)',
    prefixes: 'none (plain embed(), provider call shape)',
  },
  versions: {
    fastembed: readPkgVersion('fastembed'),
    '@anush008/tokenizers': readPkgVersion('@anush008/tokenizers'),
    'onnxruntime-node': readPkgVersion('onnxruntime-node'),
    'global-agent': readPkgVersion('global-agent'),
  },
  corpus: { path: corpusPath },
  cache: { dir: FASTEMBED_CACHE_DIR, bytes_downloaded: 0 },
  memory: {},
  timings: {},
};
function writeReport() {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`report written: ${outPath} (status=${report.status})`);
}

// --- corpus -------------------------------------------------------------------
let corpus;
try {
  corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
} catch (err) {
  report.status = 'error';
  report.error = { phase: 'corpus-load', ...errInfo(err) };
  writeReport();
  process.exit(1);
}
const texts = corpus.texts;
const queries = corpus.queries;
report.corpus.textCount = texts.length;
report.corpus.queryCount = queries.length;

// --- init (provider-identical) --------------------------------------------------
const cacheBytesBefore = dirBytes(FASTEMBED_CACHE_DIR);
const t0 = performance.now();
let model;
try {
  const fastembed = await import('fastembed'); // provider's lazy import
  model = await fastembed.FlagEmbedding.init({
    model: FASTEMBED_MODEL,
    cacheDir: FASTEMBED_CACHE_DIR,
  });
  report.timings.cold_ms = Math.round(performance.now() - t0);
} catch (err) {
  report.status = 'host-blocked';
  report.error = { phase: 'import-or-init', ...errInfo(err) };
  report.timings.cold_failed_after_ms = Math.round(performance.now() - t0);
  report.cache.bytes_downloaded = dirBytes(FASTEMBED_CACHE_DIR) - cacheBytesBefore;
  report.memory.rss_after_failure = process.memoryUsage().rss;
  writeReport();
  process.exit(2);
}
report.memory.rss_after_init = process.memoryUsage().rss;
report.cache.bytes_downloaded = dirBytes(FASTEMBED_CACHE_DIR) - cacheBytesBefore;

// Provider-identical embed helper: plain embed(), collect all batches.
async function embedAll(inputArray) {
  const out = [];
  for await (const batch of model.embed(inputArray)) out.push(...batch);
  return out;
}

try {
  // First batched call over all 12 texts (provider call shape).
  const tFirst = performance.now();
  const vectors = await embedAll(texts);
  report.timings.first_batch_ms = Math.round(performance.now() - tFirst);

  // Warm per-text timings (one embed call per text, sequential).
  const perTextMs = [];
  for (const text of texts) {
    const t = performance.now();
    await embedAll([text]);
    perTextMs.push(Math.round(performance.now() - t));
  }
  report.timings.per_text_ms = perTextMs;
  report.timings.warm_single_ms = Math.round(perTextMs.reduce((a, b) => a + b, 0) / perTextMs.length);

  // Warm batched timing (second full-batch call).
  const tBatch = performance.now();
  await embedAll(texts);
  report.timings.warm_batch_ms = Math.round(performance.now() - tBatch);

  // Queries via plain embed (provider does NOT use queryEmbed/prefixes).
  const queryVectors = {};
  for (const q of queries) queryVectors[q.id] = (await embedAll([q.text]))[0];

  report.vectors = { texts: vectors, queries: queryVectors };
  report.dims = { texts: vectors.map((v) => v.length), queries: queries.map((q) => queryVectors[q.id].length) };
  report.norms = { texts: vectors.map(l2norm), queries: queries.map((q) => l2norm(queryVectors[q.id])) };
  report.cosine_pairs = {
    '3,4': cosine(vectors[3], vectors[4]),
    '8,9': cosine(vectors[8], vectors[9]),
    '0,1': cosine(vectors[0], vectors[1]),
  };
  report.rankings = {};
  report.ranking_scores = {};
  for (const q of queries) {
    const scores = texts.map((_, ti) => cosine(queryVectors[q.id], vectors[ti]));
    report.ranking_scores[q.id] = scores;
    report.rankings[q.id] = texts.map((_, ti) => ti).sort((a, b) => scores[b] - scores[a]);
  }
  report.memory.rss_after_embed = process.memoryUsage().rss;

  // Tokenizer evidence (best-effort; internal property, guard it).
  try {
    const tok = model.tokenizer;
    const encEmpty = await tok.encode(texts[7]);
    const encLong = await tok.encode(texts[10]);
    const enc0 = await tok.encode(texts[0]);
    const enc6 = await tok.encode(texts[6]);
    const nonPad = (enc) => enc.getIds().filter((_, i) => enc.getAttentionMask()[i] === 1);
    report.tokenizer_notes = {
      empty_string_behavior: 'empty string tokenizes to [CLS][SEP] then fixed-512 padding; CLS hidden state L2-normalized (non-zero unit vector)',
      empty_string_token_ids: encEmpty.getIds().slice(0, 2),
      truncation_token_count: encLong.getAttentionMask().filter((x) => x === 1).length,
      truncation_padded_length: encLong.getIds().length,
      probe_token_ids: { 0: nonPad(enc0), 6: nonPad(enc6) },
      per_text_token_counts: null,
      note: 'fastembed pads every input to maxLength=min(512, model_max_length); truncation at the same limit. per_text_token_counts not measured here (encode called per probe only).',
    };
  } catch (err) {
    report.tokenizer_notes = { error: errInfo(err) };
  }
  report.status = 'ok';
  writeReport();
  process.exit(0);
} catch (err) {
  report.status = 'host-blocked';
  report.error = { phase: 'embed', ...errInfo(err) };
  report.memory.rss_after_failure = process.memoryUsage().rss;
  writeReport();
  process.exit(2);
}