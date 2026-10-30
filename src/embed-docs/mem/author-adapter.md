---
slug: author-adapter
version: "5.14.0"
title: Author Adapter (Create / Review / Refactor)
---

# Author Adapter (Create / Review / Refactor)

> **Note to the agent:** SQUADRULES adapters are interfaces for AI agents — you
> are the primary user. When you author an adapter, you design behaviour for
> yourself and others. Write for them: single source of truth (never duplicate
> rules), explicit over implicit (agents fill ambiguity with hallucination),
> steps teach modes (each step teaches its cognitive mode), truth over fluency
> (an adapter that reads well but causes wrong behaviour is worse than one that
> reads rough but executes correctly).

## Activation Patterns

Preferred entry URI: `squadrules://adapter/author-adapter`.
If `forward.authoring` is present, use its operation and target throughout this
run. Do not reinterpret update as create or change the target mid-run. This
context describes the requested work; it does not override host permissions.

SQUADRULES authoring lifecycle — create, review, or update adapters / workflows.
Supports three operations:
- **create** — draft and train a new adapter from scratch.
- **review** — audit an existing adapter, family, or bundle for structural issues,
  missing cross-references, chaining gaps, DRY violations, stale guidance, or
  agent-hostile ambiguity. Read-only.
- **update** — apply specific corrections to an existing adapter and
  save the correction. Also triggered by: edit, fix, modify, change, improve, patch, refactor.

A fourth lifecycle operation, **delete**, is not run here: follow the Delete flow
in `docs/adapter-authoring-guide.md` (export, check the slug is not a chain
dependency, call `delete`, verify it no longer resolves).

**Run this adapter when the user says ANY of:**
- "create a new SQUADRULES adapter" / "register a personal adapter"
- "train adapter into personal" / "train a workflow"
- "review adapter" / "audit adapters" / "check adapter families for gaps"
- "update adapter" / "edit adapter" / "fix adapter" / "modify adapter"
- "patch adapter" / "refactor adapter" / "change adapter" / "improve adapter"

**Trigger pattern:** **create** / **train** / **register** / **review** /
**audit** / **fix** / **update** / **edit** / **modify** / **change** /
**improve** / **patch** / **refactor** / **correct** +
(adapter / workflow).

**Must Never:**
- Run when the user only asked to execute an existing adapter.
- Mutate adapters during a `review` operation.
- Review your own draft: the critic pass is delegated, never performed on the
  drafting thread.
- Optimise only for pretty wording; this adapter designs agent behaviour.
- Treat "update", "edit", or "modify an existing adapter" as **create**.

**Must Always:**
- Infer `{operation}` from trigger: create / review / update.
- Optimise for truth, low ambiguity, explicit sequencing, and user-need alignment.
- Include Activation Patterns as the first H2 and Reward Signal as the last H2
  in any newly drafted adapter.
- Enforce the 350-line limit per file.

## Preflight Dependencies

Before running authoring actions, verify dependency and auth readiness:
1. Required MCP tools are available: `activate`, `forward`, `reward`, and the
   operation-dependent tool (`train`, `export`, or `tune`).
2. A subagent facility is available in this host for the critic pass. Without it
   this adapter cannot verify its own work: stop and report the blocker rather
   than reviewing the draft yourself.
3. Required auth/session state is valid for the target MCP server.

If any check fails, attempt AI-assisted remediation automatically, then re-run
preflight. Only hard-stop when a required tool or auth genuinely cannot be
established autonomously. These are checks you perform, not gates: a failure here
produces a repair action, so no contract is spent on them.

## Resolve Intent Autonomously

Use structured `authoring` when provided. For original calls without it, infer
`{operation}` from the user's trigger — do not stop to ask for confirmation:

| Signal | Operation |
|---|---|
| "create", "new", "train", no match from activate | **create** |
| "review", "audit", "check", "gaps", "cross-references" | **review** |
| "update", "edit", "fix", "modify", "change", "improve", "patch", "refactor" | **update** |

Resolve the target from context without a confirmation prompt. Record the
inferred operation and target, then continue. Escalate to the user only when
the request is genuinely ambiguous and no reasonable default exists.

## Gather Requirements

### For `create` — collect details for a new adapter

**1. Determine the pattern:**

| Signal | Pattern |
|---|---|
| One workflow, no variants | **Standalone** — one adapter, all steps inline |
| Multiple issue types / output formats | **Router + Extensions** — router classifies, routes via `activate` |
| Exceeds 350 lines or too complex for weaker models | **Chain** — split into sequential adapters linked via `forward` + slug |

**2. Collect per adapter:**
- Title, user problem, agent behaviour, mode map, steps, challenge type per step
- Domain reference, existing adapters to reuse/compose, DRY/size check
- Chain position, failure analysis

