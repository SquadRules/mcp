#!/bin/sh
# TEMPORARY evidence infrastructure for issue #252 (fastembed ->
# @huggingface/transformers). Removed before the final PR merges.
#
# Runs one equivalence variant in a fresh scratch dir and copies the report
# plus install evidence into $REPORT_DIR. POSIX sh; no repo dependencies are
# installed (the scratch package.json is the ONLY install context).
#
# Usage:
#   REPORT_DIR=/path/to/reports sh run-variant.sh <variant>
# Variants:
#   fastembed-baseline   fastembed@3.0.0 + the two shipped fastembed-chain overrides
#   tj4-xenova-fp16      @huggingface/transformers@4.3.2, Xenova fp16 (no overrides)
#   tj4-xenova-q8        same, q8
#   tj4-qdrant-direct    same, Qdrant repo direct (harness falls back to qdrant-local)
#   tj3-xenova-fp16      @huggingface/transformers@3.8.1, Xenova fp16 (fallback data point)
#
# TJ_PKG_VERSION / TJ_MODEL_REPO / TJ_DTYPE / TJ_REVISION / TJ_MODEL_FILE_NAME
# may be overridden from the environment; otherwise per-variant defaults apply.
# Exit code: harness exit code (0 ok, 2 host-blocked, 1 error); install failure
# writes an error report and exits 1. Reports/logs are always copied first.

set -eu

VARIANT="${1:?usage: REPORT_DIR=<dir> sh run-variant.sh <variant>}"
REPORT_DIR="${REPORT_DIR:?set REPORT_DIR to the report output directory}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$REPORT_DIR"

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

XENOVA_REV=ea104dacec62c0de699686887e3f920caeb4f3e3

case "$VARIANT" in
  fastembed-baseline)
    HARNESS=harness-fastembed.mjs
    ;;
  tj4-xenova-fp16)
    HARNESS=harness-transformers.mjs
    TJ_PKG_VERSION="${TJ_PKG_VERSION:-4.3.2}"
    TJ_MODEL_REPO="${TJ_MODEL_REPO:-Xenova/bge-small-en-v1.5}"
    TJ_DTYPE="${TJ_DTYPE:-fp16}"
    TJ_REVISION="${TJ_REVISION:-$XENOVA_REV}"
    ;;
  tj4-xenova-q8)
    HARNESS=harness-transformers.mjs
    TJ_PKG_VERSION="${TJ_PKG_VERSION:-4.3.2}"
    TJ_MODEL_REPO="${TJ_MODEL_REPO:-Xenova/bge-small-en-v1.5}"
    TJ_DTYPE="${TJ_DTYPE:-q8}"
    TJ_REVISION="${TJ_REVISION:-$XENOVA_REV}"
    ;;
  tj4-qdrant-direct)
    HARNESS=harness-transformers.mjs
    TJ_PKG_VERSION="${TJ_PKG_VERSION:-4.3.2}"
    TJ_MODEL_REPO="${TJ_MODEL_REPO:-Qdrant/bge-small-en-v1.5-onnx-Q}"
    # fp32 = no dtype suffix -> requests exactly model_optimized.onnx (the
    # Qdrant artifact is an fp16-optimized graph; the suffix only names files).
    TJ_DTYPE="${TJ_DTYPE:-fp32}"
    TJ_REVISION="${TJ_REVISION:-main}"
    TJ_MODEL_FILE_NAME="${TJ_MODEL_FILE_NAME:-model_optimized}"
    ;;
  tj3-xenova-fp16)
    HARNESS=harness-transformers.mjs
    TJ_PKG_VERSION="${TJ_PKG_VERSION:-3.8.1}"
    TJ_MODEL_REPO="${TJ_MODEL_REPO:-Xenova/bge-small-en-v1.5}"
    TJ_DTYPE="${TJ_DTYPE:-fp16}"
    TJ_REVISION="${TJ_REVISION:-$XENOVA_REV}"
    ;;
  *)
    echo "unknown variant: $VARIANT" >&2
    exit 1
    ;;
esac

