# ADR 0034: The critic runs apart from the executor — a critic hop is a `subagent` contract

## Status

Accepted — taken 2026-10-27, ratified by the owner as the current-world form of
honest verification: the ideal is a check by a different model, session, and
agent ([#101](https://github.com/SquadRules/mcp/issues/101)); "in the current
world a subagent is the next best thing".

This record refines [ADR
0024](0024-adapter-contract-verification-ladder.md) §1 rung 2 (delegate to
`critic-loop`) by fixing *who* may hold the delegate, and supersedes the
"`forward` + slug is the standard pattern" rule written into
`src/embed-docs/mem/critic-loop-guide.md`. It qualifies the reading of [ADR
0029](0029-subagent-mcp-and-context-authority.md) Decision §2's "never a forward
link" clause (see Decision §2). It does not change the ladder, the quantity
policy, or the exemptions.

## Context

Principle 3 of `docs/adapter-design-principles.md` prefers evidence that
*observes* the work over a claim *about* the work. A critic that is run by the
agent that produced the work is the strongest available counterexample: the same
context that made the mistake decides whether the mistake exists, and the verdict
is a claim restated, not observed.

The bundle taught exactly that. `critic-loop-guide.md` ("How to Chain
Critic-Loop") stated the standard pattern is a `forward` contract naming the
`critic-loop` slug, and `author-adapter.md` told the drafting agent to "Invoke
critic-loop via `forward`". A `forward` contract resolves to the caller's own
thread: the agent calls the `forward` tool, receives the critic's instructions,
performs them, and writes the verdict file it will then be gated on.

Two facts about what the current runtime does and does not verify made the
trade-off concrete:

- A `forward` contract carries the only delegation property the server checks:
  `validateForwardSubmissionAgainstContract` rejects when the submitted
  `evidence.target` differs from `contract.forward.target`
  (`src/tools/forward-contract-match.ts:17–53`). Moving the hop to a `subagent`
  contract gives that up.
- What it checks is a *string equality*, not the review. The server never opens
  the verdict file: `assertReviewEvidencePassed` (`src/tools/review-evidence-check.ts:18–41`)
  validates the agent-supplied `exit_code` and the first line of the agent-supplied
  `stdout`. The PASS gate has always been self-reported at the tool boundary.

So `forward` was never content binding; it was target binding over an
unverified verdict. Meanwhile [#97](https://github.com/SquadRules/mcp/issues/97)
demonstrated caller-supplied verdicts can be fabricated, and
[#101](https://github.com/SquadRules/mcp/issues/101) proposes the real fix — a
server-initiated critic session issuing a receipt bound to the reviewed content
— which is explicitly "not an approved implementation" and moves inference cost
onto the operator.

The decision therefore had to be taken between two imperfect guarantees, and the
choice had to be recorded, because ADR 0024 §5's exemption list is closed and
`critic-loop-guide` was teaching the opposite rule.

## Decision

### 1. A step that criticises this run's work is a `subagent` contract

Any contract whose purpose is to judge or verify work produced by the same agent
in the same run **must** be a `subagent` contract. The challenge already carries
the mandatory instruction "Delegate this task to a subagent and return its
actual report. Do not perform the task yourself."
(`src/tools/next-pow-challenge-shape.ts:57–63`).

A `forward` contract remains correct for **chain continuation** — handing the
work to the next *stage* of the same effort, or to a reusable sub-adapter the
caller is not auditing. The distinguishing question is not "does it link to
another adapter" but "is the linked adapter the auditor of the linking agent".
If yes, the caller may not be the one executing it.

### 2. The hop names its mechanism in `subagent.mcp`

The critic hop pins what the subagent must actually do:

```json
{"contract":{"type":"subagent","subagent":{"context":"<work manifest path, requirement list, verification target, iteration and ceiling>","mcp":[{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/critic-loop"}}]},"required":true}}
```

Naming the `forward` **tool** as a call the subagent executes is not the thing
[ADR 0029](0029-subagent-mcp-and-context-authority.md) Decision §2 forbids. That
clause rejects using `subagent.mcp` as a *substitute for a `forward` contract* —
expressing a chain link as a delegation list. Here the call is a real MCP tool
call executed by the subagent on its own thread, which is the definition of rung
3, and it is the reason ADR 0029 exists: it stops the subagent from substituting
a plausible narrative for the real call. The shape is already accepted by the
validator (`subagent_mcp_invalid` checks `tool_name` and `arguments` only).

### 3. The mechanical anchor stays rung 1, and its limits are stated

The caller's `shell` verdict gate (`head -1 "$VERDICT_FILE" | grep -qi '^PASS$'`)
remains required after every critic hop. What the combination proves is:
a separate context was instructed to run `critic-loop`, and a verdict file it was
told to write says PASS. What it does **not** prove is that the report came from
that context or that the verdict is content-bound to the reviewed artifact.
Adapters and guides must state this, not imply cryptographic isolation, until
[#101](https://github.com/SquadRules/mcp/issues/101) ships receipts.

### 4. Isolation and the quantity policy collapse the ceremony

Applying rung-2 isolation together with
[ADR 0024](0024-adapter-contract-verification-ladder.md) §3 (one contract per
adapter; extra gates only at irreversible boundaries) fixes the bundled adapters:

- `critic-loop` carries **one** contract: the verdict-file syntax gate. Its
  precondition, submission-resolution, and audit steps are the critic's own
  work — a contract gates an outcome, not a step — and a critic must not
  re-delegate from inside the delegation it was given. The critic writes
  `$VERDICT_FILE` on every path, including early-abort, so the gate fails closed
  rather than on a missing file.
- `author-adapter` 6 → 2: the critic hop (`subagent`) and the pre-save verdict
  gate (`shell`). The `echo 'preflight: ok'` gate asserted nothing, the three
  "resolve / gather / draft" `subagent` contracts are the ceremony
  `docs/adapter-authoring-guide.md` already prohibits, and the closing `comment`
  was combined with other types (ADR 0024 §4).
- `adapter-migration` 6 → 2 by the same reading: the critic hop over the
  transformed set, and the verdict gate in front of the batch write. Its report
  file is local, reversible scratch, so it carries no gate, and the
  "recommend running critic-loop after the migration" line became a real review
  *before* the write — a recommendation without a gate was unverifiable.
- `bulk-insert-adapters-via-cli` 4 → 3: the critic hop, the precondition gate in
  front of the directory batch, and a gate on the captured batch report after it.
  A bulk overwrite of a shared space is the bundle's largest irreversible
  boundary, so it earns one gate on each side rather than one per step. The
  `comment` layer is gone, and the flow now states the requirement the CLI
  actually has: `train` rejects a markdown adapter without `review_evidence`, and
  `SQUADRULES_REVIEW_EVIDENCE` is a single blob reused for every file in a
  directory batch — so a per-file review means a per-file export.

### 5. No contract on a result the executor cannot observe

A post-mutation "read back the stored adapter" gate is **not** added as a
contract on an MCP store write. The store is remote; a shell command cannot
observe it on a hosted transport, and inventing one would produce the
`echo "done"` pattern the `critic-loop-guide` already calls worse than no gate.
The read-back stays an instruction and a Reward Signal completion criterion until
either [#101](https://github.com/SquadRules/mcp/issues/101) issues a server-owned
receipt or a local transport makes the read observable — at which point rung 1
applies and the gate becomes real.

Where the write path *does* leave a local artifact, the gate is real and is
required: `bulk-insert-adapters-via-cli` writes the CLI's batch report to a file
and asserts on its contents, because the CLI — not the MCP store — is the
transport there.

## Consequences

### Positive

- The bundle stops teaching self-audit, and the rule is written where authors
  will hit it (the ladder, the `subagent` section, the critic guide) instead of
  living in one adapter's prose.
- Delegation is specifiable: `subagent.mcp` renders the required call as data in
  the challenge, so a weaker agent cannot quietly skip the critic adapter.
- Contract count in the bundled adapters drops from 20 to 8 across the four
  mutated files, removing round trips that proved nothing.
- The `train`/`tune` error path and the tool descriptions now instruct a
  delegation, so the boundary that creates the verdict no longer teaches the
  self-review this record rejects.
- The isolation limit is documented, so a future reader is not misled into
  believing PASS evidence is content-bound.

### Negative

- The server-checked `FORWARD_TARGET_MISMATCH` binding is lost for critic hops.
  Accepted: it protected a target string, not the review.
- On a host with no subagent facility the hop cannot be satisfied honestly. The
  correct behaviour is a blocked run, not a self-review; the adapter text says so,
  and the case is a reopen trigger below.
- `train` and `tune` still accept a self-reported verdict file. This record does
  not fix that, and does not claim to.
- Layer counts change, so the stored system adapters need a structural
  re-`train` (`force_update`), not a prose `tune`.
- `tests/unit/adapter-contract-blocks.test.ts` pinned `author-adapter.md` at six
  blocks; the pin and a new bundle-policy assertion change with it.
- [ADR 0033](0033-gate-scripts-as-adapter-artifacts.md) says a `shell` check with
  more than one condition ships as a gate script artifact. The bundled verdict
  gates here are inline conjunctions and cannot be anything else: a bundled
  system adapter has no artifact-attachment path in this repository —
  `src/embed-docs/` ships markdown only, and `artifact_name` reaches the store
  through `train`, not through boot injection. The gap is recorded, not closed.

## Alternatives Considered

### Keep the `forward` critic hop and mandate subagent execution in prose

Rejected. A prose mandate is the thing this repository keeps discovering it
cannot rely on — the type *is* the instruction the runtime emits, and ADR 0029
exists because prose-only delegation was unverifiable in both directions.

### `subagent` hop plus a shell gate proving the delegation happened

Rejected. Nothing observable distinguishes a delegated review from a verdict the
caller wrote itself. A gate asserting the delegation would assert a claim, which
is the defect being fixed.

### Hard-enforce the rule in the structural validator

Rejected for the reason
[ADR 0024](0024-adapter-contract-verification-ladder.md) §6 gives for the ladder:
the validator cannot tell a critic hop from a chain continuation — both are a
`forward.target` matching `squadrules://adapter/<slug>` — so the rule would need
a table of special cases. Soft-enforced through the guide, the critic checklist,
and the bundled adapters, which the unit test now checks.

### Wait for #101 and keep `forward` until real receipts exist

Rejected. It leaves every adapter in the bundle teaching self-audit indefinitely,
and #101 is explicitly unapproved and cost-undecided. The subagent hop is
strictly closer to the principle and is compatible with #101: when server receipts
land, the same hop gains content binding without changing shape.

## Evidence

- `src/tools/forward-contract-match.ts:17–53` — `FORWARD_TARGET_MISMATCH`, the
  only server-checked delegation binding, and its scope (target string).
- `src/tools/review-evidence-check.ts:18–41` — `assertReviewEvidencePassed`
  validates agent-supplied `exit_code` and `stdout`; the verdict file is never
  read by the server.
- `src/tools/next-pow-challenge-shape.ts:57–63` — the `subagent` challenge
  renders the mandatory delegation line and "The subagent must call these MCP
  tools: …".
- `src/tools/next-pow-helpers.ts:323–327` — subagent proof requires a non-empty
  `evidence.report` and nothing more.
- `src/services/memory/validate-protocol-structure.ts` — `subagent` policy
  accepts `mcp[].tool_name` + `arguments` (`subagent_mcp_invalid`).
- `src/embed-docs/mem/critic-loop-guide.md` ("How to Chain Critic-Loop") — the
  `forward` + slug standard pattern this record supersedes; `author-adapter.md`
  "Invoke critic-loop via `forward`" — its live use.
- `src/embed-docs/tools/forward.md`, `src/embed-docs/tools/train.md`,
  `src/embed-docs/tools/tune.md` and `src/tools/review-evidence-check.ts` — the
  runtime teaching surfaces that repeated the same instruction (a `forward`
  evidence example aimed at `critic-loop`; "Run critic-loop before `train`";
  `next_action: 'call forward with squadrules://adapter/critic-loop to run the
  critic-loop review'`). All are tool descriptions an agent obeys, so they change
  with the rule; `src/resources/embedded-mcp-resources.ts` is regenerated from
  them by `ts-node scripts/build-embed-docs.ts`.
- Fence harvest before the change: `author-adapter` 6, `adapter-migration` 6,
  `critic-loop` 4, `bulk-insert-adapters-via-cli` 4.
- [#97](https://github.com/SquadRules/mcp/issues/97) — caller-supplied verdicts
  can be fabricated; [#101](https://github.com/SquadRules/mcp/issues/101) —
  server-owned critic session with content-bound receipt, unapproved.

## Revisit condition

Reopen when any of these is observed:

- [#101](https://github.com/SquadRules/mcp/issues/101) lands, or any server-side
  review receipt becomes available — then the verdict gate must consume the
  receipt instead of the self-reported file, and Decision §3's limitation is
  retired rather than restated.
- A real host population turns out to lack subagent delegation — then define the
  fail-closed path (blocked run, explicit `verification_blocked`) instead of
  leaving it to adapter prose.
- A critic hop is fabricated in practice (caller writes the verdict, reports a
  delegation it did not make) — evidence that process isolation alone is
  insufficient, which promotes this rule to a receipt requirement.

Track in a new issue; do not rewrite this record.

## Related

- [ADR 0010](0010-critic-loop-and-proof-splitting.md) — the critic loop and
  proof splitting by reversibility cost; unchanged.
- [ADR 0017](0017-critic-loop-work-submission.md) — the typed work submission the
  hop must carry; unchanged.
- [ADR 0024](0024-adapter-contract-verification-ladder.md) — the ladder and
  quantity policy this record applies to the critic hop.
- [ADR 0025](0025-mcp-contract-forward-link-only.md) — already superseded by
  0028; its Evidence entry preserving the mid-adapter
  `forward` → `squadrules://adapter/critic-loop` link is the pattern this record
  retires. Read as history, not as a live rule.
- [ADR 0028](0028-forward-contract-type-rename.md) — `forward` names an adapter
  and nothing else; still true for chain links.
- [ADR 0029](0029-subagent-mcp-and-context-authority.md) — `subagent.mcp` names
  calls executed by the subagent; Decision §2 of this record resolves its
  "never a forward link" clause against the critic hop.
- [ADR 0033](0033-gate-scripts-as-adapter-artifacts.md) — how a `shell` check is
  expressed (one readable line vs a gate script artifact). Orthogonal to this
  record, which decides *whose thread* runs the check; see Consequences →
  Negative for the one place the two rules cannot both be satisfied today.
