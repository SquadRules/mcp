# 0001 — Adapter writes are cached at two independent layers

Status: Accepted (Layer 1 parked by decision, see
[#22](https://github.com/SquadRules/mcp/issues/22))
Date: 2026-10-06 (retrospective; the layers date from 2026-05-23 and 2026-03-22)

## Context

Storing an adapter means embedding its layers, which was the expensive part of both CI
and first boot. Two different mechanisms were built to avoid paying it twice, and they
are routinely confused for each other.

**Layer 1 — CI snapshot reuse.** A Qdrant snapshot of a seeded test collection is kept
in the Actions cache. Cache identity is the *semantic inputs of the seed*: the seed and
import scripts plus the fixture that is trained.

- hit → `scripts/import-test-snapshot.sh`: drop `squadrules_ci` and its `_traces`
  collection, upload the cached snapshot (seconds).
- miss → `scripts/seed-test-snapshot.sh`: train through the CLI, take a Qdrant snapshot
  over the API, download it, then save it to the cache (~60 s).

**Layer 2 — runtime boot injection.** `injectMemResourcesAtBoot()`
(`src/resources/mem-resources-boot.ts`) runs on every server start and trains the
adapters shipped in `src/embed-docs/mem/`. Cache identity is the *stored adapter
version* versus the *shipped version* (see [0002](0002-boot-injection-reuse-rule.md)).

## Decision

Keep the two layers conceptually separate and evaluate them separately:

- Layer 1 answers "may we reuse a database someone else already wrote?" — it is a CI
  fixture-provisioning concern, keyed on the inputs of the seed.
- Layer 2 answers "may we reuse what is already in *this* store?" — it is a product
  runtime concern, keyed on adapter identity and version.

A Layer 1 hit does not make Layer 2 cheap, and a Layer 2 skip does not remove the need
for seeded CI fixtures. Any proposal to "fix the cache" must say which layer it means.

## Consequences

- Layer 2 runs *after* Layer 1 import in the same process. While the Layer 2 skip was
  broken ([#24](https://github.com/SquadRules/mcp/issues/24)), a freshly imported snapshot
  was partly re-written at boot, so importing bought no time back. #26 fixed the
  readers ([0002](0002-boot-injection-reuse-rule.md)), so an imported store whose adapters
  carry the current shipped version now survives its own boot.
- Layer 1 is parked rather than re-wired: its original purpose was to save OpenAI
  quota, and once CI embeds locally (see [0004](0004-fastembed-default-for-testing.md))
  the remaining benefit is wall-clock only. Reopen with [#22](https://github.com/SquadRules/mcp/issues/22).
- Until Layer 1 is decided one way or the other, `verify-integration-cluster`
  ([0006](0006-two-integration-lanes.md); this was `verify-integration-primary` when the
  record was written) keeps a `cache/restore` step with no matching `cache/save`, which
  reads as "a cache exists" while no `qdrant-snapshot-*` key has ever been written.

## Alternatives considered

- Treat the layers as one "caching system" and fix both with a single snapshot
  mechanism: rejected, because the store cache is per-process state while the CI
  snapshot is a cross-job artifact, and their invalidation inputs differ.
- Delete Layer 1 outright now: deferred to [#22](https://github.com/SquadRules/mcp/issues/22), since the scripts are also used for local test provisioning.

## Evidence

- `064f8482` 2026-05-23 — "feat: Qdrant snapshot-based test infrastructure with CI
  cache (#520)": restore, seed-on-miss, and save together.
- `3c76573c` 2026-07-17 — "ci: consolidate integration workflows and gate for OpenAI
  quota (#628)": deleted the seed and save steps, kept the restore, renamed
  `kairos_ci.snapshot` to `squadrules_ci.snapshot`.
- 2026-10-06 audit of the Actions cache API: 49 entries (node, playwright,
  infra-docker, codeql), zero `qdrant-snapshot-*`.
- PR #520's own measurement: train ~60 s versus import ~5 s.
