---
slug: author-adapter
version: "5.13.1"
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
2. Required CLI tools for planned shell steps are installed and callable.
3. Required auth/session state is valid for the target MCP server.

If any check fails, attempt AI-assisted remediation automatically, then re-run
preflight. Only hard-stop when a required tool or auth genuinely cannot be
established autonomously.

```json
{"contract":{"type":"shell","shell":{"cmd":"echo 'preflight: ok'","interpreter":"bash","timeout_seconds":10},"required":true}}
```

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

```json
{"contract":{"type":"subagent","subagent":{"context":"Resolve the authoring operation (create/review/update) and target adapter from user context. Record the decision."},"required":true}}
```

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
sibling consistency, chained adapter families, critic-loop integration.

### For `update` — identify the specific issue

Export the target adapter, read the current markdown, identify the exact gap or
error, and plan the minimal change.

```json
{"contract":{"type":"subagent","subagent":{"context":"Gather requirements for the resolved operation: collect pattern/details for create, audit checklist for review, or identify the specific issue for update."},"required":true}}
```

## Draft Markdown

### MCP / Local-Filesystem Boundary

- A personal adapter stored in MCP **cannot** reference local files.
- Only **system adapters** (bundled in the server) can chain to other system
  adapters via `forward`.
- Personal adapters must be **self-contained**.
- When a shell contract needs a reusable script, attach it as an **artifact**
  via `train` (with `mime`, `artifact_name`, `adapter_uri`).

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
Dependencies, middle H2s one per step with JSON contract block, last H2 Reward
Signal. Frontmatter: `slug` (required), `version` (optional), `chain_root`
(required for mid-chain adapters).

**Challenge types:** Load `challenge-type-guide` for decision rules and JSON
formats (`forward` with `squadrules://adapter/challenge-type-guide`).

**Critic-loop and mutation gates:** Load `critic-loop-guide` for placement,
FAIL gate, and solution check rules (`forward` with
`squadrules://adapter/critic-loop-guide`).

For `create`: draft the full adapter markdown.
For `review`: write a structured gap report to `$REVIEW_FINDINGS_FILE`.
For `update`: apply the identified change and show a diff-style summary.

```json
{"contract":{"type":"subagent","subagent":{"context":"Draft the adapter markdown (create), findings report (review), or corrected markdown (update) following all shared drafting rules."},"required":true}}
```

## Critic-Loop Review (create and update only)

For `create` and `update`: run critic-loop against the drafted markdown. This is
an autonomous quality loop — the agent owns content, the critic owns quality, and
no human approval is requested at any point.

1. Invoke critic-loop via `forward` with `squadrules://adapter/critic-loop`.
   Submit the drafted markdown as a `file_set` work submission — write
   `kind: file_set`, `root: <directory of the draft>`, then the drafted file
   under `items:` into the handoff pointed to by `$WORK_MANIFEST` — with the
   slug as `calling_protocol_slug` and "structural compliance and agent
   behaviour" as `verification_target`.
2. Run the FAIL gate shell contract on the verdict file:

```json
{"contract":{"type":"shell","shell":{"cmd":"head -1 \"$VERDICT_FILE\" | grep -qi '^PASS$'","interpreter":"bash","timeout_seconds":5},"required":true}}
```

3. If FAIL: address every finding, then re-invoke critic-loop and re-run the FAIL
   gate. **Loop automatically until the verdict is PASS** — do not proceed and do
   not ask the user whether to continue.
4. If PASS: capture the verdict file path for the `review_evidence` field
   in the `train` call below.

For `review`: skip this step (read-only operation).

## FinaliseOperation

No human approval step. The critic-loop PASS verdict is the sole quality gate.

For `create`: call `train` with the drafted markdown and `review_evidence`
from the critic-loop step. Use `force_update: false` unless overwrite was
explicitly requested.

For `review`: do not call `train`. Save the findings report only if requested.

For `update`: use `tune` with the existing adapter URI, corrected content, and
`review_evidence`. Use `train` with `force_update: true` only for a required
structural replacement (changing identity/H1 mapping or layer count). Update the
corresponding repository source when the adapter is repo-managed; make repository
edits in the task's isolated worktree.

Report the outcome: adapter URI(s) for create/update, or findings summary for
review.

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```

## Reward Signal

Adapter complete when:
- `create` — adapter(s) stored via `train` (with review_evidence) and URI(s) reported
- `review` — findings report delivered
- `update` — corrected adapter saved via `tune` (or required structural replacement),
  read back and verified; repo-managed source updated in the task worktree

A successful result means the resulting SQUADRULES adapter is more truthful,
step-aware, agent-readable, and aligned with human–AI harmony.
