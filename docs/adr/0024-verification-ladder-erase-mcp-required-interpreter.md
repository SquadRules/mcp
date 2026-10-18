# ADR 0024: Verification ladder; `mcp` challenge type erased; shell `interpreter` required

## Status

Accepted (extends [0009](./0009-autonomous-adapter-execution-no-human-gates.md),
[0010](./0010-critic-loop-and-proof-splitting.md),
[0012](./0012-redirect-tombstones-for-renamed-slugs.md))

## Context

Adapters ask an agent to prove it did a step by satisfying a layer **contract**.
The server recognised six proof types: `tensor`, `shell`, `user_input`,
`comment`, `subagent`, and `mcp`. The `mcp` type checked that the agent had
called a particular MCP tool (optionally with a matching argument set), and
`subagent` checked that it delegated a step to another agent/thread. Both were
documented as ordinary ways to record "I did the authoritative thing".

In practice that framing let weak evidence masquerade as verification: an `mcp`
contract could be satisfied by any call to a named tool, and long inline `shell`
`cmd` strings had degraded into clever, brittle one-liners rather than honest
gates. Meanwhile the `shell` contract ran commands through a hidden default
interpreter (`bash -c` on POSIX) even though some interpreters (`python`,
`node`) behave differently per platform. The team decided, across two rounds of
critic-loop review, to make the verification policy explicit and to remove the
types and defaults that enabled the weak patterns.

## Decision

**1. A verification ladder is the documented order of evidence quality.** For
any step that needs more than a textual acknowledgement, prefer in this order:

1. A **`shell` empirical check** — a real, observable safety gate (a file
   written, a command exit code, a directory state).
2. A **critic-loop `subagent` call** — adversarial review of the step's output,
   looped until it returns `PASS`.
3. A **`subagent` instructed to call the MCP tool** and verify its outcome from
   a re-read. This is the honest replacement for what `mcp` tried to do: the
   delegation context names the tool and the verify-after-reread, and the
   returned report is the evidence.
4. Fallback: a single `comment` acknowledgement.

**2. The `mcp` challenge type is erased**, not deprecated. It is removed from
the type union, the `next`/`forward` schemas, the runtime matchers, the
display strings, the UI, the guidance, the bundled adapters, the examples, and
the tests. There is no dual-read path: a legacy stored `mcp` layer fails closed
on `forward` with a redirect to the `subagent` pattern in
`challenge-type-guide`. The erasure ships as an **announced breaking change**
delivered as a `feat` (release-please minor) rather than a major bump — the
human chose minor-version visibility over a major bump for a removal.

**3. `interpreter` on a `shell` contract is REQUIRED, with no default.** A
`shell` contract must name one of `bash | sh | python3 | python | node`. The
`next`/`forward` schemas require it, and the **import/training path rejects a
`shell` contract without it** so nothing can land without an explicit
interpreter. The runtime invoker likewise errors on a missing/unknown
interpreter instead of silently defaulting.

**4. Shell contracts are safety gates, not puzzles.** A `shell` `cmd` stays
short and readable — it checks a precondition or an observable outcome. When a
step genuinely needs multi-line or structured logic (anything that parses or
reshapes **JSON**, loops, or does real data manipulation), the adapter attaches a
**script artifact** to its frontmatter; the executing agent exports that
artifact into its working directory and invokes it. The script language matches
the repository: **`node`** for this JS/TS project, **`python3`** where Python is
the surrounding tooling. A **`bash`** script is fine when it only touches files
and text with little data shaping; the moment JSON is involved, use `node` or
`python3`. This is the repo's standing rule: *bash is for files,
Node/Python is for data.*

**5. One contract per adapter is the default.** A guidance or knowledge document
carries a single `comment` acknowledgement, not a contract per section. More
contracts appear only under a **special circumstance**: a genuinely executable
adapter whose steps each need their own objective gate (e.g. `author-adapter`,
whose per-layer counts are pinned by `adapter-contract-blocks.test.ts`). Types
are never mechanically swapped to preserve a count.

**6. `user_input` is an emergency gate only.** It remains in the schema and is
retained solely for (a) a human explicitly requiring involvement, or (b) a
dangerous operation where a human answer materially raises the agent's
confidence. It is **never** a post-critic-FAIL approval or a routine
confirmation. Default posture is full autonomy with report-and-stop on blockers.

