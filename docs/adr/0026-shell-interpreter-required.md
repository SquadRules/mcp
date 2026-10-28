# ADR 0026: Shell interpreter field is required (no default)

## Status

Accepted — decision taken 2026-10-21 and implemented by the accompanying change;
`shell_interpreter_required` is on `main` (`validate-protocol-structure.ts`). Its
second revisit condition — requiring the field pushes authors towards `bash`
reflexively instead of the script-export pattern — **fired** and is resolved by
[ADR 0033](0033-gate-scripts-as-adapter-artifacts.md); the requirement itself stands.

## Context

A `shell` contract is rung 1 of the verification ladder
([ADR 0024](0024-adapter-contract-verification-ladder.md)): the empirical check
that observes the work instead of trusting a claim about it. Its argv is built by
`buildShellChallengeArgv` in `src/tools/shell-challenge-invocation.ts`, and the
executing agent runs that argv locally — the server never spawns a process for a
contract.

The interpreter set was announced and restricted in v5.10.1
([#103](https://github.com/SquadRules/mcp/issues/103),
[#110](https://github.com/SquadRules/mcp/pull/110)): `SHELL_INTERPRETERS` is
`bash | sh | python3 | python | node`, and
`src/embed-docs/mem/challenge-type-guide.md` states the restriction in prose —
"the `interpreter` field in shell contracts accepts only" those five, and build
tools such as `terraform`, `docker`, and `npm` are not interpreters.

What shipped is a field that is **optional in every layer** and **silently
defaults to `bash`**:

- `src/types/memory.ts:42` — `interpreter?: ShellInterpreter`.
- `src/tools/next_schema.ts:62` — `interpreter: z.enum(SHELL_INTERPRETERS).optional()`.
- `src/tools/shell-challenge-invocation.ts:79` — `if (!interp || interp.toLowerCase() === 'bash')`
  collapses "absent" and "bash" into one branch, and the function's own doc
  comment states the behaviour: "Default path: no interpreter or bash →
  `bash -c cmd`".
- `src/ui/i18n/en.json:194` — the editor label reads `"Interpreter (optional)"`,
  and `src/ui/hooks/useProtocol.ts` assigns the field only when it is truthy, so
  the UI can save a shell step with no interpreter at all.
- `src/embed-docs/tools/` — the authoritative execution contract documentation
  does not mention `interpreter` anywhere.

So the announced contract and the enforced contract disagree, and the disagreement
is invisible: an omitted field does not fail, it quietly means `bash`.

**Every shell contract in the repository omits it.** Counted over parsed
```` ```json ```` layer-contract blocks, there are 14 `shell` contracts — 12 in
`src/embed-docs/mem/` (`critic-loop-guide.md` 5, `bulk-insert-adapters-via-cli.md`
3, `critic-loop.md` 2, `author-adapter.md` 1, `challenge-type-guide.md` 1) and 2
in `docs/examples/` — and **zero** specify `interpreter`. The field exists, is
documented as restricted, and has never once been used. The silent default is the
only reason none of them fails.

A second defect sits in the same guide. `challenge-type-guide.md`'s
"Interpreter Selection" table recommends **`perl`** for multi-line regex,
paragraph processing, and JSON validation. `perl` is not in `SHELL_INTERPRETERS`.
An author who follows the table produces a contract the announced enum rejects —
while the same file's "Interpreter restriction" paragraph, 160 lines later,
correctly lists the five allowed values. The table and the restriction contradict
each other, and only the optional field with its silent `bash` default keeps the
contradiction from surfacing.

There are no live instances. SquadRules/mcp has no deployed store — local,
scrappable stores only — so no stored adapter depends on the default, and nothing
outside this repository has to migrate.

## Decision

Every `shell` contract **must** specify `interpreter`, chosen from the allowed set
`bash | sh | python3 | python | node`.

1. **The field is required, not optional.** `InferenceContractDefinition.shell.interpreter`
   in `src/types/memory.ts`, `ShellChallengeFields.interpreter` in
   `src/tools/shell-challenge-invocation.ts`, and `challengeSchema.shell.interpreter`
   in `src/tools/next_schema.ts` all lose their `?`.
2. **The `bash` default is removed.** `buildShellChallengeArgv` no longer has a
   `!interp` branch. Absent interpreter is not a request for `bash`; it is an
   invalid contract. `bash` remains a legal *value* and keeps its `-c` argv shape.
3. **Missing interpreter is a structural validation error.** A new `missing` code,
   `shell_interpreter_required`, is reported by
   `src/services/memory/validate-protocol-structure.ts` and surfaces through
   `train` (`PROTOCOL_STRUCTURE_INVALID`) and the CLI upload guards. A value
   outside the allowed set is rejected by the existing enum.
4. **No grace window and no deprecation period.** This is not a new requirement
   being imposed; it is the announced v5.10.1 contract finally being enforced. With
   no live instances there is nothing to phase, and a grace window would only
   prolong the disagreement between the two contracts.
5. **The UI stops advertising the field as optional.** `protocolEdit.shellInterpreter`
   loses "(optional)" and the editor requires a selection before save.
6. **The guide's interpreter table is corrected.** `perl` is removed; the rows map
   onto the allowed five, and the documented shell contract format includes
   `interpreter`.

Complex operations continue to use the script-export pattern already described in
`challenge-type-guide.md`: attach the script to the adapter, export it into the
workdir at execution time, and prefer `node` or `python3` matching the project
type — `bash` only where data manipulation is minimal, and never once JSON is
involved.

## Consequences

### Positive

- The announced contract and the enforced contract agree. An author reading
  `challenge-type-guide.md`'s restriction paragraph gets the behaviour the
  validator produces.
- The argv a contract will run is fully specified by the contract. Reviewing an
  adapter no longer requires knowing an undocumented default to predict what
  executes.
- The `perl` contradiction is resolved by removal rather than by an author
  discovering it at execution time on a host without `perl`.
- Hard-enforced and objective: a presence check plus an existing enum, so
  fail-closed produces no false positives.

### Negative

- All 14 bundled and example `shell` contracts must gain `interpreter`. Every one
  of them is `bash`-shaped today (`test -f`, `grep -q`, `git rev-parse`,
  `head -1`, `squadrules --version`), so each takes `"interpreter":"bash"` and its
  argv is unchanged. The edit is mechanical, but it touches
  `critic-loop-guide.md`, `bulk-insert-adapters-via-cli.md`, `critic-loop.md`,
  `author-adapter.md`, `challenge-type-guide.md`, `adapter-example-shell.md`, and
  `adapter-example-all-types.md` — and per
  [ADR 0002](0002-boot-injection-reuse-rule.md) each edited `mem/` file needs a
  `version:` frontmatter bump plus regeneration of
  `src/resources/embedded-mcp-resources.ts`.
- The required type cascades. `src/tools/squadrules-challenge-display.ts` branches
  on `interpreter !== undefined` and appends a "ensure the interpreter is on PATH"
  hint conditionally; that branch becomes unconditional.
  `src/ui/hooks/useProtocol.ts`, `src/ui/pages/protocol-edit/ProtocolEditStepCard.tsx`,
  and `src/ui/i18n/en.json` all change, so `tsconfig.ui.json` typecheck is part of
  the gate.
- A stored adapter trained before this change with no interpreter would fail
  re-validation on `tune`. Accepted: there are no live instances, and
  `MEM_BOOT_FORCE_INJECT` re-trains the bundled set from source, which is being
  updated in the same change.
- Authors lose the convenience of omission. Accepted: the convenience was the
  defect — it is why the field has never been used.

## Alternatives Considered

### Keep the field optional and default to `bash`, but document the default

Rejected. It leaves the announced enum advisory, keeps the argv under-specified by
the contract, and preserves the exact disagreement between documentation and
behaviour that this record exists to remove. Documenting a silent default does not
make an author choose an interpreter; it makes the omission look intentional.

### Infer the interpreter from the command text

Rejected. Inference is a guess about author intent embedded in a safety gate —
`python3 -c '...'` and a `bash` command that happens to contain `python3` are not
distinguishable by pattern without a parser, and a wrong inference runs the wrong
program. [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md) made
contracts the guardrail that replaced human approval; a guardrail that guesses is
not one.

### Add a grace window or a deprecation warning first

Rejected. There are no live instances and no external consumers, so there is
nothing to phase. The field was already announced as restricted in v5.10.1; a
grace window would re-negotiate a contract that was published, and the owner's
instruction is to fix reality rather than re-announce it.

### Default to `sh` instead of `bash`

Rejected. It changes the argv of every existing contract — `sh` takes `-c` but is
not `bash`, and the bundled gates use `bash`-shaped commands — to solve a problem
that requiring the field already solves. Choosing a different silent default is
still a silent default.

## Evidence

- `src/tools/shell-challenge-invocation.ts:14-16` — `SHELL_INTERPRETERS` and its
  `(#103)` citation; `:71` doc comment "Default path: no interpreter or bash →
  `bash -c cmd`"; `:79` the `!interp` default branch this record removes.
- `src/types/memory.ts:42` — `interpreter?: ShellInterpreter`.
- `src/tools/next_schema.ts:62` — `interpreter: z.enum(SHELL_INTERPRETERS).optional()`.
- `src/ui/i18n/en.json:194` — `"protocolEdit.shellInterpreter": "Interpreter (optional)"`;
  `src/ui/hooks/useProtocol.ts:227-228` — assigned only when truthy.
- `src/tools/squadrules-challenge-display.ts:47-57` — conditional PATH hint and
  conditional field emission.
- `src/services/memory/validate-protocol-structure.ts` — checks only that
  `contract.type` is in `ALLOWED_CONTRACT_TYPES`; it never inspects the `shell`
  payload, so no `shell_interpreter_required` code exists yet.
- `src/embed-docs/mem/challenge-type-guide.md:77` — documented shell contract
  format omits `interpreter`; `:191-198` the "Interpreter Selection" table
  recommending `perl`; `:357-359` the "Interpreter restriction" paragraph listing
  the five allowed values. The two contradict each other.
- `src/embed-docs/tools/` — no occurrence of `interpreter` in the authoritative
  execution contract documentation.
- `CHANGELOG.md` — v5.10.1 "clarify adapter boundaries and restrict interpreter
  enum ([#103](https://github.com/SquadRules/mcp/issues/103))
  ([#110](https://github.com/SquadRules/mcp/pull/110))": the announcement this
  record catches up to.
- Counted contract blocks: 14 `shell` contracts across `src/embed-docs/mem/` and
  `docs/examples/`, 0 with `interpreter`.

## Revisit condition

Reopen if a legitimate sixth interpreter is needed — a host whose only available
shell is outside the five, or a contract whose correct executor is `ruby`, `pwsh`,
or `perl` — which would mean extending `SHELL_INTERPRETERS` rather than relaxing
the requirement. Also reopen if requiring the field is found to push authors
towards `bash` reflexively rather than towards the script-export pattern for
JSON-shaped work, which would make the interpreter *choice* (not its presence) the
thing needing guidance. Track via a new issue; do not rewrite this record.

## Related

- [ADR 0024](0024-adapter-contract-verification-ladder.md) — the ladder. This is
  the hard structural rule behind rung 1, and §6 of that record explains why the
  ladder itself stays soft.
- [ADR 0025](0025-mcp-contract-forward-link-only.md) — the sibling hard rule,
  landing in the same table-driven validator change.
- [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md) — autonomous
  execution requires contracts explicit enough to be trusted without a human
  reviewing the argv.
- [ADR 0010](0010-critic-loop-and-proof-splitting.md) — batched strict-conjunction
  gates are the shell contracts this rule makes fully specified.
- [ADR 0002](0002-boot-injection-reuse-rule.md) — the version bump and re-injection
  the bundled `mem/` edits require.
