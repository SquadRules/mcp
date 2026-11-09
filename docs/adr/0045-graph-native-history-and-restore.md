# ADR 0045: Graph-native adapter history — immutable snapshots, verified export, restore through normal train/tune

## Status

Proposed — implemented and verified on branch `sr6-graph-db-touchpoints` on 2026-11-06;
awaiting independent owner ratification.

Extends [ADR 0042](0042-graph-owned-by-runtime-scoped-keys-derived-topology.md) (graph
ownership, scoped keys, derived topology) and depends on
[ADR 0044](0044-graph-repository-port-and-arango-shared-backend.md) for the port and the
shared backend. It answers the question ADR 0042 left open: adapter topology is
rebuildable, **history is not** — so what exactly is retained, and how is it restored?

## Context

### 1. `tune` rewrites content in place

`tune` replaced a stored adapter's markdown. The previous bytes were gone. There was no
record of who changed the adapter, in which space, from which version, or why, and no way
back to a prior state short of re-authoring it from memory or from a git history that only
knows about bundled adapters.

### 2. A digest alone cannot restore anything

An integrity hash proves *which* bytes were stored; it cannot reproduce them. Any design
that records only a digest and claims "versioning" is bookkeeping theatre — the content is
still lost.

### 3. Monotonicity is a separate axis from the semantic version

Authors bump `version:` (semver) deliberately; two successful writes can carry the same
semantic version. Retaining only `(entity, version)` therefore collides and silently
overwrites the earlier snapshot. Ordering needs its own monotonic counter.

### 4. "Restore" must not be a privileged bypass

A restore path that writes markdown directly would skip inheritance validation, frontmatter
validation, embedding, topology projection and scope checks — exactly the invariants every
ordinary write obeys. A restore is a *content* operation, not a storage one.

## Decision

### 1. Every successful write appends one immutable snapshot

After `train`/`tune` persists the adapter, `recordAdapterEvolution()` appends a `Version`
node (`graph-history.service.ts` → `appendVersion`). The node carries:

- `entity_key` (`adapter:<spaceId>:<slug>`) and `entity_uri` (`adapter://<slug>`);
- `version_number` — a **monotonic per-entity sequence** (`1, 2, 3 …`), plus
  `parent_version` naming the previous sequence value;
- `adapter_version` — the semantic version observed at snapshot time;
- `change_type` — `created | updated | restored | deprecated | deleted`;
- `changed_at`, `changed_by`, `actor_source`, and `space`;
- `reason` — the operation that produced it;
- `content_digest` — SHA-256 of `content`;
- `content` — the **full stored markdown, byte-exact**;
- `metadata_snapshot` — title, layer count, `inherits`, scope provenance.

The snapshot is written after the memory write succeeded. A graph failure never fails the
write; it is logged and reported, because history is derived bookkeeping over a durable
store ([ADR 0042](0042-graph-owned-by-runtime-scoped-keys-derived-topology.md) §4 keeps
`Anomaly`/`Version` graph-native, so there is no memory-side copy to fall back to).

### 2. `restored` is derived from bytes, not from a privileged flag

A restore is an ordinary `train`/`tune` whose stored markdown is byte-identical to an
*earlier* snapshot. The hook compares the incoming digest against history; on a match it
records `restored` and appends `restored from snapshot <n>` to `reason`. A digest match
proves byte identity — it does not prove intent, so the label names its source instead of
asserting one.

### 3. Export gains a version selector; nothing else gains a write path

`export` accepts `version` (single adapter URI, markdown output). `executeExportVersion()`
resolves the scoped key from the stored record, reads that snapshot, **re-verifies the
digest before returning it**, and reports `history_version`, `history_versions`,
`snapshot_sha256`, `snapshot_changed_at`, `snapshot_changed_by`. A mismatch raises
`HistoryDigestMismatchError` and no bytes are returned.

Restoring therefore has two ordinary steps: `export({ uri, version })`, then `train` the
returned markdown **with `expected_version`**. That path re-enters every validator,
re-embeds, reprojects topology and appends a new snapshot — monotonic history is preserved,
the old snapshot is untouched.

### 4. Concurrency is settled by compare-and-set before the write

`expected_version` (train and tune) is asserted against the adapter's current semantic
version before any write. A loss raises `VersionConflictError` (`code: VERSION_CONFLICT`)
with the expected and actual values, and nothing is written. The history append has a
second guard: `appendVersion` accepts `expectedParentVersion` / `expectedAdapterVersion`
and raises `GraphVersionConflictError` when the head moved, and the storage key itself
(`version:<entity>@<seq>`) is unique in both backends, so a race cannot overwrite.

### 5. History survives every topology rebuild

Topology in the graph is a projection and can be rebuilt from stored records
([ADR 0042](0042-graph-owned-by-runtime-scoped-keys-derived-topology.md) §3). Snapshots,
anomalies and proposals are **not** projections: a rebuild deletes and re-creates adapter
nodes and inheritance edges only. `Version`, `Anomaly`, `Proposal` and `Confirmation`
documents are never dropped by reconciliation, so a rebuild cannot erase who changed what.

## Consequences

**Positive**

- Any stored adapter can be inspected or restored to an exact prior byte sequence, with the
  actor, space, reason and digest that produced it.
- Restores cannot bypass validation, because they *are* normal writes.
- A lost graph loses history (it is graph-native), but reconciliation cannot erase it.
- Both backends satisfy the same sequence guarantees without a shared clock.

**Negative**

- Full content per snapshot grows storage linearly with write volume; there is no
  compaction or retention policy yet.
- The monotonic counter is per entity, so cross-entity ordering relies on `changed_at`.
- A restore authored by hand (not via `export`) shows as `updated`, not `restored`.

## Evidence

- `src/services/graph-db/graph-history.service.ts`, `graph-actor.ts`,
  `src/tools/export-history.ts`, `src/tools/version-cas.ts`,
  `src/tools/train-store.ts`, `src/tools/tune-execute.ts`.
- `tests/integration/graph-db-history-restore.test.ts` (real LadybugDB + real LanceDB):
  monotonic sequence, digest-verified export, CAS conflict, restore-byte restoration,
  persistence across close/reopen.

## Alternatives considered

- **Keep history in memory records.** Rejected: it duplicates the graph-native record,
  drifts under concurrent writes, and cannot express parent-version chaining.
- **Store only digests.** Rejected: it cannot restore, which is the whole point.
- **Add a dedicated `restore` tool.** Rejected: it would need its own validation surface
  and could drift from `train`; restore is a content operation.
- **Rely on the semantic version for ordering.** Rejected: repeated writes at the same
  semantic version collide.

## Reopening trigger

Revisit if: snapshot volume needs a retention/compaction policy, a second writer must
resume history from a different backend (migration), a legitimate restore needs to be
explicitly labelled by the caller rather than inferred from bytes, or cross-entity
ordering becomes a requirement.
