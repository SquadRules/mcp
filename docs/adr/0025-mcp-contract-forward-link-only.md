# ADR 0025: MCP contract scoped to forward+slug linking only

## Status

Accepted — decision taken 2026-10-21 and implemented by the accompanying change;
not yet on `main` when this record was written.

## Context

An `mcp` contract asks the executing agent to call a Model Context Protocol tool
and submit the call as proof. Two very different uses grew under that one type.

**Chain links.** The last layer of an adapter hands off to the next adapter:
`tool_name: "forward"` with `arguments.uri` set to `squadrules://adapter/<slug>`.
This is load-bearing architecture. It is how a stored adapter drives another
stored adapter through its own `forward`/`reward` loop, and it is how
`critic-loop` is invoked from inside other adapters
([ADR 0010](0010-critic-loop-and-proof-splitting.md),
[ADR 0017](0017-critic-loop-work-submission.md)). The server verifies the
submitted arguments are a superset of the contract's, so the link's target is
checked, not merely its tool name.

**Bare tool calls as verification.** A mid-body layer whose contract is
`tool_name: "activate"`, `"export"`, or `"getMergeRequest"` — the agent performs
the tool work inline and submits the transcript as proof. This is the problem.
Every MCP tool call in the caller's thread dumps its full request and response
into the context of the agent that is trying to execute the adapter: an `export`
of all adapters in a space, a merge-request body, an `activate` response with
ranked candidates and their instructions. The calling agent's context fills with
material it did not need in order to take the next step, and the adapter's own
instructions compete with it.

The 2026-10-18 requirements note
(`.local/requirements-from-chat-4887f3f2.md` §1) initially read as "erase the
`mcp` contract type". The owner **reversed** that on 2026-10-19: keep `mcp`, but
scope-restrict it to adapter/project linking. The reversal is recorded in that
note's own Notes section. Erasing the type would have removed the only mechanism
that lets one stored adapter deterministically hand off to another — including to
`critic-loop` mid-adapter — and would have forced those handoffs into prose
instructions with no verification at all.

A second defect is present in the shipped guides: both
`src/embed-docs/mem/README.md` and `src/embed-docs/mem/protocol-linking-guide.md`
present a **bare** `{"tool_name":"forward"}` contract — no `arguments.uri` — as
an acceptable form, contrasting it with the argument-carrying version as merely
"verifies the exact target". A forward link without a target verifies only that
*some* handoff happened, which is not a chain link.

## Decision

An `mcp` contract **must** be a forward link, and nothing else:

- `mcp.tool_name` is exactly `"forward"`.
- `mcp.arguments.uri` is present and matches `squadrules://adapter/<slug>`.

Anything else is a structural validation failure with a new `missing` code,
`mcp_link_only`, reported by
`src/services/memory/validate-protocol-structure.ts` and surfaced through
`train` (`PROTOCOL_STRUCTURE_INVALID`) and the CLI upload guards.

**Bare MCP tool calls are not valid `mcp` contracts.** Where an adapter step
genuinely needs an MCP tool result, it is re-expressed as one of:

- a **`subagent` contract** — the subagent makes the call and returns only its
  report, so the transcript never reaches the caller's context. This is rung 3 of
  the [ADR 0024](0024-adapter-contract-verification-ladder.md) ladder, and it is
  the correct home for `export`, `activate`, and merge-request reads;
- an **instruction verified by `shell`** — the adapter tells the agent to make the
  call as its `next_action`, and the contract asserts the observable result on
  disk (a report file, an exported artifact) rather than the call itself. This is
  rung 1 and is preferred whenever the call leaves something behind.

**Placement.** The forward link belongs at the adapter's tail, handing off to the
next adapter. Mid-adapter forward links are permitted **only** to a reusable
sub-adapter — `critic-loop` at a phase boundary is the standing case. This is
what preserves [ADR 0010](0010-critic-loop-and-proof-splitting.md) and
[ADR 0017](0017-critic-loop-work-submission.md) unchanged: `critic-loop` is a
stored multi-layer adapter that must be *driven* through its own forward/reward
loop, which a `subagent` contract cannot do, because a subagent collects a report
and returns.

