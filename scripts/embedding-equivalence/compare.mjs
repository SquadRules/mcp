#!/usr/bin/env node
/**
 * TEMPORARY evidence infrastructure for issue #252 (fastembed ->
 * @huggingface/transformers). Removed before the final PR merges.
 *
 * Compares equivalence reports produced by harness-fastembed.mjs /
 * harness-transformers.mjs. Pure JS math, no dependencies. This is EVIDENCE,
 * not a gate: it always exits 0, and missing/blocked/error reports are listed
 * explicitly instead of aborting.
 *
 * Usage:
 *   node compare.mjs [--out DIR] report1.json report2.json ...
 * Writes DIR/comparison.json + DIR/comparison.md (DIR defaults to '.').
 *
 * Baseline = the ok report whose variant is 'fastembed-baseline'. Every other
 * ok report is compared against it: per-vector cosine (mean/min/max), dims
 * match, norm ranges, top-1/top-3 rank agreement per query, Kendall tau and
 * Spearman rho over the full 12-item rankings, and tokenizer probe equality.
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
let outDir = '.';
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') { outDir = argv[++i] || '.'; continue; }
  files.push(argv[i]);
}

function l2norm(v) { return Math.sqrt(v.reduce((a, x) => a + x * x, 0)); }
function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot / Math.max(l2norm(a) * l2norm(b), 1e-12);
}
function stats(xs) {
  if (!xs.length) return { mean: null, min: null, max: null };
  return {
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    min: Math.min(...xs),
    max: Math.max(...xs),
  };
}
function rankMap(ranking) {
  const m = new Map();
  ranking.forEach((item, pos) => m.set(item, pos));
  return m;
}
function kendallTau(rankA, rankB) {
  const items = [...rankA.keys()];
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const da = rankA.get(a) - rankA.get(b);
      const db = rankB.get(a) - rankB.get(b);
      if (da * db > 0) concordant++;
      else if (da * db < 0) discordant++;
    }
  }
  const total = (items.length * (items.length - 1)) / 2;
  return total ? (concordant - discordant) / total : null;
}
function spearman(rankA, rankB) {
  const items = [...rankA.keys()];
  const n = items.length;
  if (n < 2) return null;
  let sumD2 = 0;
  for (const item of items) {
    const d = rankA.get(item) - rankB.get(item);
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}
function arrEq(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

// --- load reports ---------------------------------------------------------------
const loaded = [];
const missing = [];
const nonOk = [];
for (const file of files) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
    missing.push({ file, reason: err.code || err.message });
    continue;
  }
  let rep;
  try { rep = JSON.parse(raw); } catch (err) {
    nonOk.push({ file, variant: null, status: 'unparseable', error: err.message });
    continue;
  }
  if (rep.status !== 'ok') {
    nonOk.push({ file, variant: rep.variant ?? null, status: rep.status ?? 'unknown', error: rep.error?.message ?? null });
    continue;
  }
  if (!rep.vectors?.texts || !rep.vectors?.queries) {
    nonOk.push({ file, variant: rep.variant ?? null, status: 'ok-without-vectors', error: 'report has no vectors' });
    continue;
  }
  loaded.push({ file, rep });
}

const baselineEntry = loaded.find((e) => e.rep.variant === 'fastembed-baseline') || null;
const pairs = [];
if (baselineEntry) {
  const base = baselineEntry.rep;
  for (const entry of loaded) {
    if (entry === baselineEntry) continue;
    const cand = entry.rep;
    const textCos = base.vectors.texts.map((v, i) => cosine(v, cand.vectors.texts[i] ?? []));
    const queryIds = Object.keys(base.vectors.queries);
    const queryCos = queryIds.map((id) => cosine(base.vectors.queries[id], cand.vectors.queries[id] ?? []));
    const dimsMatch = arrEq(base.dims?.texts, cand.dims?.texts)
      && arrEq(base.dims?.queries, cand.dims?.queries);
    const rankingComparison = {};
    for (const id of queryIds) {
      const ra = base.rankings?.[id];
      const rb = cand.rankings?.[id];
      if (!Array.isArray(ra) || !Array.isArray(rb)) { rankingComparison[id] = { error: 'ranking missing' }; continue; }
      const mapA = rankMap(ra);
      const mapB = rankMap(rb);
      const top3A = ra.slice(0, 3);
      const top3B = rb.slice(0, 3);
      rankingComparison[id] = {
        top1_match: ra[0] === rb[0],
        top3_set_match: arrEq([...top3A].sort((a, b) => a - b), [...top3B].sort((a, b) => a - b)),
        top3_order_match: arrEq(top3A, top3B),
        kendall_tau: kendallTau(mapA, mapB),
        spearman_rho: spearman(mapA, mapB),
        baseline_ranking: ra,
        candidate_ranking: rb,
      };
    }
    const bt = base.tokenizer_notes ?? {};
    const ct = cand.tokenizer_notes ?? {};
    pairs.push({
      baseline: { file: baselineEntry.file, variant: base.variant },
      candidate: { file: entry.file, variant: cand.variant, load_mode: cand.config?.load_mode ?? null },
      dims_match: dimsMatch,
      cosine: {
        texts: { ...stats(textCos), per_vector: textCos },
        queries: Object.fromEntries(queryIds.map((id, i) => [id, queryCos[i]])),
      },
      norms: {
        baseline: { texts: stats(base.norms?.texts ?? []), queries: stats(base.norms?.queries ?? []) },
        candidate: { texts: stats(cand.norms?.texts ?? []), queries: stats(cand.norms?.queries ?? []) },
      },
      cosine_pairs: {
        baseline: base.cosine_pairs ?? null,
        candidate: cand.cosine_pairs ?? null,
        delta: Object.fromEntries(Object.keys(base.cosine_pairs ?? {}).map((k) => [
          k, (cand.cosine_pairs?.[k] ?? NaN) - base.cosine_pairs[k],
        ])),
      },
      rankings: rankingComparison,
      tokenizer: {
        probe_text0_ids_equal: arrEq(bt.probe_token_ids?.[0], ct.probe_token_ids?.[0]),
        probe_text6_ids_equal: arrEq(bt.probe_token_ids?.[6], ct.probe_token_ids?.[6]),
        truncation_token_count: { baseline: bt.truncation_token_count ?? null, candidate: ct.truncation_token_count ?? null, equal: bt.truncation_token_count === ct.truncation_token_count },
        empty_string_token_ids_equal: arrEq(bt.empty_string_token_ids, ct.empty_string_token_ids),
      },
      timings: { baseline: base.timings ?? null, candidate: cand.timings ?? null },
      cache_bytes_downloaded: { baseline: base.cache?.bytes_downloaded ?? null, candidate: cand.cache?.bytes_downloaded ?? null },
    });
  }
}

const comparison = {
  schema: 'issue-252-equivalence-comparison/1',
  generatedAt: new Date().toISOString(),
  baseline: baselineEntry ? { file: baselineEntry.file, variant: baselineEntry.rep.variant } : null,
  baseline_missing_reason: baselineEntry ? null : 'no ok report with variant fastembed-baseline was provided',
  ok_reports: loaded.map((e) => ({ file: e.file, variant: e.rep.variant, runtime: e.rep.runtime, versions: e.rep.versions })),
  missing_reports: missing,
  non_ok_reports: nonOk,
  pairs,
};

fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, 'comparison.json');
fs.writeFileSync(jsonPath, JSON.stringify(comparison, null, 2) + '\n');

// --- markdown summary -------------------------------------------------------------
const fmt = (x, d = 6) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : String(x ?? 'n/a'));
const lines = [];
lines.push('# Embedding equivalence comparison (issue #252, temporary evidence)');
lines.push('');
lines.push(`Generated: ${comparison.generatedAt}`);
lines.push('');
if (!baselineEntry) {
  lines.push(`**No baseline:** ${comparison.baseline_missing_reason}. No ok-vs-baseline pairs computed.`);
} else {
  lines.push(`Baseline: \`${baselineEntry.file}\` (${baselineEntry.rep.variant}, ${baselineEntry.rep.runtime?.platform}/${baselineEntry.rep.runtime?.arch}, ${baselineEntry.rep.runtime?.libc}).`);
}
lines.push('');
lines.push('## Report inventory');
lines.push('');
lines.push('| File | Variant | Status |');
lines.push('|---|---|---|');
for (const e of loaded) lines.push(`| ${e.file} | ${e.rep.variant} | ok |`);
for (const e of nonOk) lines.push(`| ${e.file} | ${e.variant ?? 'n/a'} | ${e.status}${e.error ? `: ${String(e.error).slice(0, 160)}` : ''} |`);
for (const e of missing) lines.push(`| ${e.file} | n/a | missing (${e.reason}) |`);
lines.push('');
if (pairs.length) {
  lines.push('## Ok-vs-baseline pairs');
  lines.push('');
  lines.push('| Candidate | Dims match | Text cos mean | Text cos min | Q1 cos | Q2 cos | Q1 top1 | Q1 top3 set | Q1 tau | Q2 top1 | Q2 top3 set | Q2 tau | Tok probes equal | Trunc equal |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of pairs) {
    const q1 = p.rankings.Q1 ?? {};
    const q2 = p.rankings.Q2 ?? {};
    const tokEq = p.tokenizer.probe_text0_ids_equal && p.tokenizer.probe_text6_ids_equal;
    lines.push(`| ${p.candidate.variant} (${p.candidate.load_mode ?? 'standard'}) | ${p.dims_match} | ${fmt(p.cosine.texts.mean)} | ${fmt(p.cosine.texts.min)} | ${fmt(p.cosine.queries.Q1)} | ${fmt(p.cosine.queries.Q2)} | ${q1.top1_match} | ${q1.top3_set_match} | ${fmt(q1.kendall_tau, 4)} | ${q2.top1_match} | ${q2.top3_set_match} | ${fmt(q2.kendall_tau, 4)} | ${tokEq} | ${p.tokenizer.truncation_token_count.equal} |`);
  }
  lines.push('');
  lines.push('Full per-vector cosines, rankings, norm ranges, Spearman rho, timings and cache bytes: `comparison.json`.');
}
lines.push('');
lines.push('This file is evidence, not a gate (compare.mjs always exits 0).');
lines.push('');
const mdPath = path.join(outDir, 'comparison.md');
fs.writeFileSync(mdPath, lines.join('\n'));

console.log(`comparison written: ${jsonPath} + ${mdPath}`);
console.log(`ok=${loaded.length} pairs=${pairs.length} non-ok=${nonOk.length} missing=${missing.length}`);
process.exit(0);