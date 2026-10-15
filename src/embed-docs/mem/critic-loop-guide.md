---
version: "5.9.5"
slug: critic-loop-guide
title: Critic Loop Integration and Mutation Gate Guide
---

# Critic Loop Integration and Mutation Gate Guide

Decision rules for integrating `critic-loop` into adapter protocols: when a
solution check (hard verification gate) is required versus when critic-loop
review is sufficient, and how to split and batch proofs so reversible work stays
cheap while irreversible boundaries stay guarded.

## Activation Patterns

**Typically invoked by:** `author-adapter` during adapter drafting, and
any adapter that includes review or validation phases.

**Can be invoked directly when agent needs:**
- "when to add critic loop" / "should I use solution check"
- "mutation gate rules" / "which actions need hard gates"
- "critic loop vs solution check" / "irreversible action rules"
- "add review step to protocol" / "where does critic go"

**Trigger pattern:** **critic loop** / **mutation gate** / **solution check** +
(integration | when | rules | guide | which | where).

**Must Never:**
- Be used as an execution protocol.
- Override the adapter author's judgment on review depth.
- Recommend solution checks for reversible or local-only actions.

**Must Always:**
- Distinguish between quality review (critic-loop) and mutation blocking
  (solution checks).
- Recommend looping critic-loop until PASS at every major phase boundary, fed the
  requirement list and bounded by an iteration ceiling.
- Restrict solution checks to irreversibility boundaries, and batch reversible
  checkable steps into one strict-conjunction proof.

**Good trigger examples:**
- drafting a new adapter and deciding where to add review → load this
- reviewing whether an adapter has the right solution checks → load this
- "does my MR step need a solution check?" → load this

**Bad trigger examples:**
- "run the critic loop" → use `activate` to match `critic-loop`
- "create a new protocol" → use `author-adapter`
- "which challenge type for this step?" → use `challenge-type-guide`

## Core Decision Rule

**Critic-loop** is an adversarial review the calling protocol **loops until it
returns PASS** — not a one-shot step. It verifies claims, gathers evidence,
searches for contradictions, and checks the work against the original requirement
list. Use it for quality and truthfulness review, and whenever a step is
non-deterministic or has no objective proof. Run it **before** the work is handed
to the next step, and before it is presented to the human.

**Solution checks** are per-layer contract verification mechanisms (shell
commands, MCP tool calls). Use them ONLY where getting it wrong is expensive or
impossible to undo — **irreversible changes on remote systems** and the local
preconditions that guard them (for example, being on a throwaway worktree/branch
before you commit). Everything else is reversible: give the agent freedom and
review with critic-loop instead of adding a hoop.

### What counts as an irreversible remote mutation

| Action | Needs solution check? | Why |
|--------|----------------------|-----|
| Create/update merge request | Yes | Remote system state change |
| Create/update Jira issue | Yes | Remote system state change |
| Send email | Yes | Cannot unsend |
| Send Teams message | Yes | Cannot unsend |
| Create calendar invite | Yes | Sends notifications |
| Deploy to production | Yes | Irreversible infrastructure change |
| Delete remote resource | Yes | Irreversible |
| Push to git remote | Yes | Remote state change |
| Write/edit local file | No | Use critic-loop instead |
| Run local tests | No | Read-only / local |
| Analyze code | No | Read-only |
| Generate report | No | Local artifact |
| Read data from API | No | Read-only |
| Compute / transform data | No | Local operation |

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Proof Splitting: Batch Checkable Steps Into One Proof

Split proofs by **reversibility cost**, not by step count:

- **One proof per irreversibility boundary.** A boundary is where undoing the next
  part is expensive or impossible: commit to `main`, mutate the human's active
  worktree, `git push`, `gh pr create`, deploy, send.
- **Batch reversible, checkable steps** and verify them together afterward with a
  single aggregate proof — fewer round-trips, same guarantee.
- **The aggregate proof must be a strict conjunction** that re-verifies every
  sub-condition (`A && B && C && echo OK`):

