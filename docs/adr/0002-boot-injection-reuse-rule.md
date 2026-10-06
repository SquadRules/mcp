# 0002 — Boot-injection reuse is decided by semver, not by content hash

Status: Accepted (the implemented rule), defective in practice —
[#24](https://github.com/SquadRules/mcp/issues/24)
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

## Consequences

- The rule is correct only if a release always implies changed semantics. It does:
  `prebuild` stamps mem frontmatter from the package version, so a release moves the
  version even when the body of an adapter is untouched — every shipped adapter is
  re-trained on the first boot after an upgrade, once per install, not once per merge.
- The skip currently **never fires**. `getStoredAdapterVersion()` reads
  `payload.protocol_version`, while the canonical location is the promoted
  `protocol_version` column / `payload.adapter.protocol_version`. It returns undefined
  for every slug, so boot always deletes and re-trains. Measured: warm boot 84 s versus
  cold 86 s, zero skip log lines. Tracked as
  [#24](https://github.com/SquadRules/mcp/issues/24).
- `injectMemResourcesAtBoot(store, { force: true })` is misleading: `options.force` is
  interpolated into a log line and changes no behaviour. Either honour it or delete it
  when #24 is fixed.
- Because the version line lives *inside* the hashed content, a future content-hash rule
  would not behave differently across releases. Any proposal to "just use the hash" must
  say whether it excludes the stamped version line; otherwise it re-states
  [0005](0005-cache-keys-under-release-stamping.md).

## Alternatives considered

- Content-hash change detection only (`4f7ab6c3`): rejected on 2026-06-15 in favour of
  the simpler semver rule, which also matches how skill/adapter versions are published.
- Never skip (train every boot): what actually happens today because of #24; not chosen
  deliberately, and unacceptable once embeddings became local and paid in CI wall-clock.

## Evidence

`src/resources/mem-resources-boot.ts` (skip branch, `CONTENT_SHA256_KEY`),
`src/services/memory/store.ts` and
`src/services/vector-store/lancedb/lance-records-reads.ts` (both readers),
`src/services/vector-store/lancedb/lance-records-schema.ts` (`toRow` promotes
`protocol_version` to a column). Store inspection on 2026-10-06: 51 rows, column
`protocol_version = "4.8.6"`, `payload.adapter.protocol_version = "4.8.6"`,
`payload.protocol_version` undefined.