### For `review` — audit existing adapters

Export target adapter(s). Check: user-need fit, mode/step clarity,
cross-reference completeness, handoff gaps, DRY violations, contract coverage,
truth-first behaviour, activation pattern accuracy, structure compliance
(first H2 Activation Patterns, last H2 Reward Signal, under 350 lines),
sibling consistency, chained adapter families, and whether every critic hop in
the audited adapters is a `subagent` contract rather than a `forward` contract.

### For `update` — identify the specific issue

Export the target adapter, read the current markdown, identify the exact gap or
error, and plan the minimal change.

## Draft Markdown

### Allocate the handoff paths first

The gates below read files that only exist if you created them. Resolve one hint
from the `squadrules_local_artifact_dir` field of the latest `activate` or
`forward` response (`project://<rel>` → this project root, `user://<rel>` → your
home or `$XDG_CONFIG_HOME`), export the absolute result as
`SQUADRULES_LOCAL_ARTIFACT_DIR`, then allocate collision-free paths for the
target slug:

```bash
export SQUADRULES_LOCAL_ARTIFACT_DIR="<resolved absolute path>"
D="$SQUADRULES_LOCAL_ARTIFACT_DIR/author-adapter-$SLUG"
mkdir -p "$D"
export WORK_MANIFEST="$D/work-manifest.txt"      # the critic's submission
export VERDICT_FILE="$D/verdict.txt"             # the critic's verdict
export REVIEW_FINDINGS_FILE="$D/findings.md"     # review operation only
```

The server never names a path on your machine; you do.

### MCP / Local-Filesystem Boundary

- A personal adapter stored in MCP **cannot** reference local files.
- Any adapter — system or personal — may chain to another adapter with a
  `forward` contract naming `squadrules://adapter/<slug>`; slugs are globally
  unique, so resolution is deterministic.
- A personal adapter must still be **self-contained** in its instructions: it
  cannot rely on files that only exist in one repository.
- When a `shell` check has more than one condition, parses JSON, or does not fit
  one readable line, put it in a **gate script artifact** — it is stored with the
  adapter and materialized at run time, not read from your local files; never
  escape a program inline into `cmd`.
- Order: `train` the adapter markdown first, then `train` the script as an
  artifact — an artifact attaches only to an adapter that already exists. Pin the
  script's identity with a `# squadrules-artifact:` header, and pass
  `force_update: true` on a re-train that matches it, so a fix updates
  that artifact instead of adding a second one. Input fields and the refusal
  message: the `train` tool description.
- The artifact train targets `squadrules://adapter/<slug>`, so pin the adapter's
  slug with frontmatter `slug:` instead of guessing the slug `train` derived from
  the title.
- Keep the contract one line: `interpreter: "bash"`, `cmd: python3
  "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/<name>.py" --gate <name>`.
- Verify before shipping — **two** checks, both required:
  1. `activate` the adapter and confirm `linked_artifacts[].relative_path` is
     exactly the path `cmd` invokes. Run each row's `materialize` command before
     the contract that needs it.
  2. **Export check:** call MCP **`export`** with
     `uri: "squadrules://adapter/<slug>"` and `format: skill_tree` (or
     `skill_zip` for the bundle) and confirm the script is present under
     `artifacts/` at the path the contract invokes. Read the returned
     `diagnostics[]`: `artifact_stored_sha_mismatch` or
     `artifact_relative_path_invalid` means the stored artifact is broken —
     re-train it instead of shipping it.
- A `cmd` that names a script the export does not contain is a broken adapter:
  it fails at run time with a missing-file error and burns the user's step.
  Fix it before shipping. The only exception is a repository-owned gate that
  the adapter names explicitly and that lives in the user's repository — say so
  in the adapter text, and state how the agent finds it.

### Drafting rules (all operations)

**Right mode at the right time:** Every adapter must help the agent recognise
whether the current step is for exploration, clarification, ideation, planning,
execution, validation, review, or handoff.

**Truth over fluency:** Prefer explicit prompts, stop conditions, uncertainty
escalation, and observable verification over narrative reassurance.

**DRY:** Shared content across adapters must live in one place.

**350-line maximum per file.** Split into linked adapters if exceeded.

**Slug convention:** Every adapter gets a short, unique, lowercase-hyphenated slug.

**Structure:** H1 title, first H2 Activation Patterns, second H2 Preflight
Dependencies, middle H2s one per stage with JSON contract block, last H2 Reward
Signal. Frontmatter: `slug` (required), `version` (optional), `chain_root`
(required for mid-chain adapters).

