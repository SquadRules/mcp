# ADR 0031: Multi-step shell checks ship as adapter artifacts; `shell.cmd` is program text

## Status

Accepted — decision taken 2026-10-26 and implemented by the accompanying change.
Resolves the second revisit condition of
[ADR 0026](0026-shell-interpreter-required.md) (requiring `interpreter` pushed
authors towards `bash` reflexively instead of towards the script-export pattern).

## Context

### 1. `cmd` is program text, not a command line

`buildShellChallengeArgv` builds the challenge argv in
`src/tools/shell-challenge-invocation.ts:86-117`. For every allowed interpreter the
contract's `cmd` is handed to the interpreter as **source code**:

- `bash` → `['bash', '-c', cmd]`
- `sh`, `python3`, `python` → `[…, '-c', cmd]` (`INJECT_C`)
- `node` → `[…, '-e', cmd]` (`INJECT_E`)

`flags` and `args` cannot change that: an explicit `-c` merely replaces the injected
one, and the next argv segment is still `cmd`. So a script **file** is unreachable
from `cmd` under any interpreter. The only way to run one is a wrapper line whose
program is a shell — `interpreter: "bash"`, `cmd: python3 "$DIR/artifacts/x.py"` —
or a `python3 -c 'runpy…'` program, which is just a different inline program.

### 2. The artifact path existed at runtime but was undocumented everywhere authors look

Artifacts are real: `train` accepts non-markdown bodies (`mime`, `artifact_name`,
`adapter_uri`, `relative_path`), `export` ships them in `skill_zip`/`skill_tree`,
and `activate` match choices carry `linked_artifacts[]` with `relative_path`,
`sha256`, `download_url`, and a ready-made `materialize` command, with
materialize-first guidance in `next_action`.

None of that was documented at an author-facing home before this change:

- `src/embed-docs/tools/train.md` described only markdown input — no `mime`,
  `artifact_name`, `adapter_uri`, or `relative_path`, and no artifact identity
  header (`# squadrules-artifact:`), which `src/services/memory/artifact-metadata.ts`
  implements and which decides artifact deduplication.
- `src/embed-docs/tools/activate.md` omitted `linked_artifacts` from its output
  description, so the materialize command was undiscoverable.
- `docs/adapter-authoring-guide.md` and `docs/examples/challenge-types.md` told
  authors to "export the script and pick `node` / `python3` matching the project
  type" — an instruction that cannot work, per §1.

### 3. The only executable option left produced an unreadable contract

An adapter authored against that documentation inlined one escaped multi-step
Python guard into every one of its `shell` contracts — the same roughly 2 KB single
line, repeated per step, with `"interpreter":"bash"` and `python3` as the first
`cmd` word. That is precisely the symptom ADR 0026's revisit condition anticipated.

The adapter is user-space content stored outside this repository and is not part of
this change; §2 above is the repository-visible cause.

The multi-step check is not the problem. A program escaped into one 2 KB line per
step is: it cannot be reviewed, linted, unit-tested, or diffed, and a fix to the
guard has to be re-escaped into every copy.

### 4. The advertised path was not executable on the default transport

`activate`'s `materialize` command for stdio transport was
`export --uri … --format source > <path>`. Three independent defects: `export` has
no `--uri` flag (positional `<uri>`), `--format` is the output-render flag while the
content flag is `--as`, and `export` never writes content bytes to stdout — it
writes files and prints a manifest. The command failed for every agent.

## Decision

1. **`shell.cmd` is documented as program text** for every allowed interpreter, in
   the authoritative field reference (`docs/examples/challenge-types.md`). No
   `script` field, no server-side path interpolation, no new contract type.
2. **A check with more than one condition, JSON parsing, or more than one readable
   line ships as a gate script artifact** attached to the adapter with `train`, and
   the contract stays a one-line invocation of it through a shell wrapper:
   `interpreter: "bash"`, `cmd: python3 "$SQUADRULES_LOCAL_ARTIFACT_DIR/<relative_path>" --gate <name>`.
