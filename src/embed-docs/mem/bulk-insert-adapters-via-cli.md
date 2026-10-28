---
slug: bulk-insert-adapters-via-cli
version: "5.13.8"
title: Bulk Insert Adapters via SQUADRULES CLI
---

# Bulk Insert Adapters via SQUADRULES CLI

## Activation Patterns

Batch-register multiple SQUADRULES adapters from a local directory tree using the
`squadrules train` CLI. Handles directory scanning, validation, space targeting,
and error recovery for bulk operations.

**Run this workflow when the user says ANY of:**

- "bulk insert adapters" / "bulk train adapters"
- "train all adapters in a directory"
- "batch register adapters from folder"
- "upload all .md files to SQUADRULES"
- "sync local adapters to SQUADRULES" / "push adapters to SQUADRULES"
- "train directory recursively" / "train --recursive"

**Trigger pattern:** **bulk** / **batch** / **all** / **directory** / **recursive** +
(train | insert | register | upload | push | sync) + (adapters | workflows).

**Must Never:**

- Train files without first validating their structure.
- Overwrite existing adapters without explicit `--force`.
- Train files that contain secrets or token-like strings without
  `--allow-sensitive-upload`.
- Skip reporting partial failures in a batch.

**Must Always:**

- Verify the target directory exists and contains `.md` files.
- Show the file list and target space before executing.
- Report per-file success/failure after the batch completes.
- Respect the user's choice of space (personal or group).

**Good trigger examples:**

- "Train all adapters in my-adapters/" → run this workflow
- "Bulk insert the adapters from my export folder" → run this workflow
- "Push all .md files in this directory to my personal space" → run this workflow

**Bad trigger examples:**

- "Train this one adapter" → use `squadrules train <file>` directly
- "Create a new adapter" → use `author-adapter`
- "Export my adapters" → use `squadrules export`

## Preflight Dependencies

Verify before execution:

1. `squadrules` CLI is installed and callable (`squadrules --version`).
2. Authentication is valid (`squadrules token` returns a token without error).
3. Target directory path exists and contains at least one `.md` file.
4. If a space is specified, confirm it exists via `squadrules spaces`.
5. A subagent facility is available for the review hop below. Without it the
   store will refuse the upload; report the blocker, do not skip the review.

If any check fails, stop and report the issue with remediation guidance. These
checks are performed, not gated — the gate sits at the write.

## Resolve Scope and Validate

Resolve the batch operation details autonomously:

1. **Source directory** — absolute path.
2. **File count** — number of `.md` files found (recursive or flat).
3. **Target space** — personal (default) or a named group space.
4. **Force mode** — whether `--force` will be used (overwrites existing).

Validate each `.md` file against SQUADRULES adapter requirements:
- Has an H1 title.
- First H2 is "Activation Patterns".
- Last H2 is "Reward Signal".
- Contains at least one fenced `json` block with a top-level `contract` object.
- Does not exceed 350 lines.

Skip invalid files, train the valid subset, and document every skipped file with
its validation error and a suggested fix. Do not stop to ask the user.

## Review the Set Before Uploading

`train` refuses a markdown adapter without critic-loop `PASS` evidence, so an
unreviewed batch uploads nothing. Allocate the handoff paths under
`$SQUADRULES_LOCAL_ARTIFACT_DIR` — resolve a hint from the
`squadrules_local_artifact_dir` field of the latest `activate`/`forward` response
and export it; the server never names a path on your machine. You need
`$WORK_MANIFEST`, `$VERDICT_FILE`, and `$BULK_LOG_FILE`. List the valid files in
`$WORK_MANIFEST` as flat keys (`kind: file_set`, `root: <source directory>`, then
`items:` with one file path per line) and delegate the review:

```json
{"contract":{"type":"subagent","subagent":{"context":"Run the critic over the adapter files listed in $WORK_MANIFEST and return its actual report. Call the forward tool with uri squadrules://adapter/critic-loop, submitting the file list as work kind file_set with the source directory as root, the requirement list above as requirements, and context.verdict_file $VERDICT_FILE with context.iteration and context.max_iterations (8). Do not review the files yourself.","mcp":[{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/critic-loop"}}]},"required":true}}
```

## Prove the Write Boundary

A directory batch overwrites adapters in a shared space: hard to roll back, so
one gate sits in front of it and one behind it. Run the gate below **before** any
`train` command. If it exits non-zero, nothing has been uploaded — fix the named
condition (install the CLI, re-authenticate, correct `$SOURCE_DIR`, or obtain a
`PASS` verdict), then run it again.

```json
{"contract":{"type":"shell","shell":{"cmd":"squadrules --version && squadrules token > /dev/null && test -d \"$SOURCE_DIR\" && find \"$SOURCE_DIR\" -name '*.md' | head -1 | grep -q . && head -1 \"$VERDICT_FILE\" | grep -qi '^PASS$'","interpreter":"bash","timeout_seconds":30},"required":true}}
```

## Run the Batch and Report

Run the batch and keep its report. The CLI reads review evidence from the
`SQUADRULES_REVIEW_EVIDENCE` environment variable as one JSON object
(`verdict_file`, `exit_code`, `stdout`) and reuses it for every file in a
directory batch. Therefore:

- If the critic reviewed the set as one submission, export that verdict once and
  train the directory, capturing its report:

  ```
  squadrules train <directory> --recursive --model <model> --space <space> [--force] 2>&1 | tee "$BULK_LOG_FILE"
  ```

- If the critic reviewed files individually, train file-by-file and re-export
  `SQUADRULES_REVIEW_EVIDENCE` for each file, so no adapter is stored under
  another adapter's verdict; append every run to `$BULK_LOG_FILE`. Move
  non-adapter files (README, reference docs) out of the directory before using
  `--recursive` — the batch skips `README.md` by name and nothing else.

Summarise the outcome for the user:

| Metric | Value |
|--------|-------|
| Files attempted | N |
| Successfully trained | N |
| Failed | N |
| Skipped (invalid) | N |

For each failure, report: file path, error message, suggested fix. If all
succeeded, confirm the adapter URIs are accessible via `squadrules spaces`.
A `REVIEW_EVIDENCE_REQUIRED` failure means the review did not cover that file:
review it, then retry; never store an unreviewed adapter to clear the error.

The batch prints one summary line (`<n> ok, <m> failed (of <total>)`) and one
`ERR <path>: <error>` line per failure. The gate below reads that captured report
instead of trusting a recollection of it, so the write is verified by what the
CLI actually stored:

```json
{"contract":{"type":"shell","shell":{"cmd":"test -s \"$BULK_LOG_FILE\" && grep -qE '[1-9][0-9]* ok, 0 failed' \"$BULK_LOG_FILE\" && ! grep -q 'ERR ' \"$BULK_LOG_FILE\"","interpreter":"bash","timeout_seconds":10},"required":true}}
```

## Reward Signal

Workflow complete when:
- A delegated critic returned `PASS` over the files being uploaded.
- All valid adapter files in the target directory have been trained to the
  specified space, and the captured batch report shows `0 failed`.
- Per-file results have been reported.
- Any failures have been documented with remediation guidance.

What this proves: the store accepted the uploads and the CLI reported no failures
in the captured output. What it does not prove: that the review covered each file
individually when one verdict served a directory batch, or that the verdict came
from the delegated context rather than this one.

A successful bulk insert means the user's local adapter library is now
registered in SQUADRULES and available for activation by AI agents.