```json
{"contract":{"type":"shell","shell":{"cmd":"test -f \"$OUT_A\" && test -f \"$OUT_B\" && grep -q \"$EXPECTED\" \"$OUT_A\" && echo OK","timeout_seconds":10},"required":true}}
```

- **Never let an aggregate proof degrade to `echo "done"`.** A proof that asserts
  nothing is worse than no gate because it looks like one. If you cannot write a
  real conjunction, the step is non-deterministic → review it with critic-loop
  instead of faking a proof.

### Guard the boundary before you cross it

The cheapest proof is the precondition that stops an irreversible mistake before
it happens — for example, confirm you are on a throwaway worktree and branch (not
`main`, not the human's active checkout) **before** making changes:

```json
{"contract":{"type":"shell","shell":{"cmd":"test \"$(git rev-parse --abbrev-ref HEAD)\" != main && git rev-parse --git-common-dir | grep -q worktrees","timeout_seconds":5},"required":true}}
```

## How to Chain Critic-Loop into an Adapter

Use `forward` + slug to invoke `critic-loop` at phase boundaries. The standard
pattern is a `mcp` contract that requires calling `forward` with the
`critic-loop` slug:

### After a planning phase

```json
{"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/critic-loop"}},"required":true}}
```

### After an implementation phase

Use the same contract. The critic-loop adapter receives the calling protocol's
context and independently verifies the work.

### What to submit for review

The submission is the **work itself**, not a summary of it. Pass `work` with a
`kind`, an `items` list, and the absolute `root` the items resolve against:

| `kind` | `items` contain | Resolved by | Typical work |
|---|---|---|---|
| `file_set` | paths (absolute, or relative to `root`) | read each file | docs, generated code, configs |
| `links` | URLs, `squadrules://` resource URIs | fetch each one | published pages, external references |
| `git_diff` | `base..head` refs, or empty for the working tree | `git diff` | an unpushed implementation |
| `pr` | PR numbers or URLs | `gh pr view` + `gh pr diff` | a reviewable pull request |
| `command_output` | commands to run from `root` | run and capture | migrations, builds, data pulls |
| `inline` | the text itself | read the manifest | a plan, a decision, a message draft |

Record `work` in the handoff file pointed to by `$WORK_MANIFEST`, as flat keys —
`kind:`, `root:`, then `items:` with one item per line — so the precondition
stays a machine-checkable file test instead of prose:

```json
{"contract":{"type":"shell","shell":{"cmd":"test -f \"${WORK_MANIFEST:-}\" || test -f \"${INPUT_FILE:-}\"","timeout_seconds":3},"required":true}}
```

Anything that cannot be resolved is `verification_blocked` — an item the critic
could not read is never treated as an item that passed. `input_file` still works
and means a one-item `file_set`; prefer `work_manifest` for anything that is not
a single document. A `pr` or `git_diff` submission is judged on the diff and the
tests it touches, not on the description written next to it.

### Feed it the requirements, then loop with a ceiling

Pass the original requirement list in the forward context. A critic that sees only
the output can check internal consistency but **cannot detect an omitted
requirement** — omission leaves no trace in the artifact — so "no requirements
lost" is only enforceable if the critic is given the list and asserts coverage
item by item. Then loop: on FAIL, fix, increment `iteration`, and re-invoke until
PASS or until `max_iterations` is reached. The ceiling is a hard stop that
surfaces the unresolved findings; it prevents a weak agent from thrashing forever.

### Verdict handoff pattern

Critic-loop writes a verdict file. The calling adapter reads it:

1. Critic-loop writes `$VERDICT_FILE` with `PASS`/`FAIL` on line 1.
2. Calling adapter's next layer reads the verdict file.
3. If `FAIL` → **hard stop**: do NOT proceed to reward, do NOT ask the user
   for approval, do NOT continue to the next phase. Address findings first.
4. If `PASS` → the adapter continues to the next phase.

**FAIL is a hard stop, not an escalation trigger.** A FAIL verdict means the
work is not ready. Asking the user "should I proceed?" after FAIL bypasses the
review. The correct action is to fix the findings and re-invoke critic-loop.

### FAIL gate contract (required after every critic-loop invocation)

Every adapter that chains critic-loop **must** include a shell contract that
fails when the verdict is not PASS. This is the mechanical guard that prevents
weaker agents from proceeding after FAIL:

```json
{"contract":{"type":"shell","shell":{"cmd":"head -1 \"$VERDICT_FILE\" | grep -qi '^PASS$'","timeout_seconds":5},"required":true}}
```

If the critic wrote FAIL, this shell command exits non-zero. The server rejects
the solution and the agent cannot advance to the next layer. Protocol wording
alone does not stop determined agents; this contract does.

## Train/Tune Evidence Requirement

`train` and `tune` enforce critic-loop PASS at the tool level:

- **Adapter (markdown) `train`** requires `review_evidence`: verdict_file path,
  exit_code (must be 0), and stdout (line 1 must be PASS). Without it, the
  server rejects the store with `REVIEW_EVIDENCE_REQUIRED`.
- **`tune` with content** requires the same `review_evidence`. Space-only moves
  skip this check.
- **Artifact trains** (non-markdown mime) skip the evidence check.

This is the tool-level enforcement of the FAIL gate. Even if an agent bypasses
the adapter flow and calls `train` directly, the server rejects the store
without PASS evidence. The agent must run critic-loop, capture the verdict
file, and pass it as `review_evidence`.

## Mutation Gate Pattern

Under the AI-ownership model, agents execute autonomously — irreversible remote
mutations are **not** gated by a human confirmation prompt. Gate them with
objective, machine-checkable contracts instead:

### Pre-mutation readiness (objective, no human prompt)

Assert the preconditions with a shell or mcp contract so the action only runs from a
valid state — never with a `user_input` "are you sure?" prompt:

```json
{"contract":{"type":"shell","shell":{"cmd":"test -n \"$TARGET_REPO\" && test -n \"$TARGET_BRANCH\"","timeout_seconds":5},"required":true}}
```

### Post-mutation verification (objective)

Confirm the mutation actually took effect by reading the remote state back:

```json
{"contract":{"type":"mcp","mcp":{"tool_name":"getMergeRequest","arguments":{"repo":"X"}},"required":true}}
```

The guarantee comes from critic-loop (truth of intent) plus these objective
pre/post checks — not from asking a human to approve. Do not add `user_input`
confirmation gates for remote mutations.

## Critic-Loop Placement Rules

1. **Loop critic-loop until PASS at every major phase boundary** — after planning,
   after implementation, after validation — feeding it the requirement list and
   bounding it with an iteration ceiling.
2. **Do NOT add critic-loop between every layer** — it is a phase-level review,
   not a step-level check.
3. **Put one objective proof at each irreversibility boundary** — remote mutation
   or the local precondition that guards it: pre-mutation readiness +
   post-mutation verification, never a human confirmation prompt.
4. **Batch reversible, checkable steps into one aggregate strict-conjunction
   proof** instead of one proof per step; never let it degrade to `echo "done"`.
5. **Never replace a boundary proof with critic-loop** — critic-loop reviews truth
   after the fact; it does not block an irreversible step.
6. **Never add a proof for purely local, reversible operations** — critic-loop
   provides sufficient review.

## Adapter Authoring Checklist

When drafting a new adapter, apply this checklist:

1. Identify all phase boundaries in the adapter flow.
2. Add a `critic-loop` chain link at each boundary.
3. Identify all steps that perform irreversible remote mutations.
4. Add objective solution checks (pre-mutation readiness + post-action
   verification) for each — no `user_input` human-confirmation gate.
5. Verify that no solution checks exist for purely local operations.
6. Verify that the critic-loop verdict handoff pattern is present.
7. Verify that a FAIL gate shell contract follows every critic-loop invocation.
8. Verify that `train`/`tune` calls include `review_evidence` from the critic.
9. Ensure the adapter's Reward Signal describes what the critic protects.

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

The agent can now:
1. Decide when to use critic-loop versus solution checks
2. Identify irreversible remote mutations that need hard gates
3. Chain critic-loop into adapters at the correct phase boundaries
4. Apply the mutation gate pattern for remote-system actions
5. Avoid unnecessary solution checks for local or read-only operations
