#!/usr/bin/env node
/**
 * TEMPORARY evidence infrastructure for issue #252 (fastembed ->
 * @huggingface/transformers). Removed before the final PR merges.
 *
 * Transformers.js harness: measures feature-extraction embeddings for
 * bge-small-en-v1.5 on real hardware (CI linux glibc amd64/arm64, macOS) via
 * the NATIVE onnxruntime-node path. No WASM shim here: on hosts where the
 * native chain cannot load (musl, bionic), the report records
 * status:"host-blocked" with the exact import error and NO vectors.
 *
 * Usage:
 *   node harness-transformers.mjs <output-report.json> [corpus.json]
 * Defaults: corpus = ./corpus.json relative to this script.
 * Exit codes: 0 = ok, 2 = host-blocked (native chain), 1 = error.
 *
 * Env parameters:
 *   TJ_PKG_VERSION     installed package version label (default 4.3.2; the
 *                      actual installed version is read from node_modules)
 *   TJ_MODEL_REPO      default Xenova/bge-small-en-v1.5
 *   TJ_DTYPE           fp16 | q8 | fp32 (default fp16)
 *   TJ_REVISION        default ea104dacec62c0de699686887e3f920caeb4f3e3 for
 *                      Xenova; 'main' for Qdrant (fastembed pins main)
 *   TJ_MODEL_FILE_NAME optional ONNX base name override (Qdrant-direct:
 *                      'model_optimized'; sets subfolder:'' because the
 *                      Qdrant repo keeps the ONNX file at the repo root)
 *   TJ_CACHE_DIR       default <script-dir>/model-cache
 *   EQUIV_VARIANT      variant label for the report
 *
 * Qdrant-direct loadability (facts from @huggingface/transformers@4.3.2 src,
 * inspected in .local/tj4-inspect): pipeline() forwards `model_file_name` and
 * `subfolder` (default 'onnx') to AutoModel.from_pretrained; bert resolves to
 * the default session config {model: model_file_name ?? 'model'}; the ONNX
 * path is `${subfolder}/${baseName}${dtypeSuffix}.onnx` (src/utils/
 * model-loader.js getCoreModelFile). With model_file_name:'model_optimized',
 * subfolder:'', dtype:'fp32' (suffix '') the requested file is exactly
 * `model_optimized.onnx` at the repo root — the Qdrant layout. If the direct
 * load still fails, this harness falls back to variant mode 'qdrant-local':
 * it downloads the 5 fastembed files via HF resolve URLs into the FileCache
 * layout (<cacheDir>/<repo>/<file> for revision 'main'; FileCache.match joins
 * cacheDir + proposedCacheKey, and proposedCacheKey omits the revision
 * segment for 'main' — src/utils/hub.js buildResourcePaths), then retries
 * with allowRemoteModels:false + local_files_only:true. If neither works the
 * report says status:'error' with the exact errors. Nothing is fabricated.
 *
 * Measurement config mirrors the fastembed provider contract: CLS pooling,
 * L2 normalize, truncation at model_max_length (512), NO query/passage
 * prefixes (the shipped provider calls plain embed()).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2];
if (!outPath) {
  console.error('usage: node harness-transformers.mjs <output-report.json> [corpus.json]');
  process.exit(1);
}
const corpusPath = process.argv[3] || path.join(here, 'corpus.json');

const PKG_VERSION_LABEL = process.env.TJ_PKG_VERSION || '4.3.2';
const MODEL = process.env.TJ_MODEL_REPO || 'Xenova/bge-small-en-v1.5';
const DTYPE = process.env.TJ_DTYPE || 'fp16';
const REVISION = process.env.TJ_REVISION
  || (MODEL.startsWith('Qdrant/') ? 'main' : 'ea104dacec62c0de699686887e3f920caeb4f3e3');
const MODEL_FILE_NAME = process.env.TJ_MODEL_FILE_NAME || null;
const CACHE_DIR = path.resolve(process.env.TJ_CACHE_DIR || path.join(here, 'model-cache'));
const HF_ENDPOINT = process.env.HF_ENDPOINT || 'https://huggingface.co';
const IS_QDRANT = MODEL.startsWith('Qdrant/');
const VARIANT = process.env.EQUIV_VARIANT
  || `tj${PKG_VERSION_LABEL.split('.')[0]}-${MODEL.split('/')[0].toLowerCase()}-${DTYPE}`;

// --- helpers -----------------------------------------------------------------
function pkgVersion(id) {
  try {
    let d = path.dirname(require.resolve(id));
    for (let i = 0; i < 4; i++) {
      const p = path.join(d, 'package.json');
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j.name === id) return j.version;
      }
      d = path.dirname(d);
    }
  } catch { /* not installed */ }
  return null;
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
// Single-text tokenizer encoding -> plain number[] (v3/v4 return a Tensor
// with BigInt64Array data, or plain arrays when padding:false is jagged).
function rowIds(enc) {
  const t = enc.input_ids;
  if (t && typeof t === 'object' && t.data) return Array.from(t.data, Number);
  if (Array.isArray(t)) return Array.from(t[0] ?? t, Number);
  return Array.from(t, Number);
}

