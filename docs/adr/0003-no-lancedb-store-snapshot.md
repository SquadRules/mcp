# 0003 — No LanceDB store snapshot in CI

Status: Accepted, still in force. The decision not to build a LanceDB store snapshot stands.
Its revisit condition ([#24](https://github.com/SquadRules/mcp/issues/24)) remains **open on
`main`**: the boot-injection fix that would have reinforced this decision lived on
[#26](https://github.com/SquadRules/mcp/pull/26), which closed unmerged.
Date: 2026-10-06

## Context

The embedded LanceDB backend keeps its store in `$XDG_CONFIG_HOME/squadrules/lancedb`.
In CI that is the embedded lane (`verify-integration-embedded-simple` on `main`; a rename to
`verify-integration-single` was proposed in [0006](0006-two-integration-lanes.md), closed
unmerged); locally it is any `npx`-style run. The proposal was to mirror the Qdrant Layer 1
design for it: export a tarball of the data directory after the first run, cache it, and
restore it on later runs so boot does not re-embed the shipped adapters.

## Decision

Do not build a store snapshot/export path for LanceDB. The mechanism would cost CI
complexity for no measured saving.

## Consequences

- On `main` the embedded path still pays full boot injection per process start, because the
  reuse rule is broken ([0002](0002-boot-injection-reuse-rule.md),
  [#24](https://github.com/SquadRules/mcp/issues/24) open): every store opener — including
  each stdio child the embedded lane spawns — deletes and re-trains the shipped adapters.
  The [#26](https://github.com/SquadRules/mcp/pull/26) branch fixed the skip and measured
  9 `skipping` log lines and a 2.4 s warm boot, which would have made a snapshot redundant;
  that fix closed unmerged, so the redundancy is not yet real on `main`.
- The decision stands either way. While the skip is broken, a restored directory buys only
  ~2 s (see the measurement below), which does not justify a cross-job store artifact. If
  the [#24](https://github.com/SquadRules/mcp/issues/24) fix ever lands, the decision is
  reinforced rather than reversed: a correct skip removes the cost a snapshot would target,
  at zero infrastructure.
- The standing product directive is to add no store-snapshot support for LanceDB at this
  time. Should a future run make cold injection expensive again, reopen it as a new
  measurement here rather than as a change to the rule in
  [0002](0002-boot-injection-reuse-rule.md).
- Model weights are a separate problem and are cached ([0004](0004-fastembed-default-for-testing.md)).
  A weights cache is a download cache, not a snapshot of stored writes; this ADR does
  not restrict it.
- No new scripts (`export-lancedb-snapshot.sh` / `import-lancedb-snapshot.sh`) and no
  new workflow steps are added, so nothing has to be retired later.

## Alternatives considered

- **tgz of the data directory, restore on cache hit** (the original proposal): rejected.
  Measured on 2026-10-06 *while the skip was broken* — cold boot 86 s, warm boot 84 s, zero
  skip log lines, so a restored directory bought about two seconds. That measurement still
  holds on `main`, where the skip remains broken. The
  [#26](https://github.com/SquadRules/mcp/pull/26) branch measured a 2.4 s warm boot once
  [#24](https://github.com/SquadRules/mcp/issues/24) was fixed there, which would supersede
  it — but only if that fix merged. Rejected again on its own merits — a cross-job store
  artifact carries an invalidation input (adapter set *and* vector width *and* LanceDB format
  version) that the runtime skip already derives from the store itself, and
  [0005](0005-cache-keys-under-release-stamping.md) shows how easily such a key goes stale.
- **Snapshot the store and disable boot injection for it**: rejected — it would make the
  lane test a configuration no user runs, and silently hide the #24 defect.

## Evidence

- Store directory after injection: 5.8 MB (small enough that size is not the argument).
- Injection of the 9 shipped adapters took 82 s of an 86 s boot (CPU ONNX, fastembed
  default model, 768 dims) — i.e. the snapshot proposal was priced against the defect, not
  against the steady state.
- On the [#26](https://github.com/SquadRules/mcp/pull/26) branch, after the #24 fix, the
  same store warm-booted in 2.4 s with 9 `skipping` lines. That PR closed unmerged, so on
  `main` the warm boot is still ~84 s.
- There is no `optimize()`/compaction call in `src/`, so a tarball would not race
  background compaction — safety was never the reason to reject this; value was.
