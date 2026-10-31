---
version: "5.14.2"
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
- Review the transformed set yourself: a batch overwrite written by your own hand
  is not checked by re-reading your own hand.

**Must Always:**
- Export every adapter before making any changes.
- Apply only conservative, reversible structural transformations.
- Flag ambiguous cases for manual review instead of guessing.
- Produce a per-adapter change report before executing any writes.
- Have the transformed set reviewed by a delegated critic before the batch write.
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
3. A subagent facility is available in this host for the review hop. Without it,
   stop and report the blocker rather than approving your own batch.
4. Target space is identified (personal or a named group space).
5. The migration is structural-only (no semantic changes).

If any tool is unavailable, stop and report the connection blocker with
remediation guidance. These are checks you perform, not gates: a failure produces
a repair action, so no contract is spent on them.

## Export All Adapters

Export every adapter from the target space using bulk export:

1. Call `export` with `all_adapters: true`, `space_name` set to the target
   space, and `format: skill_tree`.
2. Record the total adapter count from the response.
3. For each adapter in the response, extract its slug, URI, and content.

If the space has no adapters, report this and stop.

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
7. **Critic hop** — a `forward` contract whose target is
   `squadrules://adapter/critic-loop` is the deprecated self-review shape: it
   runs the critic on the thread that produced the work. Flag it for manual
   review; converting a review hop into a delegated one changes verification
   semantics and is not a conservative transformation.

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

## Report Changes

Write the migration report to `$MIGRATION_REPORT_FILE` — an absolute path you
allocate under `$SQUADRULES_LOCAL_ARTIFACT_DIR` (resolve a hint from the
`squadrules_local_artifact_dir` field of the latest `activate`/`forward` response
and export it; the server never names a path on your machine). Also allocate
`$WORK_MANIFEST` and `$VERDICT_FILE` in the same directory. Record the
transformed drafts as files under one root and write the handoff to
`$WORK_MANIFEST` as flat keys: `kind: file_set`, `root: <that directory>`, then
`items:` with one draft path per line.

Record a summary table in the report:

| Adapter slug | Status | Changes | Warnings |
|-------------|--------|---------|----------|
| example-adapter | needs_changes | 3 structural fixes | 0 |
| another-adapter | up_to_date | 0 | 0 |

For each adapter with `needs_changes`, show the specific transformations.
For each `needs_manual_review`, explain what needs human attention.

A report on your own scratch is a local, reversible artifact, so it carries no
gate. What is gated is the batch write it precedes.

## Review the Transformed Set

Delegate the review of every transformed draft before anything is written:

```json
{"contract":{"type":"subagent","subagent":{"context":"Run the critic over the transformed adapter drafts and return its actual report. Call the forward tool with uri squadrules://adapter/critic-loop, submit work from $WORK_MANIFEST (kind file_set, the transformed drafts), calling_protocol_slug adapter-migration, verification_target 'structural migration preserved semantics and did not over-reach', the requirement list of structural checks, and context.verdict_file $VERDICT_FILE with context.iteration and context.max_iterations (8). Do not review the drafts yourself and do not re-delegate the review.","mcp":[{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/critic-loop"}}]},"required":true}}
```

## Apply, Verify, and Report

1. Run the gate at the end of this section against `$VERDICT_FILE` **before** any
   write. `FAIL` → fix the drafts the critic named, run a fresh critic pass the
   same way (a subagent delegating `squadrules://adapter/critic-loop`,
   `iteration` incremented) and run the gate again. Loop automatically; do not ask
   the user whether to continue. At `failure_class: iteration_ceiling`, stop,
   report the unresolved findings, and write nothing.
2. Apply the migration only on a `PASS` verdict:
   - **Apply all** `needs_changes` adapters.
   - **Leave untouched** every `needs_manual_review` adapter.
   - For content-level fixes (heading order, fence conversion, interpreter
     addition): use `tune` with the transformed content, its URI, and
     `review_evidence` from the verdict file.
   - For changes that alter layer count or identity: use `train` with
     `force_update: true` and the same `review_evidence`.
   - Do NOT change an adapter's space assignment during migration.
3. After all writes, re-export each migrated adapter to verify structural
   compliance, then report final status:

| Metric | Count |
|--------|-------|
| Adapters scanned | N |
| Already up to date | N |
| Successfully migrated | N |
| Migration failed | N |
| Flagged for manual review | N |

For each failure, report the error message and suggested fix. Semantic integrity
was reviewed before the write; do not present a post-write structural re-export
as if it re-checked meaning.

```json
{"contract":{"type":"shell","shell":{"cmd":"head -1 \"$VERDICT_FILE\" | grep -qi '^PASS$'","interpreter":"bash","timeout_seconds":5},"required":true}}
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

What the verdict gate proves: a delegated critic pass over the transformed drafts
left a verdict file reading `PASS`, and the store accepted the writes carrying
that evidence. What it does not prove: that the report came from the delegated
context rather than this one, or that the verdict is bound to the drafts it
reviewed — a content-bound review receipt would be needed for that.
