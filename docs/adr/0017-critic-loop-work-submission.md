# ADR 0017: Critic-loop reviews a typed work submission, not a single input file

## Status

Accepted — extends [ADR 0010](0010-critic-loop-and-proof-splitting.md).

## Context

The critic's contract, since the rename, is to challenge work **before** the
caller proceeds — and, when there is no later step, before the work is presented
to the human. Its input contract, however, still named exactly one artifact:
`input_file: string` — "absolute path to the document under review". That field
is a leftover from the original one-shot document review, and it does not match
the work this team actually produces: a change is a diff, an open PR, a handful
of files, the output of a migration command, or a link to what got published.

Two failure modes followed from that mismatch:

- **The critic gets skipped.** A caller with no single document concludes it has
  nothing to hand over and moves on.
- **The critic reviews an essay.** The caller writes a summary of the work and
  passes that as `input_file`. The critic then verifies the summary's internal
  consistency, which is not the same as verifying the work — and an omitted
  requirement leaves no trace in either text.

There was also no place to state what the critic should do when an item cannot be
read. "Cannot fetch this URL" and "fetched it, and the claim is wrong" collapsed
into the same review, weakening the verdict.

## Decision

Keep `critic-loop` a single adapter and broaden what it can be given.

1. **The submission is typed.** `work` carries a `kind`, an `items` list, and the
   absolute `root` the items resolve against. Six kinds: `file_set`, `links`,
   `git_diff`, `pr`, `command_output`, `inline`. The submission is the work
   itself, not a description of it.
2. **The handoff stays a file.** `work` is recorded in the file pointed to by
   `$WORK_MANIFEST` as flat keys (`kind:`, `root:`, then `items:` one per line)
   so the precondition remains a machine-checkable shell test instead of prose.
   The precondition contract becomes "a submission handoff exists":
   `test -f "${WORK_MANIFEST:-}" || test -f "${INPUT_FILE:-}"`.
3. **`input_file` survives as an accepted alias**, meaning a one-item `file_set`.
   Callers outside this repository already pass it: a stored user-space adapter
   instructs the agent to hand the commit's work over as `input_file`. Dropping
   the field would break those callers for no functional gain — the same
   reasoning that keeps redirect tombstones in
   [ADR 0012](0012-redirect-tombstones-for-renamed-slugs.md).
4. **A new `Resolve Submission` layer** sits between Precondition Check and
   Audit. It resolves every item by kind, records the resolved inventory the
   audit is limited to, and classifies anything unresolvable as
   `verification_blocked` — an item the critic could not read is never counted as
   an item that passed.
5. **Diffs and PRs are judged on the diff.** Claims from a `git_diff` or `pr`
   submission are verified against the changed lines and the tests they touch,
   never against the description written alongside them.
6. **The kinds are an adapter contract, not a validated wire format.** `forward`
   carries only `uri` and an optional `solution`, and the server never inspects
   what the critic reviews. The objective floors are unchanged: the handoff file
   test and the verdict-file shape. Requirement coverage is still enforced only
   against the supplied `requirements` list.

## Consequences

### Positive

- The critic is usable for every shape of work, so "no input file" stops being a
  reason to skip the review.
- Unresolvable items fail loudly as `verification_blocked` instead of silently
  narrowing the review.
- No migration is forced: `input_file` callers, the verdict handoff, and the
  `review_evidence` gate used by `train` / `tune` are untouched.

### Negative

- Content of the submission is not server-enforced; the contract holds because
  the adapter text says so.
- Two spellings of the same input (`work_manifest` and the older `input_file`) exist
  until callers migrate.
- `git_diff` and `pr` depend on host tooling (`git`, `gh`) and repository access;
  on a host without them those kinds resolve to `verification_blocked`.
- `critic-loop.md` grows by one layer (3 → 4 contract blocks).

## Alternatives Considered

### Add a `work` field to the `forward` input schema

Rejected for now. It changes the versioned MCP surface every client sees, and the
critic is a prompt-level adapter whose input the server has never read. It becomes
the right move only if submission content must be enforced — see Revisit condition.

### Keep one `input_file` and require a written work summary

Rejected: it reviews prose about the work rather than the work, which is the
failure this record exists to remove.

### One adapter per submission kind

Rejected: six copies of the same review discipline, with the evidence hierarchy,
requirement coverage, and verdict rules drifting apart.

## Evidence

- `src/embed-docs/mem/critic-loop.md` — typed `work` in the Artifact Contract,
  the handoff-exists precondition contract, and the new `Resolve Submission`
  layer.
- `src/embed-docs/mem/critic-loop-guide.md` — the kind table and the
  `verification_blocked` rule, next to the unchanged FAIL gate contract.
- `src/embed-docs/mem/phase-critic.md` and `src/embed-docs/mem/author-adapter.md`
  are the two other places that named `input_file`; both now speak of the
  submission, and `author-adapter` keeps its asserted 8 contract blocks.
- No server code changed: before this work the only tracked sources naming
  `input_file` were those three adapter files plus the generated embed resource.
- Local gates on the task worktree (Node 26.10.0, `npm ci` from lockfile): unit lane
  102 suites / 603 tests passed (2 suites / 6 tests skipped); `npm run lint`,
  `npm run typecheck`, `npm run knip`, `npm run version:check-skills`,
  `npm run test:spec-parity` (28) and `npm run test:ui` (69) all exit 0.
  `tests/unit/validate-protocol-structure.test.ts` and
  `tests/unit/validate-adapter-markdown-size.test.ts` pass, so the 8-contract-block
  assertion and the size ceiling still hold with `critic-loop` at 288 lines and 4
  contract blocks. Integration suites were not run locally — they need the CI
  cluster stack; the PR's Cluster and Single lanes carry that proof.
- `export` of a stored user-space adapter shows a
  `Phase-Critic Review` layer that passes "this work" as `input_file` and forwards
  to the `phase-critic` tombstone slug — direct evidence that the alias is load-
  bearing outside this repository, and that this change needed to be additive.

## Revisit condition

Reopen if the convention proves unenforceable in practice — specifically, if a
run reports a review over items it could not resolve, or a `pr`/`git_diff` review
passes on its description. The fix then is a `work` field on the `forward` input
schema so the resolved inventory can be validated, and an objective (shell)
contract for `Resolve Submission`. Track via a new issue; do not rewrite this
record.

## Related

- [ADR 0009](0009-autonomous-adapter-execution-no-human-gates.md) — autonomous
  execution; review replaces human confirmation gates.
- [ADR 0010](0010-critic-loop-and-proof-splitting.md) — the loop contract,
  requirement coverage, and proof splitting this record extends.
- [ADR 0012](0012-redirect-tombstones-for-renamed-slugs.md) — why `input_file`
  is kept as an alias rather than removed.