**A forward link without `arguments.uri` is not a chain link** and fails the same
rule. The bare `{"tool_name":"forward"}` examples in the shipped guides are
removed rather than kept as a weaker alternative.

The rule is expressed as data — a per-type required-field map plus the mcp link
shape — so a future contract type is a table entry, not a validator rewrite.

## Consequences

### Positive

- The actual defect is removed: no MCP tool transcript lands in the executing
  agent's context as a side effect of satisfying a contract.
- Chain-link verification gets stronger, not weaker. Every surviving `mcp`
  contract names its target URI, so the server's superset check proves the handoff
  went where the adapter said.
- `critic-loop` mid-adapter invocation is untouched. The reusable sub-adapter
  exemption keeps ADR 0010 and ADR 0017 intact with no migration for their
  callers.
- Hard-enforced and objective: the shape is a two-field check, so fail-closed
  costs nothing in false positives.

### Negative

- Existing adapters and examples must be rewritten. Enumerated from the parsed
  contract blocks at the time of this record — 9 of 16 `mcp` contracts across
  `src/embed-docs/mem/` and `docs/examples/` are non-conformant:

  | File | Line | `tool_name` | Disposition |
  | --- | --- | --- | --- |
  | `src/embed-docs/mem/adapter-migration.md` | 83 | `export` | `subagent` + `shell` check on the produced report |
  | `src/embed-docs/mem/critic-loop-guide.md` | 240 | `getMergeRequest` | `subagent` (ladder rung 3) |
  | `src/embed-docs/mem/refine-search.md` | 82 | `activate` | instruction + single closing `comment` (guidance, not verifiable work) |
  | `src/embed-docs/mem/challenge-type-guide.md` | 82 | `<tool>` placeholder | remove the branch; document forward-link shape only |
  | `src/embed-docs/mem/README.md` | 98 | `forward`, no `uri` | remove the bare example |
  | `src/embed-docs/mem/protocol-linking-guide.md` | 161 | `forward`, no `uri` | remove the bare example |
  | `docs/examples/adapter-example-all-types.md` | 35 | `activate` | reframe as tail forward link |
  | `docs/examples/adapter-example-mcp.md` | 18, 38 | `activate` | reframe as tail forward link |

  The 7 already-conformant forward links stay as they are
  (`protocol-linking-guide.md:167`, `critic-loop-guide.md:130`,
  `challenge-type-guide.md:87`, `challenge-type-guide.md:334`,
  `mem/README.md:104`, plus the two tombstones
  `phase-critic.md:40` and `create-new-protocol.md:38`, which
  [ADR 0027](0027-retire-redirect-tombstones.md) removes outright).
- Some verification gets weaker in exchange for a cleaner context. An `activate`
  contract proved the call happened; an instruction plus a closing `comment`
  proves less. Accepted: `refine-search` is guidance rather than verifiable work,
  and a proof that pollutes the thread it is protecting is not a bargain.
- Rung 3 costs a subagent round-trip per displaced MCP call.
- The mid-adapter exemption is a hole an author can argue through — "my target is
  reusable too". It is closed by naming: the exemption is for a *stored adapter
  driven through its own forward/reward loop*, and the only standing instance is
  `critic-loop`.

## Alternatives Considered

### Erase the `mcp` contract type entirely

The pre-reversal reading of the 2026-10-18 requirements note. Rejected on
2026-10-19 by the owner. It removes the only mechanism by which one stored
adapter deterministically hands off to another, and it cannot express the
`critic-loop` mid-adapter invocation that ADR 0010 and ADR 0017 depend on.

### Strict tail-only: an `mcp` contract may appear only on the last layer

