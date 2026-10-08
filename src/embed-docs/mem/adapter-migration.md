---
version: "5.2.0"
slug: adapter-migration
title: Adapter Migration Protocol
---

# Adapter Migration Protocol

Batch-migrate all adapters in a space to the current structural scheme. Exports
every adapter, applies conservative structural transformations, reports changes
per adapter, and re-trains only after user approval.

This protocol handles structural migrations only — it preserves semantic content
(steps, intent, examples) while updating format, headings, and contract shapes
to match the latest SQUADRULES requirements.

## Activation Patterns

**Run this protocol when the user says ANY of:**

- "migrate all adapters" / "batch update adapters"
- "update adapters to latest scheme" / "update adapter structure"
- "run structural migration" / "migrate protocols"
- "update all my adapters" / "fix adapter structure"
- "apply latest adapter format" / "restructure adapters"
- "run adapter migration" / "migrate to new format"

**Trigger pattern:** **migrate** / **batch update** / **structural migration** /
**update format** + (adapters | protocols | all | space).

**Must Never:**
- Alter semantic content (step text, trigger phrases, examples, intent).
- Auto-train without showing the user a change report first.
- Guess transformations when the adapter structure is ambiguous.
- Delete adapters or layers during migration.
- Migrate adapters that already conform (report them as "no changes needed").

**Must Always:**
- Export every adapter before making any changes.
- Apply only conservative, reversible structural transformations.
- Flag ambiguous cases for manual review instead of guessing.
- Show a per-adapter change report before executing any writes.
- Preserve the adapter's slug, version, and chain_root fields.

**Good trigger examples:**
- "migrate all my personal adapters to the latest format" → run this protocol
- "update all adapters in the team space" → run this protocol
- "we changed the solution scheme, update all adapters" → run this protocol

**Bad trigger examples:**
- "update this one adapter" → use `create-new-protocol` with `fix` operation
- "create a new adapter" → use `create-new-protocol`
- "export my adapters" → use `export` directly

## Preflight Dependencies

Before running migration, verify readiness:

1. `export` tool is available and callable.
2. `tune` and `train` tools are available for writes.
3. Target space is identified (personal or a named group space).
4. User understands this is a structural-only migration.

If any tool is unavailable, stop and ask the user to fix the connection.

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```

## Export All Adapters

Export every adapter from the target space using bulk export:

1. Call `export` with `all_adapters: true`, `space_name` set to the target
   space, and `format: skill_tree`.
2. Record the total adapter count from the response.
3. For each adapter in the response, extract its slug, URI, and content.

If the space has no adapters, report this and stop.

```json
{"contract":{"type":"mcp","mcp":{"tool_name":"export","arguments":{"all_adapters":true,"space_name":"<space>","format":"skill_tree"}},"required":true}}
```

## Analyze and Transform

For each exported adapter, perform structural analysis and apply migrations.

### Structural checks (apply all that are needed)

1. **Heading order** — first H2 must be `Activation Patterns`, last H2 must be
   `Reward Signal`. If missing or out of order, flag for restructuring.
2. **Contract fences** — all contract JSON blocks must use ` ```json ` (not
   plain ` ``` `). If plain fences contain contract JSON, convert them.
3. **Field rename** — any `"challenge":` key inside contract JSON blocks must
   become `"contract":`. Apply globally within JSON fences.
4. **Frontmatter** — must include `slug`. Add `version` if missing. Preserve
   existing `chain_root` when present.
5. **Line count** — adapters exceeding 350 lines must be flagged for splitting
   (do NOT auto-split; report as manual review needed).
6. **Phase-critic integration** — check whether the adapter includes at least
   one `phase-critic` chain link. If not, add a recommendation (do NOT
   auto-add; report as suggestion).

### Transformation rules

- **Conservative only:** If a transformation might change meaning, skip it and
  flag for manual review.
- **Reversible:** Every change must be expressible as a diff so the user can
  reject individual changes.
- **Idempotent:** Running migration twice on the same adapter produces no
  additional changes.

For each adapter, produce:
- `status`: `needs_changes` | `up_to_date` | `needs_manual_review`
- `changes`: list of specific transformations applied
- `warnings`: list of items flagged for manual review
- `transformed_content`: the full updated markdown (when `needs_changes`)

```json
{"contract":{"type":"comment","comment":{"min_length":120},"required":true}}
```

## Report Changes

Present a summary table to the user:

| Adapter slug | Status | Changes | Warnings |
|-------------|--------|---------|----------|
| example-adapter | needs_changes | 3 structural fixes | 0 |
| another-adapter | up_to_date | 0 | 0 |
| complex-adapter | needs_manual_review | 1 fix | line count exceeds 350 |

For each adapter with `needs_changes`, show the specific transformations:
- What was changed (before/after for the affected lines).
- Why (which structural rule it satisfies).

For each adapter with `needs_manual_review`, explain what needs human
attention and why the protocol cannot auto-fix it.

Ask the user to choose:
- **Apply all** — train all `needs_changes` adapters.
- **Select individually** — choose which adapters to update.
- **Abort** — cancel the migration without changes.

```json
{"contract":{"type":"user_input","user_input":{"prompt":"Review the migration report above. Choose: apply all, select individually, or abort."},"required":true}}
```

## Execute Migration

For each approved adapter, apply the structural changes:

1. For adapters needing only content-level fixes (heading reorder, fence
   conversion, field rename): use `tune` with the transformed content and
   the adapter's URI.
2. For adapters needing structural changes that alter layer count or identity:
   use `train` with `force_update: true` and the transformed content.
3. Record the outcome (success or failure) for each adapter.

Do NOT change the adapter's space assignment during migration.

```json
{"contract":{"type":"comment","comment":{"min_length":120},"required":true}}
```

## Verify and Report

After executing all approved migrations:

1. Re-export each migrated adapter to verify structural compliance.
2. Report final status:

| Metric | Count |
|--------|-------|
| Adapters scanned | N |
| Already up to date | N |
| Successfully migrated | N |
| Migration failed | N |
| Flagged for manual review | N |

3. For each failure, report the error message and suggested fix.
4. Recommend running `phase-critic` on migrated adapters to verify semantic
   integrity after structural changes.

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

The adapter library in the target space now conforms to the current structural
scheme. Every adapter has:
- Correct heading order (Activation Patterns first, Reward Signal last).
- Proper ` ```json ` contract fences.
- Current field names (`contract`, not `challenge`).
- Valid frontmatter with `slug` and optional `version`.
- Been verified post-migration for structural compliance.

Semantic content (steps, intent, examples, triggers) is preserved unchanged.
