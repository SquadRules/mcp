# 0037 — Branch-aware Qoder wiki lifecycle with isolated bootstrap

Status: Proposed — implemented in the accompanying PR; acceptance requires CI evidence.
Date: 2026-10-31

## Context

[Issue #205](https://github.com/SquadRules/mcp/issues/205) records repeated
`docs.yml` failures: Qoder's incremental `--update` rejects `main/en` even though
65 completed wiki items exist. The committed metadata identifies
`wiki_repo.name = prune-agent-assets-20261013` and the original branch
`chore/prune-agent-assets`; the Actions checkout has a different repository
directory name (`mcp`) and runs on `main`. A branch-only checkout fix
([PR #160](https://github.com/SquadRules/mcp/pull/160)) did not fix this
generated-wiki identity mismatch.

The documentation authority rule forbids manual edits to
`.qoder/repowiki/en/content/` and `.qoder/repowiki/en/meta/`.
A previous PR attempting unconditional full regeneration
([#158](https://github.com/SquadRules/mcp/pull/158)) was closed without merge.
Full generation and forced `--regenerate` cannot be assumed harmless to
existing content or Qoder credits.

## Decision

1. **Select by actual generation identity.** Use the committed metadata's
   repository name, `extend_info.branch`, language, completed state, wiki
   items and actual Markdown pages. A complete `main/en` wiki for checkout
   directory `mcp` receives `--update`. Absent, incomplete or foreign-branch
   output receives an initial, non-forced `wiki` generation (bootstrap).
   Malformed JSON fails rather than being silently replaced.
2. **Run only in a disposable checkout.** Clone the checked-out commit into a
   temporary directory ending in `/mcp`, on branch `main`, and always pass
   `--branch main --language en`. For bootstrap, discard the old
   `.qoder/repowiki/en/` tree only inside that clone. The original wiki
   remains untouched until generation and validation complete.
3. **Forced rebuild is an explicit maintenance action.** Add a
   `workflow_dispatch` input `mode=regenerate`. Routine source and plan
   changes default to auto mode; no CI failure automatically escalates to
   `--regenerate`.
4. **Validate before publishing.** Require completed metadata with matching
   repository, branch and language, and nonempty generated pages. Refuse a
   generated page count below 60% of the previous committed count. If Qoder
   fails or validation rejects its output, leave the original wiki untouched
   and report a failing job.
5. **Publish through the existing guarded PR path.** Copy validated generated
   wiki and knowledge files back, stage with `git add -A` so additions and
   deletions are detected, and create a docs PR using the installed SquadRules
   GitHub App. Pass the exact PR number and head commit to the auto-merge job.
   Retain required CI checks and avoid selecting a PR by its author or label.
6. **Keep generation and publication separate.** `docs.yml` updates the
   source-of-truth generated tree; the existing GitHub Wiki synchronization
   workflow remains responsible for publishing it.

## Consequences

- One-time bootstrap of the old `chore/prune-agent-assets` wiki into
  `main/en` may incur Qoder generation cost, but avoids editing generator-owned
  metadata by hand.
- Subsequent successful runs should reuse the newly generated identity through
  `--update`; an explicit full rebuild remains possible without exposing the
  current committed wiki to in-place deletion.
- A major deliberate catalog shrink below the safety threshold needs an
  explicit policy change/review, not an automatic destructive merge.
- The workflow no longer treats successful exit from Qoder as sufficient proof
  of safe output, and new untracked files no longer disappear from change
  detection.
- The Qoder CLI remains an external dependency. CI must confirm bootstrap
  behavior with the real configured token before this record's status is
  reconciled to Accepted.

## Verification

- Unit coverage: `tests/scripts/wiki-generation-state.test.mjs` exercises
  missing, valid, foreign-branch, malformed, and truncated wiki states.
- Workflow contract:
  `tests/scripts/docs-workflow-scope.test.mjs` checks dispatch semantics,
  disposable checkout, update/bootstrapping commands, staged changes,
  authentication and PR identity handoff.
- End-to-end evidence required: an authenticated `docs.yml` run on
  `main` opens a valid wiki PR; that PR passes the repository's existing
  required checks; a later run chooses incremental mode. Do not claim the
  bootstrap is proven until those runs succeed.

## Related

- [Issue #205](https://github.com/SquadRules/mcp/issues/205)
- [ADR 0032](0032-change-class-routing-for-required-ci-gates.md) — required
  CI evidence and the initial Qoder failure diagnostics.