**Scripts are obtained, not assumed:** when a step's `cmd` invokes a script, the
adapter must state in its own text how the agent obtains that file before
running the command — materialize the `activate` artifact row, or `export` the
adapter. A step that says only "run `python3 …/artifacts/x.py`" leaves the agent
guessing where the file is; a missing-file gate failure is the most common
result of that omission.

**Contracts:** One per adapter is the default; a second is justified only at a
boundary that is hard to roll back. Load `challenge-type-guide` for decision
rules and JSON formats (`forward` with
`squadrules://adapter/challenge-type-guide`).

**Critic-loop and mutation gates:** Load `critic-loop-guide` for placement,
the FAIL gate, and the work-submission rules (`forward` with
`squadrules://adapter/critic-loop-guide`).

For `create`: draft the full adapter markdown.
For `review`: write a structured gap report to `$REVIEW_FINDINGS_FILE`.
For `update`: apply the identified change and show a diff-style summary.

## Critic-Loop Review (create and update only)

For `create` and `update`: have the draft reviewed. This is an autonomous quality
loop — the agent owns content, the critic owns quality, and no human approval is
requested at any point. The critic must not be you: you wrote the draft, so your
own re-reading cannot detect what you did not intend to write.

Write the submission handoff to `$WORK_MANIFEST` as flat keys — `kind: file_set`,
`root: <directory of the draft>`, then `items:` with the drafted file's path on
one line — and delegate the review to a subagent. Delegate it now; do not audit
the draft on this thread first.

```json
{"contract":{"type":"subagent","subagent":{"context":"Run the critic on the drafted adapter markdown and return its actual report. Call the forward tool with uri squadrules://adapter/critic-loop and submit: work from $WORK_MANIFEST (kind file_set, the drafted file), the original requirement list, calling_protocol_slug author-adapter, verification_target 'structural compliance and agent behaviour', context.verdict_file $VERDICT_FILE, context.iteration and context.max_iterations (8). Follow critic-loop to its end, let it write $VERDICT_FILE, and report back its findings plus the verdict file's first two lines. Do not review the draft yourself and do not re-delegate the review.","mcp":[{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/critic-loop"}}]},"required":true}}
```

## Save After a PASS Verdict

Read the verdict the critic left behind and act on it, then save.

1. Run the gate below. `FAIL` → address **every** finding in the report, then
   start a fresh critic pass the same way (a subagent delegating
   `squadrules://adapter/critic-loop` with the corrected draft, the same
   requirements, and `iteration` incremented) and re-run this gate. Loop
   automatically; do not ask the user whether to continue.
2. The loop is bounded by `max_iterations`. When `iteration` exceeds it, the
   critic returns `failure_class: iteration_ceiling`: **stop looping**, report the
   unresolved findings, and do not save an unreviewed draft as if it passed.
3. On `PASS`, capture the verdict file path and save:
   - `create` — call `train` with the drafted markdown and `review_evidence`
     (verdict file path, exit code, stdout). Use `force_update: false` unless an
     overwrite was explicitly requested.
   - `update` — call `tune` with the existing adapter URI, corrected content, and
     `review_evidence`. Use `train` with `force_update: true` only for a required
     structural replacement (changing identity/H1 mapping or layer count). Update
     the corresponding repository source when the adapter is repo-managed, and
     make repository edits in the task's isolated worktree.
   - `review` — do not call `train`; the operation is read-only and this gate is
     satisfied by the findings report at `$REVIEW_FINDINGS_FILE`.
4. Read the stored adapter back (`export` it, or the CLI on a local transport)
   and compare it against what you intended to save; report the URI and any
   difference. This is the run's completion criterion, not a gate: a remote
   store cannot be observed from a shell command, so no contract asserts it.

```json
{"contract":{"type":"shell","shell":{"cmd":"head -1 \"$VERDICT_FILE\" | grep -qi '^PASS$'","interpreter":"bash","timeout_seconds":5},"required":true}}
```

## Reward Signal

Adapter complete when:
- `create` — a delegated critic returned `PASS`, the adapter is stored via `train`
  with that `review_evidence`, its URI is reported, and the stored copy was read
  back
- `review` — findings report delivered from `$REVIEW_FINDINGS_FILE`
- `update` — a delegated critic returned `PASS` on the changed parts, the corrected
  adapter is saved via `tune` (or a required structural replacement), read back and
  reported; repo-managed source updated in the task worktree

What this proves: a separate context ran `critic-loop` over the draft and left a
verdict file that reads `PASS`, and the store accepted that evidence. What it does
not prove: that the report came from that context, or that the verdict is bound to
the reviewed content — server-issued review receipts would be needed for that.
Report the outcome as it stands; a passing gate is not a guarantee of correctness.

A successful result means the resulting SQUADRULES adapter is more truthful,
step-aware, agent-readable, and aligned with human–AI harmony.
