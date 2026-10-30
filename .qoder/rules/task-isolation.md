---
trigger: always_on
---

## Task isolation: the main checkout is human-only

Agents never mutate the human's main checkout. Every task that edits files runs
in its own linked worktree, created for that task, with recorded ownership.

This file is the repo-local home of the isolation **constraint** and of the
mechanism that enforces it. It is self-sufficient: it depends on no adapter, no
external service, and no file outside this repository. The mechanism is
[`scripts/agent-task-isolation.py`](../../scripts/agent-task-isolation.py), covered
by
[`tests/scripts/agent-task-isolation.test.mjs`](../../tests/scripts/agent-task-isolation.test.mjs).
Local gates, commit shape, and the push/PR flow are documented in
[CONTRIBUTING.md](../../CONTRIBUTING.md).

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
  commit of the remote default branch (`origin/main` in this repository). Record
  that commit as `TASK_BASE_SHA`.
- Place the worktree outside the human checkout and outside every other existing
  worktree — a sibling `mcp.worktrees/<unique-task-id>` directory.
- Set absolute `REPO_ROOT`, plus unique `TASK_ID` and `TASK_BRANCH`. The script
  derives the worktree path from those and reports it as `WT`; export the value it
  prints.
- Write a task ownership receipt (`squadrules-task.json`) into that worktree's
  own Git administration directory:
  `$(cd "$WT" && git rev-parse --path-format=absolute --git-common-dir)/worktrees/$(basename "$WT")/`.
  Export `TASK_BASE_SHA` for every later shell call, and carry every value through
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

### The mechanism

One command establishes isolation; a second proves it still holds. The script
only reads the repository and writes the task worktree and the task's own Git
metadata — it never touches tracked files in the human checkout. Its docstring
is the specification of how it behaves.

```bash
export REPO_ROOT="$(git rev-parse --show-toplevel)"
export TASK_ID="<unique-task-id>"
export TASK_BRANCH="<unique-feature-branch>"
python3 "$REPO_ROOT/scripts/agent-task-isolation.py" ensure
```

`ensure` takes no mode flag: it starts a new task or continues the existing one
for `TASK_BRANCH`. On success it prints four lines — `TASK_BASE_SHA=`, `WT=`,
`TASK_BRANCH=`, and either `NEW_WORKTREE_FROM_FETCHED_BASE_OK` or
`RESUMED_WORKTREE_OK`. Export `TASK_BASE_SHA` and `WT` from the printed lines.

Before every later mutating call, re-check:

```bash
python3 "$REPO_ROOT/scripts/agent-task-isolation.py" verify
```

`verify` prints `WORKTREE_ISOLATION_OK` plus the same `TASK_BASE_SHA`, `WT`, and
`TASK_BRANCH` values. Any failure prints `FAIL: <reason>` on stderr and exits
non-zero: stop mutating and re-establish isolation. A refused fetch, a
protected branch, a diverged branch, a worktree inside the human checkout, or a
worktree owned by another task is a hard stop — never a reason to fall back to
stale refs or to the main checkout.

If the script is missing from the checkout, that checkout predates this rule —
report it instead of improvising a different isolation mechanism.

### When you notice you are already violating this

Stop mutating. Do not recover by resetting, stashing, or reverting the main
checkout — that destroys human work to hide an agent error. Create the isolated
worktree, redo the change there, and report the deviation and its blast radius
honestly instead of presenting the result as compliant.

### Limits

These are workflow checks, not an OS sandbox. Nothing here technically prevents
an agent from ignoring the rule; the receipt and the pre-mutation check exist so
violations are detectable and attributable after the fact.

The mechanism lives in this repository, so the rule stands alone: a clone is
enough to satisfy it. Hosts that inform agents about this constraint by other
means carry an independent implementation of the same contract, and that is
never a prerequisite for working here.
