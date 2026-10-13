# ADR 0010: Rename phase-critic to critic-loop; split proofs by reversibility cost

## Status

Accepted — extends [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md).
Its "no compatibility alias" decision is refined by
[ADR 0012](0012-redirect-tombstones-for-renamed-slugs.md) for deeply-referenced
slugs.

## Context

ADR 0009 removed human confirmation gates and made the bundled adapters
autonomous, leaning on two guardrails: the critic review and objective
machine-checkable contracts. Three problems remained:

- **The critic's name undersold its contract.** `phase-critic` is named for *when*
  it runs (at a phase boundary), which reads as a one-shot step. In practice the
  calling protocol must **loop** it until the verdict is `PASS`. Agents treated it
  as fire-once and moved on after a single review.
- **A review that only sees the output cannot detect an omitted requirement** —
  omission leaves no trace in the artifact — so "no requirements were lost" was
  hoped for, not enforced. And "loop until PASS" had no termination bound.
- **Proofs were placed per step.** That adds round-trips (hoops) on reversible
  work while the real, irreversible risk sits at a few boundaries.

The operating principle is AI ownership with autonomous execution: give the agent
more freedom and fewer hoops, but guardrail it with (a) cost-avoidance at the
points of no return and (b) one strong terminal critic.

## Decision

Adopt a **two-layer guardrail model** and rename the critic to match its contract.

1. **Rename `phase-critic` to `critic-loop`** everywhere: slug, title, both file
   names, and every `squadrules://adapter/phase-critic` forward/chain URI. The slug
   is load-bearing in source schemas (`train_schema`, `tune_schema`,
   `review-evidence-check`, `mcp-tool-input-teaching`), the regenerated
   `embedded-mcp-resources.ts`, unit and integration tests, and every **stored
   adapter** that forwards to it. The rename is backward-incompatible *in principle*
   — a stored adapter forwarding to the old slug must be re-pointed — but the
   project currently has a single consumer (the owner) and no external integrations,
   so it ships as a **non-breaking refactor**: no compatibility alias and no
   major-version bump; re-pointing the owner's stored adapters is left to the
   owner. "Loop" tells the agent the critic must be *satisfied*, not run once.
2. **The critic loop is fed the requirements and bounded.** Its input contract
   carries the original `requirements` list plus `iteration` / `max_iterations`;
   the verdict asserts requirement-by-requirement coverage (`requirement_gap` on a
   miss) and stops at the ceiling (`iteration_ceiling`) instead of thrashing.
3. **Proofs split by reversibility cost, then batch.** One objective proof per
   **irreversibility boundary** — commit to `main`, mutate the human's active
   worktree, `git push`, `gh pr create`, deploy, send — including the cheap local
   precondition that guards it (verify worktree and branch *before* changing
   anything). Reversible, checkable steps are batched into a single aggregate
   proof that is a **strict conjunction** re-verifying each sub-condition
   (`A && B && C && echo OK`). An aggregate proof must never degrade to
   `echo "done"`: a proof that asserts nothing is worse than no gate because it
   looks like one.
4. **Non-deterministic or unproofable work goes to the critic loop after
   execution**, not a faked proof. The critic loop does **not** replace a boundary
   proof: the critic runs after the fact, the boundary proof runs before the
   irreversible step.

## Consequences

### Positive

- The name states the contract: agents loop the critic until `PASS`.
- "No requirements lost" becomes enforceable (the critic sees the list) and the
  loop terminates (ceiling).
- Fewer hoops on reversible work; proofs concentrate at the points of no return.

### Negative

- **Backward-incompatible slug.** A stored adapter or external integration
  forwarding to `squadrules://adapter/phase-critic` would break silently until
  re-pointed. Accepted without a major-version bump because the project has a
  single consumer (the owner) and no published integrations; re-pointing adapters
  the owner stores is the owner's call. Revisit if external consumers appear.
- Authors must write real conjunctions rather than a single lazy assert.

## Alternatives Considered

### Rename the concept but keep the slug stable (or add a compat alias)

Rename prose and title to "Critic Loop" while leaving the slug `phase-critic`, or
introduce `critic-loop` alongside a deprecated alias. Rejected: an alias keeps two
live slugs indefinitely and splits the forward/chain graph. With a single consumer
and no published integrations, one clean rename is cheaper than a deprecation shim.

### Keep per-step proofs

Rejected: more round-trips without a stronger guarantee; batching into a strict
conjunction preserves the guarantee at lower cost.

## Evidence

- 131 `phase-critic` occurrences renamed across 20 files; 2 files renamed
  (`critic-loop.md`, `critic-loop-guide.md`); `embedded-mcp-resources.ts`
  regenerated. Only generated `.qoder/repowiki/**` retains the old name pending
  Qoder regeneration (never hand-edited).
- Unit lane: 99 suites / 575 tests passed. `npm run lint`, `npm run typecheck`,
  `npm run knip`, and `version:check-skills` all exit 0.
- `tests/unit/adapter-contract-blocks.test.ts` (create-new-protocol keeps exactly
  8 contract blocks) and `tests/unit/validate-protocol-structure.test.ts` pass.

## Revisit condition

Reopen if external consumers adopt the adapter slugs — making the rename genuinely
breaking, so a compatibility alias or slug-migration tool becomes necessary — or if
a batched strict-conjunction proof is found to hide a failed sub-condition. Track
via a new issue; do not rewrite this record.

## Related

- [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md) — autonomous
  execution; its `phase-critic` references are renamed to `critic-loop` by this
  record (decision unchanged).
- `src/embed-docs/mem/critic-loop.md` — the loop contract (requirements, ceiling).
- `src/embed-docs/mem/critic-loop-guide.md` — proof-splitting and mutation-gate
  placement rules.
