---
version: "5.2.0"
slug: phase-critic-guide
title: Phase Critic Integration and Mutation Gate Guide
---

# Phase Critic Integration and Mutation Gate Guide

Decision rules for integrating `phase-critic` into adapter protocols and
determining when solution checks (hard verification gates) are required versus
when phase-critic review is sufficient.

## Activation Patterns

**Typically invoked by:** `create-new-protocol` during adapter drafting, and
any adapter that includes review or validation phases.

**Can be invoked directly when agent needs:**
- "when to add phase critic" / "should I use solution check"
- "mutation gate rules" / "which actions need hard gates"
- "phase critic vs solution check" / "irreversible action rules"
- "add review step to protocol" / "where does critic go"

**Trigger pattern:** **phase critic** / **mutation gate** / **solution check** +
(integration | when | rules | guide | which | where).

**Must Never:**
- Be used as an execution protocol.
- Override the adapter author's judgment on review depth.
- Recommend solution checks for reversible or local-only actions.

**Must Always:**
- Distinguish between quality review (phase-critic) and mutation blocking
  (solution checks).
- Recommend phase-critic at every major phase boundary.
- Restrict solution checks to irreversible remote-system mutations.

**Good trigger examples:**
- drafting a new adapter and deciding where to add review → load this
- reviewing whether an adapter has the right solution checks → load this
- "does my MR step need a solution check?" → load this

**Bad trigger examples:**
- "run the phase critic" → use `activate` to match `phase-critic`
- "create a new protocol" → use `create-new-protocol`
- "which challenge type for this step?" → use `challenge-type-guide`

## Core Decision Rule

**Phase-critic** is an adversarial review step at phase boundaries. It verifies
claims, gathers evidence, and searches for contradictions. Use it for quality
and truthfulness review.

**Solution checks** are per-layer contract verification mechanisms (shell
commands, MCP tool calls, user input). Use them ONLY to block actions that
cause **irreversible changes on remote systems**.

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
| Write/edit local file | No | Use phase-critic instead |
| Run local tests | No | Read-only / local |
| Analyze code | No | Read-only |
| Generate report | No | Local artifact |
| Read data from API | No | Read-only |
| Compute / transform data | No | Local operation |

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## How to Chain Phase-Critic into an Adapter

Use `forward` + slug to invoke `phase-critic` at phase boundaries. The standard
pattern is a `mcp` contract that requires calling `forward` with the
`phase-critic` slug:

### After a planning phase

```json
{"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/phase-critic"}},"required":true}}
```

### After an implementation phase

Use the same contract. The phase-critic adapter receives the calling protocol's
context and independently verifies the work.

### Verdict handoff pattern

Phase-critic writes a verdict file. The calling adapter reads it:

1. Phase-critic writes `$VERDICT_FILE` with `PASS`/`FAIL` on line 1.
2. Calling adapter's next layer reads the verdict file.
3. If `FAIL` → **hard stop**: do NOT proceed to reward, do NOT ask the user
   for approval, do NOT continue to the next phase. Address findings first.
4. If `PASS` → the adapter continues to the next phase.

**FAIL is a hard stop, not an escalation trigger.** A FAIL verdict means the
work is not ready. Asking the user "should I proceed?" after FAIL bypasses the
review. The correct action is to fix the findings and re-invoke phase-critic.

### FAIL gate contract (required after every phase-critic invocation)

Every adapter that chains phase-critic **must** include a shell contract that
fails when the verdict is not PASS. This is the mechanical guard that prevents
weaker agents from proceeding after FAIL:

```json
{"contract":{"type":"shell","shell":{"cmd":"head -1 \"$VERDICT_FILE\" | grep -qi '^PASS$'","timeout_seconds":5},"required":true}}
```

If the critic wrote FAIL, this shell command exits non-zero. The server rejects
the solution and the agent cannot advance to the next layer. Protocol wording
alone does not stop determined agents; this contract does.

## Train/Tune Evidence Requirement

`train` and `tune` enforce phase-critic PASS at the tool level:

- **Adapter (markdown) `train`** requires `review_evidence`: verdict_file path,
  exit_code (must be 0), and stdout (line 1 must be PASS). Without it, the
  server rejects the store with `REVIEW_EVIDENCE_REQUIRED`.
- **`tune` with content** requires the same `review_evidence`. Space-only moves
  skip this check.
- **Artifact trains** (non-markdown mime) skip the evidence check.

This is the tool-level enforcement of the FAIL gate. Even if an agent bypasses
the adapter flow and calls `train` directly, the server rejects the store
without PASS evidence. The agent must run phase-critic, capture the verdict
file, and pass it as `review_evidence`.

## Mutation Gate Pattern

When an adapter step performs an irreversible remote mutation, add a solution
check that requires explicit confirmation BEFORE the action:

### Pre-mutation confirmation

```json
{"contract":{"type":"user_input","user_input":{"prompt":"Confirm: you are about to create a merge request on repo X targeting branch Y. This action cannot be undone."},"required":true}}
```

### Post-mutation verification

```json
{"contract":{"type":"mcp","mcp":{"tool_name":"getMergeRequest","arguments":{"repo":"X"}},"required":true}}
```

## Phase-Critic Placement Rules

1. **Add phase-critic at every major phase boundary** — after planning, after
   implementation, after validation.
2. **Do NOT add phase-critic between every layer** — it is a phase-level review,
   not a step-level check.
3. **Add solution checks ONLY on layers that perform remote mutations** — see
   the table above.
4. **Never replace a solution check with phase-critic** for remote mutations —
   phase-critic reviews truth, it does not block execution.
5. **Never add a solution check for local operations** — phase-critic provides
   sufficient review.

## Adapter Authoring Checklist

When drafting a new adapter, apply this checklist:

1. Identify all phase boundaries in the adapter flow.
2. Add a `phase-critic` chain link at each boundary.
3. Identify all steps that perform irreversible remote mutations.
4. Add solution checks (user_input + post-action verification) for each.
5. Verify that no solution checks exist for purely local operations.
6. Verify that the phase-critic verdict handoff pattern is present.
7. Verify that a FAIL gate shell contract follows every phase-critic invocation.
8. Verify that `train`/`tune` calls include `review_evidence` from the critic.
9. Ensure the adapter's Reward Signal describes what the critic protects.

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

The agent can now:
1. Decide when to use phase-critic versus solution checks
2. Identify irreversible remote mutations that need hard gates
3. Chain phase-critic into adapters at the correct phase boundaries
4. Apply the mutation gate pattern for remote-system actions
5. Avoid unnecessary solution checks for local or read-only operations