**7. Five bundled adapters were erased and their names are lint-forbidden.** The
`phase-critic` / `phase-critic-guide` / `create-new-protocol` redirect tombstones
(mechanism recorded in ADR 0012, now superseded) and the `adapter-migration` /
`bulk-insert-adapters-via-cli` executable adapters were deleted from
`src/embed-docs/mem/`, and the slug-alias / redirect-tombstone resolver
(`src/utils/adapter-alias.ts`, `isRedirectTombstone`, `resolveAdapterSlugAlias`,
`REDIRECT_TOMBSTONE_SLUGS`) was dismantled. The retired slugs were added to the
`squadrules-forbidden-text` eslint rule so any lingering **code** reference fails
`npm run lint`; markdown records (ADRs, README) sit outside that rule's scope
(eslint ignores markdown) and may still cite the names as history. This accepts
that external stored adapters pointing at a retired slug now fail to resolve —
the same clean-break posture as the `mcp` erasure.

## Consequences

### Positive

- Evidence quality is ordered and stated, so an agent cannot satisfy a step with
  the weakest tool-shaped proof.
- Every shell gate is platform-explicit; the hidden `bash` default that made
  `python`/`node` contracts silently diverge is gone.
- Complex verification moves into owned, reviewable script artifacts rather
  than opaque inline one-liners.
- The contract surface is smaller and each type has one clear role.

### Negative

- **Breaking:** any stored adapter layer or example that carried an `mcp`
  contract, or a `shell` contract without `interpreter`, no longer validates;
  `forward` fails closed on legacy `mcp` layers. Mitigated by the boot-injection
  version bump re-injecting the corrected bundled copies and by
  `adapter-migration`.
- Requiring `interpreter` touches every shell contract in the bundle and the
  examples; each must name its interpreter.

## Alternatives Considered

- **Deprecate `mcp` and keep it read-only.** Rejected: the human chose a clean
  erasure; a dual-read path keeps the weak pattern alive.
- **Keep `interpreter` optional with a `bash` default.** Rejected by the team:
  an explicit interpreter is required for cross-platform honesty, and the
  import path must reject its absence.
- **Preserve per-document contract counts by retyping blocks.** Rejected: the
  desired count is one acknowledgement per doc; counts change only where an
  adapter's steps are independently executable and gated.

## Evidence

- `src/services/utils/shell-challenge-invocation.ts` — `SHELL_INTERPRETERS`
  (`bash, sh, python3, python, node`) and the per-interpreter invocation table;
  the invoker builds `bash -c` / `python3 -c` / `node -e`.
- `src/services/memory/adapter-contract-blocks.ts` — the fence parser the bundle
  policy gate reuses; a `contract` object is counted only in a line-start
  ` ```json ` fence, so worked examples are indented out of the count.
- `tests/unit/next-pow-challenge-shape.test.ts` and `tests/unit/train_*` —
  assert shell-schema requiredness and that `train`/`tune` reject a contract
  missing a required `interpreter`.
- `docs/adr/0009`, `0010`, `0017` — the autonomy, critic-loop, and work-submission
  decisions this refines.

## Revisit condition

Reopen if an erased `mcp` surface proves necessary for a class of step the
ladder cannot verify, or if requiring `interpreter` causes more friction than the
platform divergence it prevents. Track via a new issue; do not rewrite this record.

## Related

- [ADR 0009](./0009-autonomous-adapter-execution-no-human-gates.md) — autonomy,
  human gates removed (this adds the ladder and the `interpreter`/script rules).
- [ADR 0010](./0010-critic-loop-and-proof-splitting.md) — critic-loop as the
  quality mechanism.
- [ADR 0012](./0012-redirect-tombstones-for-renamed-slugs.md) — **superseded**
  here: the redirect-tombstone mechanism and the alias resolver are erased.
- [ADR 0016](./0016-explicit-adapter-authoring-context.md) — authoring context
  retained; its `create-new-protocol` tombstone is erased here.
- [ADR 0017](./0017-critic-loop-work-submission.md) — critic-loop work submission.
- `src/embed-docs/mem/README.md`, `src/embed-docs/mem/challenge-type-guide.md`,
  and `eslint/plugins/squadrules-forbidden-text.cjs` — the operative authoring
  guidance and the lint enforcement of the erased names.
