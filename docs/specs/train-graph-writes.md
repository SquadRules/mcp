# Train/Tune Graph Writes (Touchpoint 3)

This document specifies how `train` and `tune` interact with the embedded graph database
when persisting adapters with inheritance frontmatter.

**Companion specs:**

- `docs/specs/graph-schema.md` — node/edge shapes and property types (§ 5: frontmatter→graph mapping)
- `docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md` — why the graph is owned by the store, scoped, and derived
- `docs/adr/0024-adapter-contract-verification-ladder.md` — verification ladder context

---

## 1. Fail-Closed Structural Validators

When adapter markdown contains `inherits:` frontmatter, the following validators run
**before** the memory-store write. Any error fails the tool call immediately.

| Code | Severity | Trigger |
|------|----------|---------|
| `single_parent` | error | `inherits` value is an array (`[a, b]` or comma-separated) |
| `structural_override_forbidden` | error | `override` list contains `contract`, `type`, `steps`, `chain_root`, `inherits`, or `override` |
| `override_unknown_field` | error | `override` field not present in parent frontmatter and not a known overridable field |
| `parent_missing` | **warning** | Parent slug not found in graph DB — does NOT fail the call |

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

After the memory-store write succeeds, the tool projects the **stored record** into the
graph owned by the store it was handed:

1. `getGraphDb(memoryStore)` returns `null` → skip silently (store booted without a graph,
   graph disabled, or the open failed). The `tune` path resolves the graph from the
   retrieval surface it was handed instead.
2. The tool re-reads the head it just wrote (`getMemory(uuid, { fresh: true })`) and builds
   a snapshot with `snapshotFromLayers([head], 'train' | 'tune', scope)`.
3. `syncAdapterGraph(graphDb, [snapshot])` (`src/services/graph-db/adapter-graph-sync.ts`)
   writes the node, then the edge, inside try/catch.
4. On failure: log a warning via `structuredLogger.warn(...)`, **do not propagate**.

The memory write is the source of truth. The graph is a derived projection that boot
reconciliation rebuilds from the store — see
`docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md` for the decision and
for what projection cannot restore. Adapter persistence must never fail because of graph
unavailability. Projecting from the re-read record rather than the authoring markdown is
what guarantees a failed write leaves no node.

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

| Tool | File | Hook location |
|------|------|---------------|
| `train` | `src/tools/train-store.ts` | `assertInheritanceFrontmatterValid` before `memoryStore.storeAdapter`; `projectStoredAdapter` after it returns, keyed on the written head |
| `tune` | `src/tools/tune-execute.ts` | `assertTuneInheritanceValid` before the layer update loop; `projectTunedAdapter` after `verifyTuneLayerPersistence` |

Both validators receive the resolved child scope (`writeAdapterScope()` on `train`,
`storedAdapterScope()` on `tune`) and look the parent up with
`resolveStoredParentSnapshot(source, parentSlug, childSpaceId)`, so they check the parent
frontmatter the edge will actually point at — not the child's own document.

Artifact trains (`mime != text/markdown`) do not trigger inheritance validation or graph
projection — artifacts have no frontmatter.

Projection is conditional: it runs only for documents that declare inheritance frontmatter.
A plain adapter gets its node at the next boot reconcile, which projects every stored
adapter in the injected space.

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
| `src/services/graph-db/adapter-graph-sync.ts` | `syncAdapterGraph` (nodes then edges), `resolveParentScope`, `reconcileAdapterGraphFromStore` |
| `src/services/graph-db/graph-owner.ts` | `attachGraphDb` / `getGraphDb` — the graph belongs to the store, not the process |
| `src/services/graph-db/graph-database.service.ts` | `upsertAdapterFromFrontmatter`, `writeInheritanceEdges`, `clearInheritanceEdges`, `getChildren` |
| `src/services/graph-db/index.ts` | Re-exports for the inheritance module |
| `src/services/memory/stored-adapter-frontmatter.ts` | Persists `inherits` / `override` / `chain_root` on the stored `adapter` payload |
| `src/tools/train-store.ts` | `assertInheritanceFrontmatterValid`, `projectStoredAdapter` |
| `src/tools/tune-execute.ts` | `assertTuneInheritanceValid`, `projectTunedAdapter` |
| `src/utils/frontmatter.ts` | Extended with `inherits` and `overrideRaw` fields |

The test files, and what each one covers, are code-derivable and are not restated here.
The verified-by evidence for this touchpoint is the **Verify** section of
[ADR 0043](../adr/0043-additive-selective-inheritance-and-inheritance-checkpoints.md)
(and of [ADR 0042](../adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md));
this spec describes the design, not a test result.
