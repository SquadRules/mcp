---
slug: create-new-protocol
version: "4.8.6"
title: Create / Review / Refactor SQUADRULES Protocol
---



# Create / Review / Refactor SQUADRULES Protocol

> **Note to the agent:** SQUADRULES protocols are interfaces for AI agents — you
> are the primary user. When you author a protocol, you design behaviour for
> yourself and others. Write for them: single source of truth (never duplicate
> rules), explicit over implicit (agents fill ambiguity with hallucination),
> phases teach modes (each step teaches its cognitive mode), truth over fluency
> (a protocol that reads well but causes wrong behaviour is worse than one that
> reads rough but executes correctly).

## Activation Patterns

SQUADRULES authoring lifecycle — create, review, or update adapters / protocols / workflows.
In this context, those words refer to the same stored artifact and can be treated
as synonyms. Supports three operations:

- **create** — draft and train a new adapter / protocol from scratch.
- **review** — audit an existing adapter, family, or bundle for structural issues,
  missing cross-references, chaining gaps, DRY violations, stale guidance, or
  agent-hostile ambiguity. Read-only.
- **update** — apply specific corrections to an existing adapter / protocol and
  re-train. Also triggered by: edit, fix, modify, change, improve, patch, refactor.

**Run this protocol when the user says ANY of:**

- "create a new SQUADRULES protocol" / "create new protocol adapter"
- "register personal SQUADRULES adapter" / "register a personal adapter"
- "train adapter into personal" / "train protocol into personal"
- "train a workflow" / "register a new adapter" / "create a new workflow"
- "review protocol" / "audit adapters" / "check protocol families for gaps"
- "update adapter" / "edit adapter" / "fix protocol" / "modify adapter"
- "patch protocol" / "refactor protocol" / "change adapter" / "improve adapter"
- "create new protocol" (when `activate` found no match and user confirms)

**Trigger pattern:** **create** / **train** / **register** / **review** /
**audit** / **fix** / **update** / **edit** / **modify** / **change** /
**improve** / **patch** / **refactor** / **correct** +
(protocol / adapter / workflow).

**Must Never:**
- Run when the user only asked to execute an existing protocol.
- Mutate adapters during a `review` operation.
- Optimise only for pretty wording; this protocol designs agent behaviour.
- Treat "update", "edit", or "modify an existing adapter" as the **update**
  operation — never as create.

**Must Always:**
- Infer `{operation}` from trigger: create / review / update.
  When the user says "update", "edit", "modify", or "fix" → operation is **update**.
- Optimise for truth, low ambiguity, explicit sequencing, and user-need alignment.
- Design or review phase transitions explicitly: discovery, clarification,
  ideation, planning, execution, validation, review, handoff.
- Include Activation Patterns as the first H2 and Reward Signal as the last H2
  in any newly drafted adapter.
- Enforce the 350-line limit per file.

**Good trigger examples:**
- "Create a new SQUADRULES protocol for code review" → run this protocol (create)
- "No match found; I want to create a new protocol" → run this protocol (create)
- "Review all v4 protocol families for missing cross-references" → run this protocol (review)
- "Update the MR adapter to include a review step" → run this protocol (update)
- "Edit the phase-critic adapter triggers" → run this protocol (update)
- "Refactor the MR adapter to be less ambiguous" → run this protocol (update)

**Bad trigger examples:**
- "Run the standardise project protocol" → use activate / forward
- "Search for deployment protocol" → use activate
- "Create an MR" → use the MR adapter, not this protocol

## Preflight Dependencies

Before running authoring actions, verify dependency and auth readiness for this
run:

1. Required MCP tools are available and reachable: `activate`, `forward`,
   `reward`, and the operation-dependent tool (`train`, `export`, or `tune`).
2. Required CLI tools for planned shell steps are installed and callable.
3. Required auth/session state is valid for the target MCP server.

If any check fails, stop before main execution and ask the user to choose one:
- proceed with AI-assisted setup and then resume
- abort this protocol run now