3. **This adds no verification rung.** The artifact executes *inside* rung 1
   ([ADR 0024](0024-adapter-contract-verification-ladder.md)); the pass condition is
   still the script's exit code. It is not an alternative to an observable check.
4. **Artifacts attach to an existing adapter**, so authoring is two `train` calls in
   a fixed order: markdown first, artifact second. The script carries a
   `# squadrules-artifact:` header (`slug`, `version`) so a re-train updates the same
   artifact instead of adding a second one.
5. **`activate`'s `linked_artifacts[]` is the discovery surface.** Authoring is not
   complete until `activate` shows a `relative_path` equal to the path the contract
   invokes. Agents run that row's `materialize` command before the first contract
   that needs the file. `forward` does not repeat the list.
6. **The `materialize` command must run on the transport it is emitted for.** stdio
   (no HTTP listener) uses `squadrules export --as source --to <path>`; HTTP uses
   `curl`. The stdio branch is fixed by this change and covered by unit and
   integration tests; the builder lives in `src/tools/artifact-materialize-command.ts`.

## Consequences

### Positive

- The contract line stays auditable: a reviewer reads one line and knows which
  script runs and which gate.
- The gate is testable without SquadRules (`python3 <script> --gate <name>`), so a
  failure is reproducible and fixable as ordinary code.
- One script serves many gates and many adapters; a fix propagates.
- The script body is bounded by `train`'s artifact size limits rather than by the
  adapter's 350-line budget, so heavy checks stop competing with prose for space.

### Negative

- Authoring is two calls with an ordering constraint, and the artifact train needs
  `adapter_uri` — an author who trains the script first gets an error.
- Artifact paths are not re-derived by hand: authors must re-run `activate` to read
  `relative_path`, and the agent must materialize before the first dependent
  contract. A run that skips materialize fails at the shell step, not at activate.
- `forward` does not carry `linked_artifacts`, so a chained adapter cannot assume a
  sibling's script is present; it attaches the script itself.

## Evidence

- `src/tools/shell-challenge-invocation.ts:86-117` — argv construction for all five
  interpreters.
- `docs/examples/challenge-types.md`, `docs/adapter-authoring-guide.md` — the
  unexecutable "export the script and pick `node` / `python3`" instruction that
  §2 identifies as the cause, replaced by this change.
- `src/embed-docs/tools/train.md`, `src/embed-docs/mem/challenge-type-guide.md`,
  `src/embed-docs/mem/author-adapter.md`, `src/embed-docs/tools/activate.md` — the
  artifact contract, the recipe, and `linked_artifacts[]`, added by this change.
- `docs/examples/artifact-gate/adapter-example-artifact-gate.md` with
  `docs/examples/artifact-gate/artifact-gate-check.py` — trainable example carrying
  a real `# squadrules-artifact:` header. It sits in its own directory because a
  directory `train` batch attaches every sibling artifact to every `.md` in that
  directory (`src/cli/train-batch.ts`, `listSkillFiles`), so a shared parent would
  put the gate script on seven unrelated examples.
- `tests/unit/artifact-materialize-command.test.ts`,
  `tests/integration/cli-export-selection.test.ts` — the stdio materialize command
  produces the file at the exact expected path.

## Revisit condition

Reopen if the shell contract gains a first-class way to name a script file (a
`script` field, or server-resolved artifact interpolation in `cmd`), which makes the
wrapper line redundant. Also reopen if documented adapters still inline multi-step
programs — then the fix is a structural rule in
`validate-protocol-structure.ts` (reject a `cmd` above a byte ceiling or containing
newlines when the adapter has an artifact-bearing variant), not more prose. Track via
a new issue; do not rewrite this record.

## Related

- [ADR 0026](0026-shell-interpreter-required.md) — the interpreter field. This
  record resolves its second revisit condition.
- [ADR 0024](0024-adapter-contract-verification-ladder.md) — the ladder. Artifacts
  are an implementation detail *inside* rung 1.
- [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md) — an autonomous
  run needs a contract an agent can execute without asking a human what it meant.
