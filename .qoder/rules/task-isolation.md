---
trigger: always_on
---

## Task isolation: the main checkout is human-only

Agents never mutate the human's main checkout. Every task that edits files runs
in its own linked worktree, created for that task, with recorded ownership.

This file is the repo-local home of the isolation **constraint**. The executable
workflow steps around it (local gates, Conventional Commit shape, push/PR flow)
live in the SquadRules adapters `git-commit-protocol` and `git-pr-protocol`.

### Why

One repository is shared by a human and by several concurrent agents. An agent
that edits the main checkout can clobber uncommitted human work, commit on the
wrong branch, or adopt another task's half-finished state as its own. Isolation
bounds each task's blast radius to its own directory, and the ownership receipt
makes "whose work is this?" answerable from evidence rather than from asking.

### Must never

- Edit files, change the branch or index, stash/reset/clean, install
  dependencies, or run generators, builds, or tests in the **main checkout** —
  the first `worktree` entry of `git worktree list --porcelain`. Inspecting it,
  fetching remote refs, and registering linked worktrees are permitted, as are
  the shared Git metadata updates those need. Existing human changes stay put.
- Commit on `main`, or anywhere inside the main worktree.
- Start a task from local `main`, implicit `HEAD`, or another task's branch.
  Fetch failure is a hard stop, not permission to use stale refs.
- Invent an ownership receipt for a checkout you did not create, or adopt a
  worktree whose ownership you cannot verify. Missing evidence means fresh
  isolation, not adoption.
- Relocate, overwrite, revert, or clean someone else's changes to recover from
  your own mistake.
- Remove a worktree that is not this task's. Retain failed worktrees for
  inspection.

### Must always

- Before the first edit of every new task: `git fetch origin`, then create a
  fresh linked worktree and a unique feature branch from the exact fetched
  `origin/main` commit. Record that commit as `TASK_BASE_SHA`.
- Place the worktree outside the human checkout and outside every other existing
  worktree — a sibling `mcp.worktrees/<unique-task-id>` directory.
- Set absolute `REPO_ROOT` and `WT`, plus unique `TASK_ID` and `TASK_BRANCH`.
- Write a task ownership receipt (`squadrules-task.json`) into that worktree's
  Git administration directory:
  `$(cd "$WT" && git rev-parse --git-common-dir)/worktrees/<task-id>/`. Export
  `TASK_BASE_SHA` for every later shell call, and carry all four values through
  the commit-to-PR handoff.
- Run every edit, dependency install, formatter, build, test, commit, and CI
  repair inside `$WT`. Configure non-shell file tools with absolute paths under
  `$WT` too — a relative path silently resolves to the human checkout.
- Keep scratch, proof, PR-title, and PR-body files in task-owned storage:
  `$WT/.local/` (gitignored, travels with the task). Do not add your scratch to
  `.local/` in the main checkout.
- Re-check isolation before each mutating call and after any context switch. A
  failed check stops the mutation.
- Treat freshness as measured at task creation. Later commits on `main` do not
  invalidate `TASK_BASE_SHA`; updates and rebases for this task happen only in
  its own worktree.
- Continue the SAME task in its verified worktree, branch, and receipt. A NEW
  task gets new ones.
- Remove only this task's worktree, after verified delivery, without switching
  the root checkout's branch.

### When you notice you are already violating this

Stop mutating. Do not recover by resetting, stashing, or reverting the main
checkout — that destroys human work to hide an agent error. Create the isolated
worktree, redo the change there, and report the deviation and its blast radius
honestly instead of presenting the result as compliant.

### Limits

These are workflow checks, not an OS sandbox. Nothing here technically prevents
an agent from ignoring the rule; the receipt and the pre-mutation check exist so
violations are detectable and attributable after the fact.

The SquadRules adapters carry their own copy of this contract because adapters
are portable across repositories and must not assume a repo file exists. That
duplication is deliberate, and it creates a sync obligation: **when you change
this rule, `tune` the `git-commit-protocol` and `git-pr-protocol` adapters to
match, and the reverse.**
