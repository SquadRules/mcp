# ADR 0024: Adapter contract verification ladder and quantity policy

## Status

Accepted — decision taken 2026-10-21 and implemented by the accompanying change;
not yet on `main` when this record was written.

## Context

A verification contract is the only thing that separates "the adapter ran" from
"the adapter's work is true". [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md)
removed the human approval gates and made objective, machine-checkable contracts
the guardrail in their place. Nothing then said **which** contract type an author
should reach for, or **how many**.

Two consequences followed.

**Contract choice became whichever type was cheapest to write.** The bundled
adapters under `src/embed-docs/mem/` verify overwhelmingly by assertion rather
than by observation. Counted over parsed ```` ```json ```` layer-contract blocks:

| Type | `src/embed-docs/mem/` | `docs/examples/` |
| --- | --- | --- |
| `comment` | 37 | 14 |
| `shell` | 12 | 2 |
| `mcp` | 13 | 3 |
| `subagent` | 1 | 0 |
| `user_input` | 1 | 2 |

A `comment` contract asks the executing agent to write down that it did the work.
It is satisfied by the same agent that would have skipped the work, so it records
intent, not outcome — precisely the failure the development constitution's
"verify the real outcome" requirement forbids. The concentration is worst in the
adapters that teach authoring: `author-adapter.md` carries 7 `comment` contracts
and 1 `shell` contract, `protocol-linking-guide.md` 7 `comment` and 0 `shell`,
`adapter-migration.md` 5 `comment` and no empirical check at all.

**No preference ordering existed to argue against.**
`docs/adapter-authoring-guide.md` states the choice is "purpose-based, not a
universal ranking", and `src/embed-docs/mem/challenge-type-guide.md`'s decision
tree terminates at `"comment" only if there is no stronger observable contract` —
a tie-breaker with no order above it. An author who wanted the cheapest contract
could not be told they were wrong, because the documents declined to rank.

A third defect sits underneath: `subagent` is a valid contract type in every
runtime schema (`InferenceContractType` in `src/types/memory.ts`,
`src/tools/forward_schema.ts`, `src/tools/next_schema.ts`,
`src/services/proof-of-work-store.ts`) and `challenge-type-guide.md` documents
and uses it, but `ALLOWED_CONTRACT_TYPES` in
`src/services/memory/validate-protocol-structure.ts` is
`{shell, mcp, user_input, comment, tensor}` — it omits `subagent`. Training the
very adapter that teaches the type therefore fails `invalid_contract_type`. The
rung of the ladder best suited to delegated judgment was unusable.

Requirements for this area were spread across
[PR #138](https://github.com/SquadRules/mcp/pull/138) until they were lost, then
re-unified in `.local/requirements-from-chat-4887f3f2.md`. That note is itself
lossy, and the "ADR 0024" it cites never landed. This record is that ADR.

## Decision

### 1. Verification is an ordered ladder; the first applicable rung wins

1. **`shell` empirical check.** The step produces something observable — a file,
   an exit status, a git ref, a line in a report. Assert it. This is the default
   and the strongest rung: the gate observes the work rather than a claim about
   it.
2. **`subagent` critic.** The step's correctness needs judgment that cannot be
   reduced to a test — requirement coverage, tone, whether a diff matches its
   stated intent. Delegate to `critic-loop` and loop to `PASS`
   ([ADR 0010](0010-critic-loop-and-proof-splitting.md),
   [ADR 0017](0017-critic-loop-work-submission.md)).
3. **`subagent` performing the MCP call.** The step needs a SquadRules or other
   MCP tool result as evidence. Delegate the call to a subagent so the tool
   transcript lands in the subagent's context and only its report returns. This
   is the escape hatch that keeps MCP tool work out of the caller's thread — the
   reason [ADR 0025](0025-mcp-contract-forward-link-only.md) can restrict `mcp`
   contracts to chain links.

**Fallback — a single `comment` acknowledgement.** Only where the adapter
produces no observable artifact and no judgment is required: a read-only or
knowledge adapter whose whole output is guidance the agent has now read.

Descend the ladder only when the higher rung genuinely cannot apply, and say why
in the adapter text. "Was faster to write" is not a reason.

### 2. `subagent` is a first-class contract type

`subagent` is added to `ALLOWED_CONTRACT_TYPES`. It is the correct type for
delegated judgment (rung 2) and for delegated MCP tool work (rung 3). Its proof
is the subagent's actual report, not the caller's summary of it — the runtime
already requires `evidence.report`
(`src/tools/next-pow-helpers.ts`).

### 3. One contract per adapter by default

The desired count is **one** verification contract per adapter. Shell checks are
safety gates, not puzzles: minimal, focused on protecting the critical operation.

Additional `shell` gates are justified only before an action that is hard to roll
back — the classic case is work committed and pushed on `main` before anyone
noticed the branch was wrong, which then needs a new branch and a PR. Genuinely
executable adapters whose steps each carry their own irreversible boundary may
have one gate per boundary; that is
[ADR 0010](0010-critic-loop-and-proof-splitting.md)'s proof-splitting rule, not a
quantity exemption.

The minimum is always 1: a `shell` empirical check, or a `subagent` critic, or a
`comment` acknowledgement for a read-only adapter. An adapter with no contract
block at all is already a structural failure (`contract_block`).

### 4. `comment` is a last resort, narrowly bounded

- At most **one** `comment` contract per adapter.
- **Never combined** with another contract type. An adapter that has any
  observable step does not also get an acknowledgement layer.
- Used only where rungs 1–3 cannot apply.

### 5. Explicit exemptions

Judgment rules need named exceptions or they get ignored:

- **Knowledge and reference adapters** get exactly one closing acknowledgement.
  `bulk-insert-adapters-via-cli.md` and similar guidance adapters have no
  artifact to assert.
- **`docs/examples/adapter-twelve-step-linear-test.md`** is a designated UI and
  long-run test fixture. Its 12 `comment` layers are the thing under test —
  sequential layer progression and widget rendering — not a verification
  strategy. The ≤1 rule does not apply to it, and it carries a marker saying so.

### 6. Enforcement split: soft rules stay soft

Rungs 1–5 are **soft-enforced**: the flow doc
(`docs/adapter-authoring-guide.md`), the `critic-loop` review checklist, and the
`author-adapter` authoring checklist. They are *not* structural validator rules.

The reason is the exemptions in §5. A structural validator cannot distinguish "12
comments because this is the fixture that tests 12 layers" from "12 comments
because the author gave up" without a table of special cases, and a rule with a
table of special cases is a judgment rule wearing a badge. The hard, fail-closed
rules are the objective ones: [ADR 0025](0025-mcp-contract-forward-link-only.md)
(`mcp_link_only`) and [ADR 0026](0026-shell-interpreter-required.md)
(`shell_interpreter_required`). Only §2 is code in this record, and it is a
one-line set addition.

## Consequences

### Positive

- Verification becomes honest by default: the ladder's first rung observes the
  work instead of trusting a note about it.
- Authors get an ordering to apply and a reason to state when they descend, which
  is reviewable. The critic-loop has a concrete checklist instead of a taste
  judgment.
- `subagent` stops being a type that is documented, schema-supported, and then
  rejected at `train` — the contradiction that made
  `challenge-type-guide.md` untrainable is removed.
- Bundled adapters shrink. 37 `comment` contracts in `src/embed-docs/mem/`
  collapse towards one per adapter, and the 350-line ceiling
  (`src/config/adapter-markdown-size-limits.ts`) gets easier to meet.

### Negative

- Soft rules can be ignored by an agent that never reads the flow doc. Mitigated
  three ways: the critic-loop reviews against the ladder, `author-adapter`
  carries the checklist at the point of authoring, and a unit test validates
  every `src/embed-docs/mem/*.md` so the shipped examples cannot drift from the
  rule they teach.
- Every bundled adapter and example that currently leans on `comment` must be
  rewritten. From the counts above: `author-adapter.md` (7), `protocol-linking-guide.md`
  (7), `challenge-type-guide.md` (5), `adapter-migration.md` (5),
  `skill-format-guide.md` (5), `bulk-insert-adapters-via-cli.md` (2),
  `critic-loop-guide.md` (2), `critic-loop.md` (2). Eight of those also combine
  `comment` with another type, which §4 forbids outright.
- Rung 3 costs a subagent round-trip where a bare `mcp` contract cost one tool
  call. Accepted: the round-trip buys a clean caller context, which is the point.
- The exemptions in §5 are a standing invitation to argue that some other adapter
  is also exempt. They are named, closed, and must be extended by a new record.

## Alternatives Considered

### Hard-enforce the comment ceiling and the ladder in the structural validator

Rejected. It breaks the deliberate 12-layer UI fixture, every knowledge adapter,
and most validator test fixtures, and it would need a growing allowlist to keep
them working. These are judgment rules with legitimate exceptions, so they belong
with the critic — the design principle is to use judgment where observation is
insufficient, and to fail closed only where observation is sufficient.

### Keep "purpose-based, not a universal ranking"

Rejected. The absence of a ranking is exactly why comment-only verification
spread to 37 contracts. Authors need a default they must argue out of, and the
exceptions are few and enumerable (§5). "It depends" is not a reviewable
instruction for a less capable model.

### Erase the `comment` contract type

Rejected. Read-only and knowledge adapters produce no observable artifact; a
single acknowledgement is the honest minimum for them. Removing the type would
push authors to fake a `shell` gate — and a gate that asserts nothing
(`echo "done"`) is worse than no gate, because it looks like one
([ADR 0010](0010-critic-loop-and-proof-splitting.md)).

### Rank the `subagent` critic above the `shell` empirical check

Rejected. A critic reviews a claim about the work; a shell gate observes the
work. Where observation is possible it is strictly better evidence, and the critic
should spend its budget on what observation cannot reach. Ranking the critic first
would let every authorable check become a review.

### One contract per layer instead of one per adapter

Rejected. It reproduces the per-step proof placement that
[ADR 0010](0010-critic-loop-and-proof-splitting.md) already removed for adding
round-trips on reversible work without adding guarantee.

## Evidence

Counts above are parsed ```` ```json ```` fences with a top-level `contract` key —
the same shape `findAllLayerContractBlocks`
(`src/services/memory/adapter-contract-blocks.ts`) feeds the validator — so
illustrative solution shapes and non-contract examples are excluded.

- `src/services/memory/validate-protocol-structure.ts` — `ALLOWED_CONTRACT_TYPES`
  omits `subagent` while `INVALID_CONTRACT_TYPE`'s message enumerates only
  "tensor, shell, mcp, user_input, or comment".
- `src/types/memory.ts` — `InferenceContractType` includes `subagent`;
  `src/services/proof-of-work-store.ts` — `ProofOfWorkType` excludes only `tensor`.
- `src/tools/forward_schema.ts`, `src/tools/next_schema.ts`,
  `src/tools/next-pow-challenge-shape.ts` — `subagent` accepted end to end;
  `src/tools/next-pow-helpers.ts` requires `subagent.report`.
- `src/embed-docs/mem/challenge-type-guide.md` — documents `subagent`, uses it in
  one layer contract, and its decision tree ends at `comment` with no ordering
  above it.
- `docs/adapter-authoring-guide.md` — "purpose-based, not a universal ranking",
  the line this record replaces.
- `docs/examples/adapter-twelve-step-linear-test.md` — 12 `comment` layer
  contracts; the §5 fixture exemption.
- `.local/requirements-from-chat-4887f3f2.md` §2, §3 — the ladder and quantity
  requirements as stated by the owner, including the minimum-always-1 rule.
- [PR #138](https://github.com/SquadRules/mcp/pull/138) — the spread that lost
  these requirements.

## Revisit condition

Reopen if the soft ladder proves unenforceable in practice — specifically, if an
adapter ships with `comment`-only verification past a critic-loop review, or if a
reviewer cannot tell from the adapter text why a rung was skipped. The fix then is
to promote §4 (comment ceiling, never combined) into the structural validator
with the §5 exemptions expressed as data rather than as prose. Also reopen if a
legitimate exemption class appears that ≤1 closing acknowledgement cannot express.
Track via a new issue; do not rewrite this record.

## Related

- [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md) — autonomous
  execution made objective contracts the guardrail; this record says which one to
  pick.
- [ADR 0010](0010-critic-loop-and-proof-splitting.md) — proof splitting by
  reversibility cost; the quantity rule in §3 is its per-adapter expression, and
  rung 2 is its critic loop.
- [ADR 0017](0017-critic-loop-work-submission.md) — what the rung-2 critic is
  handed: a typed work submission, not an essay about the work.
- [ADR 0025](0025-mcp-contract-forward-link-only.md) — `mcp` restricted to chain
  links; rung 3 is where the displaced MCP tool work goes.
- [ADR 0026](0026-shell-interpreter-required.md) — rung 1's hard structural rule.
- `docs/adapter-design-principles.md` — the principle layer (autonomy,
  help-not-puzzles, honest verification) this record makes concrete.
- `docs/adapter-authoring-guide.md` — the flow layer that carries the ladder and
  the per-type rules.
