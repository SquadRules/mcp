# ADR 0009: Bundled adapters execute autonomously; human confirmation gates removed

## Status

Accepted

## Context

The bundled meta-adapters under `src/embed-docs/mem/` were authored under an
earlier, lower-trust operating model. That model embedded human-in-the-loop
`user_input` gates at points where an agent could instead decide and verify on its
own:

- `create-new-protocol` — a "Confirm Intent" gate before authoring and a
  "User Review" acknowledgment gate after phase-critic.
- `bulk-insert-adapters-via-cli` — a "Confirm Scope" gate and an
  "ask user whether to skip invalid files" decision.
- `adapter-migration` — a "Review the migration report… apply / select / abort"
  gate, and a description that re-trained "only after user approval".
- `phase-critic-guide` — a "Mutation Gate Pattern" that prescribed a
  `user_input` pre-mutation confirmation prompt for irreversible remote actions.

The project's operating principle has shifted to **AI ownership with autonomous
execution**: agents are expected to resolve intent from context, verify their work
against objective evidence, and proceed without stopping for human confirmation.
Quality is enforced by the phase-critic loop (loop until the verdict is `PASS`) and
by objective, machine-checkable contracts — not by a human approval click.

## Decision

Bundled adapters execute autonomously. Human `user_input` confirmation and
approval gates are removed from the shipped bundle:

1. **Intent is resolved, not confirmed.** `create-new-protocol` infers the
   operation and target and proceeds; the "Confirm Intent" and "User Review"
   gates become autonomous `comment` contracts that record the inference and the
   phase-critic verdict. The contract-block count is preserved at 8.
2. **Phase-critic is a self-loop.** On `FAIL`, the agent addresses findings and
   re-invokes phase-critic automatically until `PASS`. No human is asked whether
   to continue. The existing `FAIL` shell gate remains the mechanical guard.
3. **Remote mutations use objective gates, not prompts.** The mutation-gate
   pattern replaces the `user_input` pre-confirmation with a pre-mutation
   readiness check (shell/mcp) plus post-mutation verification that reads the
   remote state back. `train`/`tune` still enforce phase-critic `PASS` evidence at
   the tool level.
4. **Batch operations proceed on defaults.** `bulk-insert` and `adapter-migration`
   apply their conservative, reversible transformations and report results rather
   than pausing for a human choice; genuinely unsafe items
   (`needs_manual_review`) are left untouched and reported.

`user_input` remains a valid challenge type and is retained where a human is the
only correct source of truth — genuine intent ambiguity (`refine-search`) and the
schema documentation in `challenge-type-guide`.

## Consequences

### Positive

- Fewer round-trips: adapters run end-to-end without waiting on a human.
- The quality bar is unchanged and now mechanical: phase-critic `PASS` plus
  objective pre/post verification, both machine-checkable.
- Consistent with the AI-ownership operating model across the whole bundle.

### Negative

- No human veto immediately before an irreversible remote mutation. Mitigated by
  objective pre-mutation readiness checks, post-mutation verification, the
  phase-critic loop, and — for repository changes — branch protection and PR
  review, which remain the human control point.
- Agents must be capable of resolving intent correctly; genuinely ambiguous
  requests still escalate to the user by design.

## Alternatives Considered

### Keep human confirmation gates

Retain `user_input` gates for safety. Rejected: it contradicts the AI-ownership
principle and adds latency without adding an objective guarantee — the phase-critic
loop and verification contracts already provide the guarantee.

### Remove the `user_input` challenge type entirely

Rejected: the type is still correct for genuine clarification (`refine-search`)
and is part of the contract schema; only its use as an approval gate is removed.

## Evidence

- Unit lane: 99 suites / 575 tests passed, 0 failures.
- `tests/unit/adapter-contract-blocks.test.ts` (create-new-protocol keeps exactly
  8 contract blocks) and `tests/unit/validate-protocol-structure.test.ts` pass.
- `npm run lint`, `npm run typecheck`, `npm run knip`, and
  `version:check-skills` all exit 0.
- No `"type":"user_input"` contract remains in the four de-gated files; the single
  reference in `challenge-type-guide` is intentional schema documentation.

## Revisit condition

Reopen this decision if autonomous execution of an irreversible remote mutation
causes an incident that an objective pre/post check did not prevent. Track via a
new issue; do not rewrite this record.

## Related

- [ADR 0002: Boot-injection reuse rule](./0002-boot-injection-reuse-rule.md) —
  edited adapters re-inject on the next release version bump or
  `MEM_BOOT_FORCE_INJECT=true`.
- `src/embed-docs/mem/phase-critic-guide.md` — mutation-gate pattern.
