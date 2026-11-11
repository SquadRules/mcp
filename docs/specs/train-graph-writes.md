# Train/Tune Graph Writes (Touchpoint 3)

This document specifies how `train` and `tune` interact with the embedded graph database
when persisting adapter markdown. Projection is not limited to documents that declare
inheritance: every markdown write reconciles the node and its edges.

**Companion specs:**

- `docs/specs/graph-schema.md` — node/edge shapes and property types (§ 5: frontmatter→graph mapping)
- `docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md` — why the graph is owned by the store, scoped, and derived
- `docs/adr/0024-adapter-contract-verification-ladder.md` — verification ladder context

---

## 1. Fail-Closed Structural Validators

Structural validation runs **before** the memory-store write whenever the document declares
`inherits:` or `override:`. Any error fails the tool call immediately.

| Code | Severity | Trigger |
|------|----------|---------|
| `single_parent` | error | `inherits` value is an array (`[a, b]` or comma-separated) |
| `structural_override_forbidden` | error | `override` list contains a field the framework decides: `contract`, `type`, `steps`, `chain_root`, `inherits`, `override`, `verdict`, `work_envelope`, `effective_contract`, `effective_contracts` (`STRUCTURAL_OVERRIDE_FORBIDDEN_FIELDS`) |
| `override_unknown_field` | error | `override` field not present in parent frontmatter and not a known overridable field |
| `parent_missing` | **warning** | Parent record not found in the child's space or the app space (`resolveStoredParentSnapshot`) — does NOT fail the call |

**Known overridable fields** (always accepted in `override:` without parent cross-check):
`slug`, `version`, `title`, `tags`, `metadata`, `space`, `layer_count`, `contract_types`,
`protocol_version`.

### Error response shape

```json
{
  "error": "INHERITANCE_STRUCTURE_INVALID",
  "message": "[structural_override_forbidden] override field \"contract\" is structural and may not be overridden",
  "must_obey": true,
  "items": [{ "code": "structural_override_forbidden", "message": "...", "field": "contract" }]
}
```

### Warning response shape (included in successful train output)

```json
{
  "status": "stored",
  "items": [...],
  "warnings": [{ "code": "parent_missing", "message": "parent adapter \"x\" not found in graph..." }]
}
```

---

## 2. Graceful-Degradation Graph Projection

**Every successful markdown write is projected immediately — plain or inheriting.** The
write path does not defer a plain adapter to the next boot; §2.1 states why.

After the memory-store write succeeds, the tool projects the **stored record** into the
graph owned by the store it was handed:

1. `getGraphDb(...)` returns `null` → skip silently (store booted without a graph, graph
   disabled, or the open failed). `train` asks the memory store
   (`getGraphDb(memoryStore)`); `tune` asks the retrieval surface it was handed
   (`getGraphDb(qdrantService)`).
2. The tool re-reads the head it just wrote — `getMemory(uuid, { fresh: true })` on
   `train`, `retrieveById` + `pointToMemory` on `tune` — so the stored `slug`, `space_id`
   and topology frontmatter are the ones that landed.
3. `projectAdapterLineage(graphDb, source, head, 'train' | 'tune')`
   (`src/services/graph-db/adapter-graph-sync.ts`) builds the head snapshot with
   `snapshotFromLayers([head], context)`, which delegates to `snapshotFromStoredMemory`
   with the scope taken from the record's `space_id`. It then walks the stored ancestry
   root-first through `resolveStoredParentSnapshot`, capped at 32 hops, so a parent is
   written before the child edge that points at it.
4. `syncAdapterGraph(graphDb, lineage)` writes every node, then every edge, inside
   try/catch.
5. On failure: log a warning via `structuredLogger.warn(...)`, **do not propagate**.

The memory write is the source of truth. The graph is a derived projection that boot
reconciliation rebuilds from the store — see
`docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md` for the decision and
for what projection cannot restore. Adapter persistence must never fail because of graph
unavailability. Projecting from the re-read record rather than the authoring markdown is
what guarantees a failed write leaves no node.

### 2.1 Why every write, not only inheriting ones

Three behaviours depend on projecting a node that declares no `inherits`:

- **A plain adapter is a node too.** Projecting it is what makes it discoverable to a
  child trained next; waiting for boot would leave a window where a stored parent has no
  node to point at.
- **Removing `inherits:` must remove the edge.** `syncAdapterGraph` runs the edge pass for
  **every** written node, and `writeInheritanceEdges` clears the child's existing edges
  before creating the declared one. Projecting the plain node is how a record that stopped
  declaring a parent loses the edge it used to have.
- **Boot reconcile is the backfill, not the trigger.** A parent that is genuinely not
  stored yet is reported in `missing_parents`; `reconcileAdapterGraphFromStore`
  re-projects the space it injected and links the pair once both records exist.

> `docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md` Consequences §3
> still describes the earlier conditional behaviour. The code paths above are authoritative
> for the delivered write path.

### Projection semantics

`syncAdapterGraph` runs two passes over the batch:

1. **Nodes** — `upsertAdapterFromFrontmatter(slug, version, frontmatter, { spaceId, title?, layerCount? })`
   for every snapshot. A per-adapter failure is collected in `failed[]`.
