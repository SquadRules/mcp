# 0003 — No LanceDB store snapshot in CI

Status: Accepted, revisit when [#24](https://github.com/SquadRules/mcp/issues/24) lands
Date: 2026-10-06

## Context

The embedded LanceDB backend (`verify-integration-embedded-simple`, and any local
`npx`-style run) keeps its store in `$XDG_CONFIG_HOME/squadrules/lancedb`. The proposal
was to mirror the Qdrant Layer 1 design for it: export a tarball of the data directory
after the first run, cache it, and restore it on later runs so boot does not re-embed
the shipped adapters.

## Decision

Do not build a store snapshot/export path for LanceDB. The mechanism would cost CI
complexity for no measured saving.

## Consequences

- The embedded lane keeps paying full boot injection on every run. That is accepted
  while the saving is not real, and it is explicitly *not* accepted as a permanent
  design: fixing [#24](https://github.com/SquadRules/mcp/issues/24) makes a warm store
  cheap to boot, after which caching the directory becomes worth re-evaluating.
- Model weights are a separate problem and are cached ([0004](0004-fastembed-default-for-testing.md)).
  A weights cache is a download cache, not a snapshot of stored writes; this ADR does
  not restrict it.
- No new scripts (`export-lancedb-snapshot.sh` / `import-lancedb-snapshot.sh`) and no
  new workflow steps are added, so nothing has to be retired later.

## Alternatives considered

- **tgz of the data directory, restore on cache hit** (the original proposal): rejected.
  Measured on 2026-10-06 with a populated store — cold boot 86 s, warm boot 84 s, and
  zero skip log lines. The store is re-written at boot because the version skip never
  fires ([0002](0002-boot-injection-reuse-rule.md)), so a restored directory buys about
  two seconds.
- **Snapshot the store and disable boot injection for it**: rejected — it would make the
  lane test a configuration no user runs, and silently hide the #24 defect.

## Evidence

- Store directory after injection: 5.8 MB (small enough that size is not the argument).
- Injection of the 9 shipped adapters took 82 s of an 86 s boot (CPU ONNX, fastembed
  default model, 768 dims).
- There is no `optimize()`/compaction call in `src/`, so a tarball would not race
  background compaction — safety was never the reason to reject this; value was.
