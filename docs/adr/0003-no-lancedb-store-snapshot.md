# 0003 — No LanceDB store snapshot in CI

Status: Accepted, still in force. The revisit condition set below (#24) was met and
resolved by [#26](https://github.com/SquadRules/mcp/pull/26); the decision stands for a
different reason than the one originally recorded.
Date: 2026-10-06

## Context

The embedded LanceDB backend keeps its store in `$XDG_CONFIG_HOME/squadrules/lancedb`.
In CI that is the single lane of [0006](0006-two-integration-lanes.md), named
`verify-integration-embedded-simple` when this record was written; locally it is any
`npx`-style run. The proposal was to mirror the Qdrant Layer 1 design for it: export a
tarball of the data directory after the first run, cache it, and restore it on later runs
so boot does not re-embed the shipped adapters.

## Decision

Do not build a store snapshot/export path for LanceDB. The mechanism would cost CI
complexity for no measured saving.

## Consequences

- The embedded path no longer pays full boot injection per process start. With the reuse
  rule fixed ([0002](0002-boot-injection-reuse-rule.md),
  [#24](https://github.com/SquadRules/mcp/issues/24)), only the *first* store opener trains
  the shipped adapters; every later one — the stdio children the single lane spawns — reads
  the stored version and skips. Measured on a warm store: 9 `skipping` log lines, 2.4 s.
- That is the reason this record no longer needs a snapshot: the cost a restored directory
  would remove is already removed by a correct skip, which costs no infrastructure at all.
  The decision is therefore reinforced, not reversed, by the fix it was parked on.
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
  skip log lines, so a restored directory bought about two seconds. That measurement is
  superseded by the one above once
  [#24](https://github.com/SquadRules/mcp/issues/24) was fixed: a warm boot is now 2.4 s
  without any snapshot. Rejected again on its own merits — a cross-job store artifact
  carries an invalidation input (adapter set *and* vector width *and* LanceDB format
  version) that the runtime skip already derives from the store itself, and
  [0005](0005-cache-keys-under-release-stamping.md) shows how easily such a key goes stale.
- **Snapshot the store and disable boot injection for it**: rejected — it would make the
  lane test a configuration no user runs, and silently hide the #24 defect.

## Evidence

- Store directory after injection: 5.8 MB (small enough that size is not the argument).
- Injection of the 9 shipped adapters took 82 s of an 86 s boot (CPU ONNX, fastembed
  default model, 768 dims) — i.e. the snapshot proposal was priced against the defect, not
  against the steady state.
- After the #24 fix, the same store warm-boots in 2.4 s with 9 `skipping` lines
  ([#26](https://github.com/SquadRules/mcp/pull/26)).
- There is no `optimize()`/compaction call in `src/`, so a tarball would not race
  background compaction — safety was never the reason to reject this; value was.