Do not continue to intent confirmation until preflight passes.

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```

## Confirm Intent

Infer `{operation}` from the user's trigger:

| Signal | Operation |
|---|---|
| "create", "new", "train", no match from activate | **create** |
| "review", "audit", "check", "gaps", "cross-references" | **review** |
| "update", "edit", "fix", "modify", "change", "improve", "patch", "refactor", "add missing", "correct" | **update** |

For `create`: ask whether to create a new protocol or refine the search.
For `review`: ask which adapter(s), family, or bundle to review.
For `update`: ask which adapter to update and what the issue is.

```json
{"contract":{"type":"user_input","user_input":{"prompt":"Confirm operation and target"},"required":true}}
```

## Gather Requirements

### For `create` — collect details for a new protocol

**1. Determine the pattern:**

| Signal | Pattern |
|---|---|
| One workflow, no variants | **Standalone** — one protocol, all steps inline |
| Multiple issue types / output formats / media | **Router + Extensions** — router classifies, routes via `activate` |
| Domain has a decision tree | **Router + Extensions** |
| Single workflow but exceeds 350 lines or too complex for weaker models | **Chain** — split into sequential adapters linked via `forward` + slug |
| Reference material needed by steps | Extract to a separate file, not a protocol |

**2. Collect per protocol:**

- **Title** — clear, descriptive H1.
- **User problem** — what real problem does this solve?
- **Agent behaviour** — what behaviour should this create in the agent?
- **Mode map** — which steps are for discovery, clarification, ideation,
  planning, execution, validation, review, or handoff?
- **Steps** — each H2 must earn its place and end with a challenge.
- **Challenge type per step** — use the strongest observable contract possible.
- **Domain reference** — guides / docs the protocol should load.
- **Existing protocols** — reuse, compose, or extract shared content.
- **DRY / size check** — extract duplicated content; split if >350 lines.
- **Chain position** — entry, middle, or exit? What slug does the previous link forward to?
- **Failure analysis** — where would a weaker agent misread this protocol?

**3. If Router pattern:** variants, classification questions, forbidden types,
and which parts stay in the router vs extensions.

**4. If Chain pattern:** Load `protocol-linking-guide` for full rules
(`forward` with `squadrules://adapter/protocol-linking-guide`). Collect: chain
links and concerns, minimum number of links, entry point (matched by
`activate`), and artifacts flowing between links.

### For `review` — audit existing adapters against this checklist

Export target adapter(s). For each adapter, check:

1. **User-need fit** — does the adapter solve a real user problem, or merely
   mirror literal wording?
2. **Mode / phase clarity** — are discovery, clarification, ideation,
   execution, validation, and review clearly separated?
3. **Cross-reference completeness** — are all required related adapters linked?
4. **Adapter handoff gaps** — does it hand off where another adapter should own
   the work?
5. **DRY violations** — is policy content duplicated instead of linked?
6. **Contract coverage** — does every executable H2 have the right contract?
7. **Truth-first behaviour** — does it reduce guessing, fake certainty, and
   silent assumption-making?
8. **Activation pattern accuracy** — do triggers match what users actually say?
9. **Structure compliance** — first H2 Activation Patterns, last H2 Reward
   Signal, no duplicate H2s, under 350 lines.
10. **Sibling consistency** — are equivalent steps present across sibling
    adapters in the same family?
11. **Chained adapter families** (when applicable) — extension adapters include
    `chain_root` and a prerequisite clause pointing at the root; parent adapters
    use explicit `forward` when the next adapter slug is already known; reserve
    `activate` for ambiguous runtime discovery (see `protocol-linking-guide`,
    **Chaining Back and Forward**).
12. **Phase-critic integration** — does the adapter include phase-critic chain
    links at major phase boundaries? Does each phase-critic invocation have a
    FAIL gate shell contract (`grep -qi '^PASS$'` on the verdict file)? Are
    solution checks restricted to irreversible remote mutations (see
    `phase-critic-guide`)?

### For `update` — identify the specific issue

Export the target adapter, read the current markdown, identify the exact gap or
error, and plan the minimal change. Do not alter unrelated layers.

