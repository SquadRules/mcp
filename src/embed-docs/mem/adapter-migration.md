---
version: "5.12.1"
slug: adapter-migration
title: Adapter Migration Workflow
---

# Adapter Migration Workflow

Batch-migrate all adapters in a space to the current structural scheme. Exports
every adapter, applies conservative structural transformations, reports changes
per adapter, and re-trains the conforming subset autonomously.

This workflow handles structural migrations only — it preserves semantic content
(steps, intent, examples) while updating format, headings, and contract shapes
to match the latest SQUADRULES requirements.

## Activation Patterns

**Run this workflow when the user says ANY of:**

- "migrate all adapters" / "batch update adapters"
- "update adapters to latest scheme" / "update adapter structure"
- "run structural migration" / "migrate adapters"
- "update all my adapters" / "fix adapter structure"
- "apply latest adapter format" / "restructure adapters"

**Trigger pattern:** **migrate** / **batch update** / **structural migration** /
**update format** + (adapters | all | space).

**Must Never:**
- Alter semantic content (step text, trigger phrases, examples, intent).
- Auto-train an adapter without first producing a per-adapter change report.
- Guess transformations when the adapter structure is ambiguous.
- Delete adapters or layers during migration.
- Migrate adapters that already conform (report them as "no changes needed").

**Must Always:**
- Export every adapter before making any changes.
- Apply only conservative, reversible structural transformations.
- Flag ambiguous cases for manual review instead of guessing.
- Produce a per-adapter change report before executing any writes.
- Preserve the adapter's slug, version, and chain_root fields.

**Good trigger examples:**
- "migrate all my personal adapters to the latest format" → run this workflow
- "update all adapters in the team space" → run this workflow

**Bad trigger examples:**
- "update this one adapter" → use `author-adapter` with `fix` operation
- "create a new adapter" → use `author-adapter`
- "export my adapters" → use `export` directly

## Preflight Dependencies

Before running migration, verify readiness:

1. `export` tool is available and callable.
2. `tune` and `train` tools are available for writes.
3. Target space is identified (personal or a named group space).
4. The migration is structural-only (no semantic changes).

If any tool is unavailable, stop and report the connection blocker with
remediation guidance.

```json
{"contract":{"type":"shell","shell":{"cmd":"echo 'preflight: migration tools verified'","interpreter":"bash","timeout_seconds":10},"required":true}}
```

## Export All Adapters

Export every adapter from the target space using bulk export:

1. Call `export` with `all_adapters: true`, `space_name` set to the target
   space, and `format: skill_tree`.
2. Record the total adapter count from the response.
3. For each adapter in the response, extract its slug, URI, and content.

If the space has no adapters, report this and stop.

```json
{"contract":{"type":"subagent","subagent":{"context":"Export all adapters from the target space using the export tool with all_adapters: true. Record the total count and extract slug, URI, and content for each adapter."},"required":true}}
```

## Analyze and Transform

For each exported adapter, perform structural analysis and apply migrations.

### Structural checks (apply all that are needed)

1. **Heading order** — first H2 must be `Activation Patterns`, last H2 must be
   `Reward Signal`. If missing or out of order, flag for restructuring.
2. **Contract fences** — all contract JSON blocks must use ` ```json ` (not
   plain ` ``` `). If plain fences contain contract JSON, convert them.
3. **Frontmatter** — must include `slug`. Add `version` if missing. Preserve
   existing `chain_root` when present.
4. **Line count** — adapters exceeding 350 lines must be flagged for splitting
   (do NOT auto-split; report as manual review needed).
5. **Shell interpreter** — every shell contract must include `"interpreter"`
   field with an allowed value (`bash`, `sh`, `python3`, `python`, `node`).
6. **Forward link** — every `forward` contract must set `forward.target`
   matching `squadrules://adapter/<slug>`.

### Transformation rules

- **Conservative only:** If a transformation might change meaning, skip it and
  flag for manual review.
- **Reversible:** Every change must be expressible as a diff.
- **Idempotent:** Running migration twice produces no additional changes.

For each adapter, produce:
- `status`: `needs_changes` | `up_to_date` | `needs_manual_review`
- `changes`: list of specific transformations applied
- `warnings`: list of items flagged for manual review
- `transformed_content`: the full updated markdown (when `needs_changes`)

```json
{"contract":{"type":"subagent","subagent":{"context":"Analyze each exported adapter against structural checks (heading order, contract fences, frontmatter, line count, shell interpreter, forward link). Apply conservative transformations and produce per-adapter status, changes, warnings, and transformed content."},"required":true}}
```

## Report Changes

Write the migration report to `$MIGRATION_REPORT_FILE` (absolute path under
`$SQUADRULES_LOCAL_ARTIFACT_DIR`). Record a summary table:

| Adapter slug | Status | Changes | Warnings |
|-------------|--------|---------|----------|
| example-adapter | needs_changes | 3 structural fixes | 0 |
| another-adapter | up_to_date | 0 | 0 |

For each adapter with `needs_changes`, show the specific transformations.
For each `needs_manual_review`, explain what needs human attention.

Apply the migration autonomously:
- **Apply all** `needs_changes` adapters.
- **Leave untouched** every `needs_manual_review` adapter.

```json
{"contract":{"type":"shell","shell":{"cmd":"test -f \"$MIGRATION_REPORT_FILE\" && grep -c '|' \"$MIGRATION_REPORT_FILE\" | test $(cat) -gt 1","interpreter":"bash","timeout_seconds":10},"required":true}}
```

## Execute Migration

For each `needs_changes` adapter, apply the structural changes:

1. For adapters needing only content-level fixes (heading reorder, fence
   conversion, interpreter addition): use `tune` with the transformed content
   and the adapter's URI.
2. For adapters needing structural changes that alter layer count or identity:
   use `train` with `force_update: true` and the transformed content.
3. Record the outcome (success or failure) for each adapter.

Do NOT change the adapter's space assignment during migration.

```json
{"contract":{"type":"subagent","subagent":{"context":"Execute the migration: for each needs_changes adapter, call tune (content-level fixes) or train with force_update (structural changes). Record success/failure per adapter."},"required":true}}
```

## Verify and Report

After executing all migrations:

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
4. Recommend running `critic-loop` on migrated adapters to verify semantic
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
- Shell contracts with `interpreter` field.
- Forward contracts with a `forward.target` adapter URI.
- Valid frontmatter with `slug` and optional `version`.
- Been verified post-migration for structural compliance.

Semantic content (steps, intent, examples, triggers) is preserved unchanged.
