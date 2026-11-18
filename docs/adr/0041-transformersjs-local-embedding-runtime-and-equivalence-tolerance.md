# 0041 — Replace FastEmbed with Transformers.js v4; equivalence tolerance and in-place compatibility

## Status

Proposed — decision taken by the #252 task owner 2026-11-18; implementation
lands with PR #308. Reconcile to Accepted when the replacement and its
golden-vector gate are on `main`.

Date: 2026-11-18

## Context

The built-in local embedding runtime `fastembed@3.0.0` is archived
([#252](https://github.com/SquadRules/mcp/issues/252)). Its chain carries two
deprecated packages (`@anush008/tokenizers`, and `boolean@3.2.0` through
`onnxruntime-node@1.21.0` → `global-agent@3.x` in consumer installs where root
overrides do not propagate), and the tokenizers override exists only to patch
a missing Linux ARM64 binding ([ADR 0030](0030-tokenizers-arm64-native-binding-override.md)).

On 2026-11-18 the chain became actively breaking, not merely deprecated:
`onnxruntime-node@1.21.0`'s postinstall downloads
`onnxruntime-linux-x64-gpu-1.21.0.tgz` from GitHub releases, which now returns
404 (verified; the last successful `main` Integration run was 2026-10-05).
Any fresh `npm ci` of the shipped dependency set fails on linux x64.

Two facts shape the compatibility decision:

- The shipped artifact is `Qdrant/bge-small-en-v1.5-onnx-Q/model_optimized.onnx`
  — **FP16-optimized despite the "-Q" name** (verified from the published
  tarball's `ort_config.json`: `fp16: true`, empty quantization). Preprocessing:
  CLS pooling, L2 normalization (ε 1e-12), truncation at 512 with fixed-length
  padding, no query/passage prefixes.
- The store-width binding of
  [ADR 0021](0021-embedding-provider-auto-resolution-and-store-width-binding.md)
  records provider/model/dimension but **enforces dimension only**: boot warns
  on width mismatch, writes refuse on width mismatch, and Qdrant migration
  keys on width change. A same-384-dimension runtime swap passes every
  existing guard silently — so vector equivalence had to be measured, not
  assumed from the dimension.

## Decision

1. **Runtime: `@huggingface/transformers@4.3.2`, exact pin.** It pins
   `onnxruntime-node@1.30.0` (→ `global-agent@^4.1.3`, no `boolean`) and
   `@huggingface/tokenizers@0.2.0` (pure JS/TS, 361 kB, zero dependencies —
   registry-verified). The in-process retry-poisoning bug
   (transformers.js#1767, present in 3.8.1) is structurally absent on v4's
   Node native path: sessions are created fresh per call and
   `ensureWasmLoaded()` resolves trivially there (source-verified at tag
   4.3.2). The provider keeps the existing lazy-import, memo-clear-on-failure
   retry contract.

2. **Model: `Xenova/bge-small-en-v1.5`, revision
   `ea104dacec62c0de699686887e3f920caeb4f3e3`, dtype `fp16`**, CLS pooling,
   L2 normalization, truncation at 512, longest padding (transformers.js
   default), no prefixes. The reported model identity includes repo, revision,
   and dtype so a dtype or revision change is visible in store metadata and
   audit. `TRANSFORMERS_MODEL` / `TRANSFORMERS_MODEL_REVISION` /
   `TRANSFORMERS_DTYPE` / `TRANSFORMERS_CACHE_DIR` are the canonical env
   surface; the cache defaults to the existing shared `embedding-models` dir.

3. **Identifier: `transformers` is canonical; `fastembed` remains a deprecated
   alias** resolving to the same runtime with a one-time structured warning.
   `FASTEMBED_CACHE_DIR` is honored as a fallback; `FASTEMBED_MODEL` maps the
   shipped default enum value to the new model and fails with an actionable
   error for any other prior-era enum value (no silent guessing). Historical store
   metadata stamped `fastembed` stays valid and readable.

4. **Equivalence tolerance (the quantitative gate).** Measured on the fixed
   12-text corpus (empty string, unicode, code, near-duplicates, a 600-word
   truncation probe) plus 2 ranking queries, on linux/arm64 and macOS with
   linux/amd64 confirmation (PR #308 evidence runs 44328646097, 44329728686):
   - 11 of 12 texts: per-vector cosine ≥ 0.99999 vs the FastEmbed baseline;
     the truncation probe is the sole outlier at ≥ 0.9946 on every platform.
   - Query vectors: cosine ≥ 0.99999. Top-1 and top-3 sets agree on both
     probe queries; Kendall τ = 1.0 (Q1) / 0.97 (Q2, tail reorder only).
   - Tokenizer probes and 512-token truncation counts are equal; norms are
     unit within 2e-7; dims 384.
   - The FastEmbed baseline itself is cross-platform identical
     (min cosine 0.9999994 arm64 vs macOS), so one golden fixture is valid
     on all supported architectures.

   The permanent regression gate (golden-vector fixture + child-process real
   inference test, per [ADR 0004](0004-fastembed-default-for-testing.md)'s
   no-ONNX-in-Jest-realm rule) asserts: dims 384; |norm − 1| ≤ 1e-5;
   **per-vector cosine ≥ 0.99; mean cosine ≥ 0.999; query cosine ≥ 0.999;
   top-1 and top-3 agreement; truncation count 512.** These bounds admit the
   measured fp16 execution drift with margin and reject an int8 quantization
   swap (measured q8: mean 0.9956, min 0.9884 — fails both cosine gates).

5. **Compatibility verdict: in-place, within tolerance — no forced
   re-embedding.** Existing populated 384-dim stores keep their vectors;
   mixing baseline and replacement vectors is accepted because retrieval
   ranking is demonstrably preserved within the tolerance above. To keep the
   swap **non-silent**, boot logs a structured notice whenever stored
   provider/model identity differs from the resolved identity at equal width
   (closing the observability half of the same-width blind spot). The
   historical creating-provider stamp is not rewritten. Width-mismatch
   refusal and Qdrant width migration (ADR 0021) are unchanged.

6. **Future changes are gated, not silent.** Any change to model repo,
   revision, dtype, pooling, normalization, or truncation must re-run the
   equivalence measurement against the golden fixture. Exceeding the
   tolerance requires a new explicit migration decision (superseding ADR),
   never a silent swap; LanceDB's refuse-over-re-embed posture (ADR 0021
   TBD 2) remains the fallback for out-of-tolerance changes.

7. **CI and platforms.** The SINGLE integration lane gains a linux/arm64
   runner (`ubuntu-24.04-arm`, free on this public repo) so real inference is
   covered on both architectures; the model-cache key changes (new on-disk
   layout; one cold re-download expected). musl/Alpine remains unsupported —
   `onnxruntime-node` ships no musl prebuilds, exactly as with the shipped
   fastembed (probe evidence: glibc loader missing). Android/bionic remains
   unsupported (no native binding; unchanged). **Known regression:
   `onnxruntime-node@1.30.0` ships darwin-arm64 only — Intel macOS loses
   native local inference** (1.21.0 had darwin-x64). Documented in
   known-issues; Apple Silicon macOS is verified working.

## Consequences

### Positive

- Consumer installs are free of `@anush008/tokenizers` and `boolean@3.2.0`
  without relying on root overrides; the archived-runtime deprecation
  warnings retire.
- The upstream 404 that breaks `npm ci` on `main` disappears with the chain.
- Warm inference is ~8–10× faster (arm64: 178 → 21 ms/text; macOS:
  615 → 58 ms/text); cold start and download size are at parity
  (~67.5 MB fp16); batch throughput improves (arm64 3.09 → 1.90 s/12 texts).
- Tokenization becomes pure JS (no native tokenizer binding matrix to patch;
  ADR 0030's override retires).
- Vector-space continuity is enforced by a permanent quantitative gate, not
  by trust in a model name.

### Negative

- One-time model re-download (cache layout differs from fastembed's).
- New native surface: `sharp` (musl supported; android not) and
  `onnxruntime-node` 1.30 (glibc linux x64/arm64, darwin arm64, win32).
- Intel macOS native local inference regresses (Decision 7).
- The truncation-probe drift (0.9946) is real and accepted; texts beyond 512
  tokens are the only measurably affected class.
- `@huggingface/transformers` v4 is a young major; the exact pin plus the
  golden gate contain upgrade risk, but upgrades require re-measurement.

## Alternatives considered

- **`@huggingface/transformers@3.8.1`:** rejected — pins ort-node 1.21.0,
  keeping `boolean@3.2.0` in consumer trees and the upstream 404; carries the
  #1767 retry-poisoning bug.
- **q8 (int8) default:** rejected — half the download and fastest, but ~10×
  the drift (min 0.9884) and batch-composition-sensitive outputs
  (max abs diff 2e-2 vs fp16's 0). Remains operator-selectable via
  `TRANSFORMERS_DTYPE` with the identity visible in metadata; the golden gate
  fails under q8, which is intended: choosing it is an explicit act.
- **Qdrant-direct artifact (`model_file_name: 'model_optimized'`,
  `subfolder: ''`):** measured equivalent (min 0.9946, same pattern) and
  CI-proven, but relies on a nonstandard load path against an upstream repo
  fastembed consumed at unpinned `main`. Xenova fp16 gives the same numbers
  with a standard layout and an explicit revision pin.
- **Python FastEmbed / external inference service:** excluded by #252.
- **WASM-only runtime in Node:** the v3 seam is broken (#1743) and v4's Node
  path is native; a productized WASM fallback is out of scope and unnecessary
  for the supported platform set.

## Reopen condition

[#252](https://github.com/SquadRules/mcp/issues/252) reopens this record when
(a) any model/revision/dtype/preprocessing change exceeds the Decision 4
tolerance, (b) a supported-platform regression is reported (Intel macOS,
musl, ARM64), or (c) a transformers.js major upgrade is proposed.

## Evidence

- PR #308 temporary evidence infra (`scripts/embedding-equivalence/`, removed
  before merge): runs 44328646097 (linux/arm64 + macOS, all five variants ok)
  and 44329728686 (adds linux/amd64 baseline via CUDA-skip install flag).
- Comparison summaries: per-text cosines, rank agreement, norms, timings,
  cache bytes (arm64/macOS tables in the PR; amd64 appended on completion).
- Registry facts: `@huggingface/transformers@4.3.2` dependencies;
  `onnxruntime-node@1.30.0` → `global-agent@^4.1.3`;
  `@huggingface/tokenizers@0.2.0` pure-JS metadata.
- Source verification at tag 4.3.2: `packages/transformers/src/backends/onnx.js`
  `createInferenceSession` (fresh session per call; Node path skips WASM
  cache) and `onnx-node.js`.
- Upstream 404: `curl -I` of the v1.21.0 GPU release asset, 2026-11-18.
- FastEmbed artifact facts: published `fastembed@3.0.0` tarball
  (`MODEL_SOURCES`, `ort_config.json`), baseline harness report.

## Related

- [ADR 0004](0004-fastembed-default-for-testing.md) — CI key-free local
  default; child-process real-inference rule survives the swap.
- [ADR 0021](0021-embedding-provider-auto-resolution-and-store-width-binding.md)
  — width binding and refusal unchanged; this record adds the equal-width
  identity notice and the tolerance gate.
- [ADR 0030](0030-tokenizers-arm64-native-binding-override.md) — superseded:
  the override retires with fastembed.