# --- scratch install context ---------------------------------------------------
if [ "$VARIANT" = fastembed-baseline ]; then
  # Mirrors the shipped root's fastembed-chain overrides (ADR 0030 tokenizers
  # override + global-agent override for onnxruntime-node's global-agent 3.x).
  cat > "$SCRATCH/package.json" <<'PKG'
{
  "name": "issue-252-equivalence-fastembed",
  "private": true,
  "dependencies": {
    "fastembed": "3.0.0"
  },
  "overrides": {
    "@anush008/tokenizers": "^0.6.0",
    "global-agent": "^4.1.3"
  }
}
PKG
else
  # Consumer fidelity: NO overrides for transformers variants.
  cat > "$SCRATCH/package.json" <<PKG
{
  "name": "issue-252-equivalence-transformers",
  "private": true,
  "dependencies": {
    "@huggingface/transformers": "${TJ_PKG_VERSION}"
  }
}
PKG
fi

INSTALL_LOG="$REPORT_DIR/$VARIANT-npm-install.log"
if ! (cd "$SCRATCH" && npm install --no-audit --no-fund) > "$INSTALL_LOG" 2>&1; then
  cat > "$REPORT_DIR/$VARIANT.json" <<STUB
{
  "schema": "issue-252-equivalence/1",
  "variant": "$VARIANT",
  "status": "error",
  "error": { "phase": "npm-install", "message": "npm install failed; see $VARIANT-npm-install.log" }
}
STUB
  echo "npm install failed for $VARIANT (log: $INSTALL_LOG)" >&2
  exit 1
fi

# Install evidence per variant.
(cd "$SCRATCH" && npm ls --all) > "$REPORT_DIR/$VARIANT-npm-ls-all.txt" 2>&1 || true
(cd "$SCRATCH" && du -sh node_modules) > "$REPORT_DIR/$VARIANT-du.txt" 2>&1 || true

# --- run the harness inside the scratch dir (module resolution) ------------------
cp "$SCRIPT_DIR/$HARNESS" "$SCRATCH/harness.mjs"
cp "$SCRIPT_DIR/corpus.json" "$SCRATCH/corpus.json"

HARNESS_LOG="$REPORT_DIR/$VARIANT-harness.log"
rc=0
if [ "$VARIANT" = fastembed-baseline ]; then
  (
    cd "$SCRATCH"
    EQUIV_VARIANT="$VARIANT" FASTEMBED_CACHE_DIR="$SCRATCH/model-cache" \
      node harness.mjs report.json corpus.json
  ) > "$HARNESS_LOG" 2>&1 || rc=$?
else
  (
    cd "$SCRATCH"
    EQUIV_VARIANT="$VARIANT" \
    TJ_PKG_VERSION="$TJ_PKG_VERSION" \
    TJ_MODEL_REPO="$TJ_MODEL_REPO" \
    TJ_DTYPE="$TJ_DTYPE" \
    TJ_REVISION="$TJ_REVISION" \
    TJ_MODEL_FILE_NAME="${TJ_MODEL_FILE_NAME:-}" \
    TJ_CACHE_DIR="$SCRATCH/model-cache" \
      node harness.mjs report.json corpus.json
  ) > "$HARNESS_LOG" 2>&1 || rc=$?
  {
    echo "TJ_PKG_VERSION=$TJ_PKG_VERSION"
    echo "TJ_MODEL_REPO=$TJ_MODEL_REPO"
    echo "TJ_DTYPE=$TJ_DTYPE"
    echo "TJ_REVISION=$TJ_REVISION"
    echo "TJ_MODEL_FILE_NAME=${TJ_MODEL_FILE_NAME:-}"
  } > "$REPORT_DIR/$VARIANT-env.txt"
fi

if [ -f "$SCRATCH/report.json" ]; then
  cp "$SCRATCH/report.json" "$REPORT_DIR/$VARIANT.json"
else
  cat > "$REPORT_DIR/$VARIANT.json" <<STUB
{
  "schema": "issue-252-equivalence/1",
  "variant": "$VARIANT",
  "status": "error",
  "error": { "phase": "harness-no-report", "message": "harness exited $rc without writing a report; see $VARIANT-harness.log" }
}
STUB
fi

echo "variant $VARIANT finished with exit code $rc (report: $REPORT_DIR/$VARIANT.json)"
exit "$rc"