const report = {
  schema: 'issue-252-equivalence/1',
  variant: VARIANT,
  status: 'error',
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch, libc: libc() },
  config: {
    provider: '@huggingface/transformers',
    pkgVersionLabel: PKG_VERSION_LABEL,
    model: MODEL,
    revision: REVISION,
    dtype: DTYPE,
    model_file_name: MODEL_FILE_NAME,
    subfolder: MODEL_FILE_NAME ? '' : 'onnx',
    cacheDir: CACHE_DIR,
    pooling: 'cls',
    normalize: true,
    truncation: 'pipeline default truncation:true -> model_max_length (512)',
    padding: 'pipeline default padding:true -> longest-in-batch (single calls: no padding)',
    prefixes: 'none (matches shipped fastembed embed() call shape)',
    load_mode: 'standard',
  },
  versions: {
    '@huggingface/transformers': pkgVersion('@huggingface/transformers'),
    'onnxruntime-node': pkgVersion('onnxruntime-node'),
    'onnxruntime-web': pkgVersion('onnxruntime-web'),
    'onnxruntime-common': pkgVersion('onnxruntime-common'),
    sharp: pkgVersion('sharp'),
    '@huggingface/tokenizers': pkgVersion('@huggingface/tokenizers'),
  },
  corpus: { path: corpusPath },
  cache: { dir: CACHE_DIR, bytes_downloaded: 0 },
  memory: {},
  timings: {},
  backend: { nativeProbe: {} },
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

// --- native probes + import (NO shim; failure is the evidence) ------------------
for (const id of ['onnxruntime-node', 'sharp']) {
  try { require(id); report.backend.nativeProbe[id] = { ok: true }; } catch (e) {
    report.backend.nativeProbe[id] = { ok: false, error: e?.message ?? String(e), code: e?.code ?? null };
  }
}
const cacheBytesBefore = dirBytes(CACHE_DIR);
let transformers;
const tImport = performance.now();
try {
  transformers = await import('@huggingface/transformers');
} catch (err) {
  report.status = 'host-blocked';
  report.error = { phase: 'import', ...errInfo(err) };
  report.timings.import_failed_after_ms = Math.round(performance.now() - tImport);
  report.cache.bytes_downloaded = dirBytes(CACHE_DIR) - cacheBytesBefore;
  report.memory.rss_after_failure = process.memoryUsage().rss;
  writeReport();
  process.exit(2);
}
const { env, pipeline } = transformers;
env.cacheDir = CACHE_DIR;
env.useFSCache = true;
env.allowRemoteModels = true;
env.allowLocalModels = true;

// --- model revision actually loaded (best-effort HF API resolution) -------------
report.model_revision = { requested: REVISION, resolved_sha: null, source: 'unresolved' };
try {
  const res = await fetch(`${HF_ENDPOINT}/api/models/${MODEL}/revision/${encodeURIComponent(REVISION)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) {
    const j = await res.json();
    report.model_revision.resolved_sha = j.sha ?? null;
    report.model_revision.source = 'hf-api';
  } else {
    report.model_revision.source = `hf-api-http-${res.status}`;
  }
} catch (err) {
  report.model_revision.source = `unresolved: ${err?.message ?? err}`;
}

// --- pipeline -------------------------------------------------------------------
const downloadedFiles = [];
const progress_callback = (p) => {
  const file = p?.file ?? p?.name;
  if (p?.status === 'done' && file) downloadedFiles.push(file);
};
function pipelineOptions(extra = {}) {
  return {
    revision: REVISION,
    dtype: DTYPE,
    device: 'cpu',
    progress_callback,
    ...(MODEL_FILE_NAME ? { model_file_name: MODEL_FILE_NAME, subfolder: '' } : {}),
    ...extra,
  };
}
async function downloadQdrantFilesLocally() {
  // FileCache layout for revision 'main': <cacheDir>/<repo>/<filename>
  // (buildResourcePaths: proposedCacheKey = requestURL when revision==='main').
  // The ONNX file sits at the repo root because subfolder:'' is passed.
  const files = ['model_optimized.onnx', 'tokenizer.json', 'tokenizer_config.json', 'config.json', 'special_tokens_map.json'];
  const dest = path.join(CACHE_DIR, MODEL);
  fs.mkdirSync(dest, { recursive: true });
  const fetched = [];
  for (const file of files) {
    const target = path.join(dest, file);
    if (fs.existsSync(target)) { fetched.push({ file, skipped: 'already-present' }); continue; }
    const url = `${HF_ENDPOINT}/${MODEL}/resolve/main/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${url} -> HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const part = `${target}.part`;
    fs.writeFileSync(part, buf);
    fs.renameSync(part, target);
    fetched.push({ file, bytes: buf.length });
  }
  return fetched;
}

