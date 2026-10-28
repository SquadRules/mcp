# Adapter Design Principles

Adapters encode a team's preferences so an agent can execute work without
re-deriving intent every time. Three principles govern their design:
**autonomy**, **help over puzzles**, and **honest verification**. This document is
the *why*. The mechanics that follow from it — the verification ladder, per-type
rules, quantity limits, and lifecycle flows — live in the
[adapter authoring guide](adapter-authoring-guide.md).

**Every check must justify its interruption. Verify meaningful outcomes with the
fewest necessary round trips.**

## 1. Autonomy: agents own their workflows

Agents find, execute, create, repair, and maintain workflows end to end. When
preferences change or execution exposes a gap, updating the adapter is part of
finishing the task — not a separate request for permission.

- Use existing authorization and known preferences; never invent either to avoid
  asking.
- A routine failure produces a recovery action, not an automatic handoff to a
  human.
- `user_input` is an emergency valve for a genuine authority or decision gap, not
  a routine confirmation gate.

Autonomy is the default; human involvement is the exception that must be
justified. The reasoning is recorded in
[ADR 0009](adr/0009-autonomous-adapter-execution-no-human-gates.md).

## 2. Help, not puzzles

An adapter teaches an agent to do the work — it is not a riddle about what the
author meant. Write brief, precise instructions with explicit conditions, exact
next actions, and observable completion criteria, so a less capable model can
follow them without guessing.

- Put bookkeeping, mechanical validation, and recovery in the framework, not in
  the agent's reasoning.
- Keep dependent instructions together. A named phase is not automatically a
  separate contract or an extra round trip.
- Remove repeated confirmations. Necessary guidance stays; ceremony goes.

## 3. Honest verification

Verification is the only thing that separates "the adapter ran" from "the
adapter's work is true". Prefer evidence that *observes* the work over a claim
*about* the work.

Reach for the strongest evidence that applies, in this order:

1. **Observe it.** A deterministic check on something the step produced — a file,
   an exit status, a git ref, a line in a report.
2. **Judge it.** Where correctness needs judgment that cannot be reduced to a
   test — intent, coverage, tone — delegate to a reviewer with explicit criteria
   and access to the actual work.
3. **Delegate the tool work.** Where the evidence is a tool result, hand the call
   to a subagent so the transcript stays out of the caller's reasoning context.
4. **Acknowledge it — last resort.** Only where the adapter produces no
   observable artifact and needs no judgment: a read-only or knowledge adapter
   whose whole output is guidance the agent has now read.

Descend only when the higher rung genuinely cannot apply, and say why. "Was
faster to write" is not a reason. The full ladder, its ordering rationale, and its
exemptions are recorded in
[ADR 0024](adr/0024-adapter-contract-verification-ladder.md).

### State what the evidence proves

| Evidence             | What it establishes                     | What it does not establish         |
| -------------------- | --------------------------------------- | ---------------------------------- |
| A nonempty file      | Some content exists                     | The content is correct or complete |
| A successful command | The command's success condition was met | The entire task succeeded          |
| A tool response      | The tool reported a result              | Every intended effect occurred     |
| A review verdict     | The reviewer reached a conclusion       | The review was thorough or correct |
| An acknowledgment    | The agent submitted a statement         | Understanding or execution         |

Choose evidence that matches the claim. Where needed, inspect the resulting state
rather than a note about it. Submitted execution evidence is not automatically
independent verification: a nonce or hash can tie a submission to a step without
proving the underlying work happened.

### Avoid acknowledgment loops

Do not require "I understand", "I am ready", or a minimum-length summary as proof
of quality. Length does not establish understanding or execution. If the framework
requires a closing acknowledgment to end a run, keep it minimal and treat it as a
run-completion formality — not as verification.

### Make failure useful

A failed check should say what failed, what evidence supports that finding, what
to do next, and whether retrying is appropriate. Preserve valid work, bound
retries, and never report a failed check as passed. If the check itself is
unsuitable, repair it within the agent's authority or obtain the one decision that
is genuinely missing.

## Review every proposed contract

Before adding a contract, answer:

1. Which failure does it detect?
2. What does its evidence actually prove?
3. How does its result change the next action?
4. Can an existing check already cover it?
5. Is the interruption worth the protection?

If the answers are unclear, improve the instruction or drop the checkpoint. For
each retained contract, record its purpose, its evidence, its limits, and its
failure response — and explain why it must be separate when another check looks
similar. These examples support the principles; they must not become a
justification for preserving unnecessary checks.

## Where the decisions are recorded

This document states principles, not mechanics. The binding decisions behind them
live in the ADRs; the authoring rules derived from them live in the
[adapter authoring guide](adapter-authoring-guide.md):

- [ADR 0009](adr/0009-autonomous-adapter-execution-no-human-gates.md) — autonomy;
  objective contracts replace human approval gates.
- [ADR 0010](adr/0010-critic-loop-and-proof-splitting.md) — proof splitting by
  reversibility cost; the delegated-judgment critic loop.
- [ADR 0017](adr/0017-critic-loop-work-submission.md) — what the critic is
  handed: a typed work submission, not an essay.
- [ADR 0024](adr/0024-adapter-contract-verification-ladder.md) — the verification
  ladder and the quantity policy.
- [ADR 0026](adr/0026-shell-interpreter-required.md) — a shell contract fully
  specifies its interpreter.
- [ADR 0028](adr/0028-forward-contract-type-rename.md) — a `forward` contract names
  the adapter it links to and nothing else, keeping tool transcripts out of the
  caller's context. Supersedes
  [ADR 0025](adr/0025-mcp-contract-forward-link-only.md).
- [ADR 0029](adr/0029-subagent-mcp-and-context-authority.md) — delegated MCP tool
  work is named in `subagent.mcp` and executed by the subagent, never on the
  caller's thread.
- [ADR 0033](adr/0033-gate-scripts-as-adapter-artifacts.md) — a multi-step check
  ships as a gate script artifact the adapter materializes, not as an escaped
  one-liner in `cmd`; help over puzzles applies to the author, too.
