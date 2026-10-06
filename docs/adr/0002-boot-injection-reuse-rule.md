# 0002 — Boot-injection reuse is decided by semver, not by content hash

Status: Accepted, implemented. The reader defect that made the rule inert when this record
was written is fixed by [#26](https://github.com/SquadRules/mcp/pull/26) ([#24](https://github.com/SquadRules/mcp/issues/24))
Date: 2026-10-06 (retrospective; decided 2026-06-15 by `bec19de5`)

## Context

`injectMemResourcesAtBoot()` trains the adapters shipped in `src/embed-docs/mem/` into
whichever store is configured. Retraining means re-embedding every layer, which was
paid for in OpenAI quota until local embeddings arrived. Whether a start may *reuse*
what is already stored has been argued four times:

- `8c070e28` 2026-03-22 — "feat: shell challenge fields, chain scroll, mem boot
  idempotency": first attempt to make boot writes idempotent.
- `2fcbd1c2` 2026-05-03 — "fix(dev): start server from bootstrap; disable broken mem
  boot dedup (#410)": that dedup was broken and switched off.
- `c35918e0` 2026-05-19 — "fix(mem): recover boot system adapter points (#487)":
  recovery path for duplicated/lost system-adapter points.
- `4f7ab6c3` 2026-06-14 — "fix: replace static-UUID boot sequence with slug-based
  SHA256 change detection": five-phase design (train new and changed, skip unchanged
  by content hash, prune orphans, verify invariants).
- `bec19de5` 2026-06-15 — "fix: restore version-based skip in boot sequence (use
  compareSemver from main)": reverted to semver one day later.

## Decision (as landed)

Reuse is decided by **version comparison**: if a stored adapter version exists and the
shipped version is not greater, the adapter is skipped; otherwise it is deleted and
re-trained. `compareSemver` is the comparator. The slug is the adapter identity; static
UUIDs are not used.

The content hash from `4f7ab6c3` was demoted, not deleted:
`CONTENT_SHA256_KEY` (`content_sha256`) is still written onto every layer via
`setPayloadOnLayers` "for future change detection", but **no code reads it**. The prune
and invariant phases of the five-phase design are not present today.

`options.force` is the structural-repair switch, and it is now honoured: when it is set the
version check is not performed at all, so every shipped adapter is deleted and re-trained.
Its default comes from `MEM_BOOT_FORCE_INJECT` (`src/config/mem-boot.ts`), so an operator
with a dimension-mismatched or duplicated store has a documented way back without a code
change.

## Consequences

- The rule is correct only if a release always implies changed semantics. It does:
  `prebuild` stamps mem frontmatter from the package version, so a release moves the
  version even when the body of an adapter is untouched — every shipped adapter is
  re-trained on the first boot after an upgrade, once per install, not once per merge.
- Until [#26](https://github.com/SquadRules/mcp/pull/26) the skip **never fired**:
  `getStoredAdapterVersion()` read `payload.protocol_version`, while both writers store the
  version under `payload.adapter.protocol_version` (and promote it to the LanceDB
  `protocol_version` column), so every read returned `undefined` and every boot deleted and
  re-trained everything. Measured then: warm boot 84 s versus cold 86 s, zero skip log
  lines. Both readers now resolve the version through one accessor,
  `getPayloadAdapterVersion()`. Measured after: 9 `skipping` log lines and a 2.4 s warm
  boot, against 99.6 s for a forced cold pass on a CI runner
  ([0003](0003-no-lancedb-store-snapshot.md) re-states the CI consequence).
- The cost of a working skip: boot no longer self-heals a structurally corrupted system
  adapter until its shipped version changes. That automatic recovery was the property
  `c35918e0` (#487) relied on, which is why `options.force` became a real switch in the same
  commit instead of being deleted: `MEM_BOOT_FORCE_INJECT=true` restores
  delete-then-retrain for a corrupted or dimension-mismatched store, and
  `tests/integration/mem-resources-boot-dedupe-regression.test.ts` keeps proving the repair
  path against a deliberately duplicated app-space row.
- Because the version line lives *inside* the hashed content, a future content-hash rule
  would not behave differently across releases. Any proposal to "just use the hash" must
  say whether it excludes the stamped version line; otherwise it re-states
  [0005](0005-cache-keys-under-release-stamping.md).

## Alternatives considered

- Content-hash change detection only (`4f7ab6c3`): rejected on 2026-06-15 in favour of
  the simpler semver rule, which also matches how skill/adapter versions are published.
- Never skip (train every boot): what actually happened while #24 was open; not chosen
  deliberately, and unacceptable once embeddings became local and paid in CI wall-clock.

## Evidence

`src/resources/mem-resources-boot.ts` (skip branch, `force` branch, `CONTENT_SHA256_KEY`),
`src/services/memory/memory-accessors.ts` (`getPayloadAdapterVersion`, the one place the
payload shape is known), `src/services/memory/store.ts` and
`src/services/vector-store/lancedb/lance-records-reads.ts` (both readers),
`src/config/mem-boot.ts` (`MEM_BOOT_FORCE_INJECT`),
`src/services/vector-store/lancedb/lance-records-schema.ts` (`toRow` promotes
`protocol_version` to a column),
`tests/unit/boot-adapter-version-readers.test.ts` and
`tests/unit/mem-resources-boot-reuse-rule.test.ts` (the rule, without ONNX or a server).
Store inspection on 2026-10-06: 51 rows, column `protocol_version = "4.8.6"`,
`payload.adapter.protocol_version = "4.8.6"`, `payload.protocol_version` undefined.