2. **Edges** — for every node the first pass wrote, `writeInheritanceEdges(childKey,
   frontmatter, { parentSpaceId })` removes that child's existing edges itself before
   creating the declared one, so a re-train is idempotent and topology from a previous
   parent does not survive. With `inherits` set, the parent scope is resolved first by
   `resolveParentScope` (child scope first, app space second — `parentScopeCandidates`);
   when the parent node is not projected, the child's edges are cleared and the pair is
   reported in `missing_parents`, and the boot reconcile backfills it once the parent is
   stored. A node with no `inherits` is reconciled the same way, which is how an edge the
   record has stopped declaring disappears.

Edges are skipped for any adapter whose node write failed, so an edge never points at a
node that was not written. An edge-pass failure is collected in `edge_failures` and does
not escape the projection.

The node key is scope-qualified — `adapter:<spaceId>:<slug>`
(`src/services/graph-db/adapter-scope.ts`) — because the same slug can be stored in
several spaces at once. `scopeMetadata()` records `scope_space_id` and `scope_source` on
both node and edge, so the resolved scope is auditable instead of implicit.

---

## 3. Hook Points

| Tool | Module | Hook location |
|------|--------|---------------|
| `train` | `src/tools/train-store.ts` (`projectStoredAdapterLineage`), `src/tools/train-validation.ts` (`assertInheritanceFrontmatterValid`) | `assertInheritanceFrontmatterValid` before `memoryStore.storeAdapter`; `projectStoredAdapterLineage` after it returns, keyed on the written head |
| `tune` | `src/tools/tune-adapter-markdown.ts` (`assertTuneInheritanceValid`, `projectTunedAdapter`) | `assertTuneInheritanceValid` before the layer write loop; `projectTunedAdapter` after `verifyTuneLayerPersistence` |

`executeTune` (`src/tools/tune-execute.ts`) reaches this module for a `content` tune on an
adapter URI; both hooks live in the module that owns the write they guard.

Both validators receive the resolved child scope (`writeAdapterScope()` on `train`,
`storedAdapterScope()` on `tune`) and look the parent up with
`resolveStoredParentSnapshot(source, parentSlug, childSpaceId)`, so they check the parent
frontmatter the edge will actually point at — not the child's own document.

Artifact trains (`mime != text/markdown`) do not trigger inheritance validation or graph
projection — artifacts have no frontmatter, and `executeTrainStore` returns before the
frontmatter path.

---

## 4. Frontmatter Parsing

The `inherits:` and `override:` fields are parsed by the existing `parseFrontmatter()`
utility (`src/utils/frontmatter.ts`), which now extracts:

- `inherits` → `ParsedFrontmatter.inherits` (string)
- `override` → `ParsedFrontmatter.overrideRaw` (raw string, parsed by `parseOverrideList()`)

`parseOverrideList` accepts YAML-like inline lists: `[tags, metadata]` or comma-separated
`tags, metadata`.

---

## 5. Implementation Files

| File | Purpose |
|------|---------|
| `src/services/graph-db/adapter-inheritance.ts` | Pure validators, types, parse helpers |
| `src/services/graph-db/adapter-scope.ts` | Scope-qualified keys (`adapter:<spaceId>:<slug>`) and the one scope policy |
| `src/services/graph-db/adapter-graph-sync.ts` | `syncAdapterGraph` (nodes then edges), `projectAdapterLineage`, `resolveParentScope`, `reconcileAdapterGraphFromStore` |
| `src/services/graph-db/adapter-graph-records.ts` | `snapshotFromLayers`, `snapshotFromStoredMemory`, `resolveStoredParentSnapshot`, `snapshotsFromRecords` — stored-record snapshots, never authoring markdown |
| `src/services/graph-db/inheritance-write-validation.ts` | Local structural vetoes and `INHERITANCE_VALIDATION_UNAVAILABLE` for an unestablishable parent read |
| `src/services/graph-db/graph-owner.ts` | `attachGraphDb` / `getGraphDb` — the graph belongs to the store, not the process |
| `src/services/graph-db/graph-database.service.ts` | `upsertAdapterFromFrontmatter`, `writeInheritanceEdges`, `clearInheritanceEdges`, `getChildren` |
| `src/services/graph-db/index.ts` | Re-exports for the inheritance module |
| `src/services/memory/stored-adapter-frontmatter.ts` | Persists `inherits` / `override` / `chain_root` on the stored `adapter` payload |
| `src/tools/train-store.ts` | `projectStoredAdapterLineage` |
| `src/tools/train-validation.ts` | `assertInheritanceFrontmatterValid` |
| `src/tools/tune-adapter-markdown.ts` | `assertTuneInheritanceValid`, `projectTunedAdapter` |
| `src/utils/frontmatter.ts` | Extended with `inherits` and `overrideRaw` fields |

The test files, and what each one covers, are code-derivable and are not restated here.
The verified-by evidence for this touchpoint is the **Verify** section of
[ADR 0043](../adr/0043-additive-selective-inheritance-and-inheritance-checkpoints.md)
(and of [ADR 0042](../adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md));
this spec describes the design, not a test result.
