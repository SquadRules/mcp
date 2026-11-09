# Train/Tune Graph Writes (Touchpoint 3)

This document specifies how `train` and `tune` interact with the embedded graph database
when persisting adapters with inheritance frontmatter.

**Companion specs:**

- `docs/specs/graph-schema.md` — node/edge shapes and property types (§ 5: frontmatter→graph mapping)
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

## 2. Graceful-Degradation Graph Write

After the memory-store write succeeds, the tool attempts a graph DB write:

1. `getGraphDbService()` returns `null` → skip silently (graph not booted or disabled).
2. `writeAdapterFromFrontmatter(slug, version, frontmatter, opts)` is called inside try/catch.
3. On failure: log a warning via `structuredLogger.warn(...)`, **do not propagate**.

The memory write is the source of truth. The graph is a derived index that can be
rebuilt. Adapter persistence must never fail because of graph unavailability.

### Graph write semantics

`writeAdapterFromFrontmatter` performs:

1. **Upsert Adapter node** — create if absent, update properties if present.
2. **If `inherits` is set and parent node exists in graph:**
   - Remove any existing `Inherits`/`SpecializedBy` edges for this child (idempotent re-train).
   - Create `Inherits` edge (child → parent) with `override_fields`.
   - Create reciprocal `SpecializedBy` edge (parent → child).
3. **If parent node does not exist:** skip edge creation (the `parent_missing` warning
   was already emitted during validation).

---

## 3. Hook Points

| Tool | File | Hook location |
|------|------|---------------|
| `train` | `src/tools/train-store.ts` | After `validateProtocolStructure`, before `memoryStore.storeAdapter` (validation); after `storeAdapter` returns (graph write) |
| `tune` | `src/tools/tune-execute.ts` | In `tuneAdapterMarkdownInPlace`, before layer update loop (validation); after `verifyTuneLayerPersistence` (graph write) |

Artifact trains (`mime != text/markdown`) do not trigger inheritance validation or graph
writes — artifacts have no frontmatter.

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
| `src/services/graph-db/graph-database.service.ts` | `upsertAdapterNode`, `writeAdapterFromFrontmatter`, `removeInheritanceEdges` |
| `src/services/graph-db/index.ts` | Re-exports for the inheritance module |
| `src/tools/train-store.ts` | `assertInheritanceFrontmatterValid`, `tryGraphWrite` hooks |
| `src/tools/tune-execute.ts` | `assertTuneInheritanceValid`, `tryGraphWriteForTune` hooks |
| `src/utils/frontmatter.ts` | Extended with `inherits` and `overrideRaw` fields |
| `tests/unit/graph-db-train-integration.test.ts` | 31 tests covering all validators and integration |