Rejected. It forces `critic-loop` to become a `subagent` contract, and a
`subagent` contract collects a report — it cannot drive a stored multi-layer
adapter through its own forward/reward loop. Phase-boundary links to a reusable
sub-adapter are architecturally sound and must survive. Kept as veto-able: if the
owner prefers it, the `mem/` rewrites for `critic-loop`, `critic-loop-guide`, and
`author-adapter` change accordingly.

### Keep bare tool calls but cap the response size

Rejected. It treats the symptom. The pollution is the transcript's presence in the
caller's reasoning context at all, not only its length, and a cap adds a runtime
truncation surface with its own failure modes while leaving the adapter author
free to keep choosing the wrong rung.

### Soft-enforce through the flow doc and the critic

Rejected for this rule specifically. Unlike the ladder and the comment ceiling
([ADR 0024](0024-adapter-contract-verification-ladder.md) §6), the forward-link
shape has no legitimate exceptions: it is two fields, objectively checkable, and
fail-closed costs nothing. Judgment is reserved for rules that need it.

## Evidence

- `src/embed-docs/mem/protocol-linking-guide.md:161` and
  `src/embed-docs/mem/README.md:98` — the bare `{"tool_name":"forward"}` form
  presented as acceptable, with the argument-carrying form described only as
  "verifies the exact target".
- `src/embed-docs/mem/adapter-migration.md:83` (`export`),
  `src/embed-docs/mem/critic-loop-guide.md:240` (`getMergeRequest`),
  `src/embed-docs/mem/refine-search.md:82` (`activate`),
  `src/embed-docs/mem/challenge-type-guide.md:82` (`<tool>` placeholder) — the
  four bare-tool-call contracts in the shipped bundle.
- `src/embed-docs/mem/critic-loop-guide.md:130` — the mid-adapter
  `forward` → `squadrules://adapter/critic-loop` link this record preserves.
- `docs/examples/adapter-example-mcp.md:18,38` and
  `docs/examples/adapter-example-all-types.md:35` — examples teaching `activate`
  as an `mcp` contract.
- `src/services/memory/validate-protocol-structure.ts` — today checks only that
  `contract.type` is in `ALLOWED_CONTRACT_TYPES`; it never inspects the `mcp`
  payload, so no `mcp_link_only` code exists yet.
- `.local/requirements-from-chat-4887f3f2.md` §1 (`mcp` contracts) and its Notes
  section — the 2026-10-19 reversal, verbatim: "The `mcp` contract type is kept
  (not erased); it is scoped to project/adapter linking at the end of an adapter."

## Revisit condition

Reopen if a legitimate need appears for a verified bare MCP tool call that neither
a `subagent` contract nor a `shell` check on the resulting artifact can express —
for example a tool whose result exists only in the response and leaves nothing on
disk, where the transcript must be reviewed by the caller rather than summarised.
Also reopen if the reusable sub-adapter exemption is abused to smuggle ordinary
tool work through a `forward` link, which would mean the exemption needs a
structural test rather than a named list. Track via a new issue; do not rewrite
this record.

## Related

- [ADR 0024](0024-adapter-contract-verification-ladder.md) — the ladder. Rung 3
  (`subagent` performing the MCP call) is where this record sends displaced tool
  work; §6 explains why this rule is hard where the ladder is soft.
- [ADR 0010](0010-critic-loop-and-proof-splitting.md) — `critic-loop` as the
  reusable sub-adapter invoked mid-adapter by forward link; preserved unchanged.
- [ADR 0017](0017-critic-loop-work-submission.md) — the typed work submission the
  linked critic receives; preserved unchanged.
- [ADR 0026](0026-shell-interpreter-required.md) — the sibling hard structural
  rule, landing in the same table-driven validator change.
- [ADR 0027](0027-retire-redirect-tombstones.md) — removes two of the seven
  conformant forward links (the tombstones).
- [ADR 0014](0014-always-latest-mcp-spec-and-sdk.md) — the Model Context Protocol
  surface these contracts name.