Summarise gathered requirements or findings.

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```

## Draft Markdown

### For `create` — draft new adapter markdown

Draft the full markdown for `train`.

### For `review` — draft findings report

Write a structured gap report to `$REVIEW_FINDINGS_FILE` (an absolute path
provided by the invoking agent or chosen by you under
`$SQUADRULES_LOCAL_ARTIFACT_DIR` with a session-unique segment). For each finding
include:

- adapter title
- gap type
- severity
- why the issue matters for AI-agent behaviour
- specific recommended fix

### For `update` — draft corrected adapter markdown

Apply the identified change and show a diff-style summary of what changed.

### Shared drafting rules (all operations)

**Core SQUADRULES rule — right mode at the right time:**

Every protocol must help the agent recognise whether the current step is for
exploration, clarification, ideation, planning, execution, validation, review,
or handoff. Do not blur those modes.

**Truth over fluency:**

Design protocols to reduce guessing and fake certainty. Prefer explicit prompts,
explicit stop conditions, explicit uncertainty escalation, and observable
verification over narrative reassurance.

**User need over literal phrasing:**

The protocol should help the agent provide what the user actually needs, not
just echo the wording used in the request.

**DRY:**

Shared content across protocols must live in one place. If two protocols share
>50% of their body, extract shared logic.

**350-line maximum per file:**

No protocol file may exceed 350 lines. If it grows beyond that, split it into
linked adapters or extract a reference file.

**Generic-first — create generic, link from detailed:**

Create protocols from generic to detailed. The generic adapter must stand alone.
Extensions should contain only the delta.

**Slug convention — deterministic protocol linking:**

Every protocol gets a short, unique, lowercase-hyphenated `slug`.

**Artifacts:**

Store scripts or config blobs as artifacts via `train` (set `mime`,
`artifact_name`, `adapter_uri`). Retrieve with `export` using
`squadrules://artifact/{uuid}`.

**Protocol structure:** H1 title, first H2 Activation Patterns, second H2
Preflight Dependencies, middle H2s one per step with JSON contract block, last
H2 Reward Signal. Frontmatter: `slug` (required), `version` (optional),
`chain_root` (required for mid-chain adapters).

**Challenge types:** Load `challenge-type-guide` for decision rules and JSON
formats (`forward` with `squadrules://adapter/challenge-type-guide`).

**Phase-critic and mutation gates:** Load `phase-critic-guide` for placement,
FAIL gate, and solution check rules (`forward` with `squadrules://adapter/phase-critic-guide`).

**If Router pattern:** draft the router and each extension as separate files.

Post the full drafted markdown.

```json
{"contract":{"type":"comment","comment":{"min_length":120},"required":true}}
```

## Phase-Critic Review (create and update only)

For `create` and `update`: run phase-critic against the drafted markdown before
presenting to the user. This is the quality gate — the agent owns content, the
critic owns quality.

1. Invoke phase-critic via `forward` with `squadrules://adapter/phase-critic`.
   Provide the drafted markdown as `input_file`, the slug as
   `calling_protocol_slug`, and "structural compliance and agent behaviour"
   as `verification_target`.
2. Run the FAIL gate shell contract on the verdict file:

```json
{"contract":{"type":"shell","shell":{"cmd":"head -1 \"$VERDICT_FILE\" | grep -qi '^PASS$'","timeout_seconds":5},"required":true}}
```

3. If FAIL: address findings, re-invoke phase-critic. Do NOT proceed.
4. If PASS: capture the verdict file path for the `review_evidence` field
   in the `train` call below.

For `review`: skip this step (read-only operation).

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```

## User Review

For `create`: present the drafted protocol(s) and the phase-critic verdict.
User acknowledges (informational, not an approval gate).

For `review`: present the findings report and ask which findings to act on.

For `update`: present the corrected markdown, change summary, and critic verdict.

```json
{"contract":{"type":"user_input","user_input":{"prompt":"Acknowledge the draft and verdict (create/update) or review findings"},"required":true}}
```

## FinaliseOperation

For `create`: call `train` with the drafted markdown and `review_evidence`
from the phase-critic step. Use `force_update: false` unless overwrite was
explicitly requested.

For `review`: do not call `train`. Save the findings report only if requested.

For `update`: call `train` with `force_update: true`, `review_evidence` from
the phase-critic step, and update the corresponding repo file.

Report the outcome: adapter URI(s) for create / update, or findings summary for
review.

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```

## Reward Signal

Protocol complete when:
- `create` — adapter(s) stored via `train` (with review_evidence) and URI(s) reported
- `review` — findings report delivered and acknowledged
- `update` — corrected adapter trained with `force_update: true` + review_evidence, repo file updated

A successful result means the resulting SQUADRULES adapter is more truthful,
phase-aware, agent-readable, and aligned with human–AI harmony.