const t0 = performance.now();
let extractor;
try {
  extractor = await pipeline('feature-extraction', MODEL, pipelineOptions());
  report.config.load_mode = MODEL_FILE_NAME ? 'qdrant-direct' : 'standard';
} catch (directErr) {
  if (!IS_QDRANT) {
    report.status = 'error';
    report.error = { phase: 'pipeline', ...errInfo(directErr) };
    report.cache.bytes_downloaded = dirBytes(CACHE_DIR) - cacheBytesBefore;
    report.memory.rss_after_failure = process.memoryUsage().rss;
    writeReport();
    process.exit(1);
  }
  // Qdrant-direct failed: fall back to qdrant-local (manual cache seeding).
  report.fallback = { reason: 'qdrant-direct-load-failed', direct_error: errInfo(directErr) };
  try {
    report.fallback.files = await downloadQdrantFilesLocally();
    env.allowRemoteModels = false;
    extractor = await pipeline('feature-extraction', MODEL, pipelineOptions({ local_files_only: true }));
    report.config.load_mode = 'qdrant-local';
    report.variant = `${VARIANT.replace(/-direct$/, '')}-local`;
  } catch (localErr) {
    report.status = 'error';
    report.error = { phase: 'pipeline-qdrant-local-fallback', ...errInfo(localErr) };
    report.cache.bytes_downloaded = dirBytes(CACHE_DIR) - cacheBytesBefore;
    report.memory.rss_after_failure = process.memoryUsage().rss;
    writeReport();
    process.exit(1);
  }
}
report.timings.cold_ms = Math.round(performance.now() - t0);
report.memory.rss_after_init = process.memoryUsage().rss;
report.cache.files_done = downloadedFiles;

// --- embeddings ------------------------------------------------------------------
try {
  const embedOne = async (text) => {
    const out = await extractor(text, { pooling: 'cls', normalize: true });
    return Array.from(out.data);
  };
  const vectors = [];
  const perTextMs = [];
  for (const text of texts) {
    const t = performance.now();
    vectors.push(await embedOne(text));
    perTextMs.push(Math.round(performance.now() - t));
  }
  report.timings.per_text_ms = perTextMs;
  report.timings.warm_single_ms = Math.round(perTextMs.reduce((a, b) => a + b, 0) / perTextMs.length);

  const queryVectors = {};
  for (const q of queries) queryVectors[q.id] = await embedOne(q.text);

  // Batched call (padding:true -> longest-in-batch = 512 here because of the
  // truncation probe text): timing + batch-composition sensitivity evidence.
  const tBatch = performance.now();
  const batched = await extractor(texts, { pooling: 'cls', normalize: true });
  report.timings.warm_batch_ms = Math.round(performance.now() - tBatch);
  const dim = vectors[0].length;
  let maxAbsDiff = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = 0; j < dim; j++) {
      const d = Math.abs(batched.data[i * dim + j] - vectors[i][j]);
      if (d > maxAbsDiff) maxAbsDiff = d;
    }
  }
  report.timings.batch_vs_single_max_abs_diff = maxAbsDiff;

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
  report.cache.bytes_downloaded = dirBytes(CACHE_DIR) - cacheBytesBefore;

  // --- tokenizer probes via the pipeline's tokenizer ---------------------------
  try {
    const tok = extractor.tokenizer;
    const encode = (text) => rowIds(tok(text, { padding: false, truncation: true }));
    const ids0 = encode(texts[0]);
    const ids6 = encode(texts[6]);
    const idsEmpty = encode(texts[7]);
    const idsLong = encode(texts[10]);
    report.tokenizer_notes = {
      class: tok.constructor?.name,
      model_max_length: tok.model_max_length ?? null,
      empty_string_behavior: `empty string tokenizes to [${idsEmpty.join(',')}] ([CLS][SEP]); CLS hidden state of the bare pair, L2-normalized (non-zero unit vector, norm=${l2norm(vectors[7])})`,
      empty_string_token_ids: idsEmpty,
      truncation_token_count: idsLong.length,
      truncation_first_ids: idsLong.slice(0, 8),
      truncation_last_ids: idsLong.slice(-4),
      probe_token_ids: { 0: ids0, 6: ids6 },
      per_text_token_counts: texts.map((t) => encode(t).length),
      note: 'truncation:true caps at model_max_length (512); HF truncation keeps the first 512 ids incl [CLS] and drops [SEP] on overlong input. Single-text calls with padding:false add no pad tokens.',
    };
  } catch (err) {
    report.tokenizer_notes = { error: errInfo(err) };
  }
  report.status = 'ok';
  writeReport();
  process.exit(0);
} catch (err) {
  report.status = 'error';
  report.error = { phase: 'embed', ...errInfo(err) };
  report.cache.bytes_downloaded = dirBytes(CACHE_DIR) - cacheBytesBefore;
  report.memory.rss_after_failure = process.memoryUsage().rss;
  writeReport();
  process.exit(1);
}