#!/usr/bin/env python3
"""Task isolation helper: establish and verify an isolated linked worktree.

The human's main checkout stays read-only for agents. Every task that edits
files runs in its own linked worktree with a recorded ownership receipt.

Subcommands:

  ensure  create the isolated worktree for this task: a fresh branch from the
          fetched base when the branch is new, the existing branch (fast
          forwarded to its remote) when the task continues work on it
  verify  prove the task's worktree is isolated and still owned by this task

Input comes from the environment:

  REPO_ROOT    repository to work in; defaults to this script's own repository
  TASK_ID      unique id for this task (one path segment)
  TASK_BRANCH  branch to create or reuse
  WT           absolute path of the task worktree; derived when absent

Output on stdout (success):

  TASK_BASE_SHA=<commit>              commit this task was branched from
  WT=<path>                           the task worktree
  TASK_BRANCH=<branch>                the task branch
  NEW_WORKTREE_FROM_FETCHED_BASE_OK   new task / RESUMED_WORKTREE_OK continued
  WORKTREE_ISOLATION_OK               verify

Every failure prints "FAIL: <reason>" on stderr and exits 1. A failed fetch is
a hard stop, never a fallback to stale refs or to the main checkout.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

PROTECTED_BRANCHES = {"main", "master", "trunk", "develop", "development"}
RECEIPT_NAME = "squadrules-task.json"


class IsolationError(Exception):
    """A condition that makes isolation impossible; reported as FAIL."""


def git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True
    )


def run_git(root: Path, *args: str) -> str:
    """Run git in `root` and return stdout, raising IsolationError on failure."""
    proc = git(root, *args)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip().splitlines()
        tail = detail[-1] if detail else f"exit {proc.returncode}"
        raise IsolationError(f"git {' '.join(args)} failed: {tail}")
    return proc.stdout.strip()


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise IsolationError(f"{name} is not set")
    return value


def repo_root() -> Path:
    """The repository to work in: REPO_ROOT, else this script's own repository."""
    configured = os.environ.get("REPO_ROOT", "").strip()
    if configured:
        root = Path(configured).expanduser().resolve()
        if not (root / ".git").exists():
            raise IsolationError(f"REPO_ROOT is not a git checkout: {root}")
        return root
    candidate = Path(__file__).resolve().parents[1]
    if not (candidate / ".git").exists():
        raise IsolationError(
            "REPO_ROOT is not set and this script is not inside a git checkout"
        )
    return candidate


def task_id() -> str:
    value = require_env("TASK_ID")
    if "/" in value or value in {".", ".."}:
        raise IsolationError(f"TASK_ID must be a single path segment: {value}")
    return value


def main_worktree(root: Path) -> Path:
    """The first entry of `git worktree list --porcelain` is the main checkout."""
    for line in run_git(root, "worktree", "list", "--porcelain").splitlines():
        if line.startswith("worktree "):
            return Path(line[len("worktree ") :].strip()).resolve()
    raise IsolationError("could not determine the main worktree")


def fetch_origin(root: Path) -> None:
    """Fetch origin. A fetch failure is a hard stop, not permission to use stale refs."""
    proc = git(root, "fetch", "--prune", "origin")
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip().splitlines()
        tail = detail[-1] if detail else f"exit {proc.returncode}"
        raise IsolationError(f"git fetch origin failed (hard stop): {tail}")


def base_branch(root: Path) -> str:
    """Default branch of the remote, from origin/HEAD, with a main fallback."""
    proc = git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if proc.returncode == 0 and proc.stdout.strip():
        ref = proc.stdout.strip()
        return ref[len("origin/") :] if ref.startswith("origin/") else ref
    for candidate in ("main", "master"):
        if git(root, "rev-parse", "--verify", "--quiet", f"origin/{candidate}").returncode == 0:
            return candidate
    raise IsolationError("cannot determine the remote default branch (origin/HEAD is unset)")


def base_sha(root: Path, branch: str) -> str:
    return run_git(root, "rev-parse", f"origin/{branch}")


def branch_exists(root: Path, branch: str, remote: bool = False) -> bool:
    ref = f"refs/remotes/origin/{branch}" if remote else f"refs/heads/{branch}"
    return git(root, "show-ref", "--verify", "--quiet", ref).returncode == 0


def worktree_path(main: Path, tid: str) -> Path:
    """The worktree lives beside the main checkout, outside it: <repo>.worktrees/<task-id>."""
    override = os.environ.get("WT", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return main.parent / f"{main.name}.worktrees" / tid


def admin_dir(wt: Path) -> Path:
    """Git's administration directory for a linked worktree."""
    common = run_git(wt, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return Path(common) / "worktrees" / wt.name


def receipt_base(wt: Path) -> dict:
    """The receipt as a dict, or an empty dict when it is absent or unreadable."""
    receipt = admin_dir(wt) / RECEIPT_NAME
    if not receipt.exists():
        return {}
    try:
        data = json.loads(receipt.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def write_receipt(wt: Path, tid: str, branch: str, base: str, main: Path) -> Path:
    target = admin_dir(wt)
    target.mkdir(parents=True, exist_ok=True)
    receipt = target / RECEIPT_NAME
    created_at = datetime.now(timezone.utc).isoformat()
    if receipt.exists():
        created_at = receipt_base(wt).get("created_at", created_at)
    payload = {
        "task_id": tid,
        "task_branch": branch,
        "task_base_sha": base,
        "worktree": str(wt),
        "repo_root": str(main),
        "created_at": created_at,
    }
    receipt.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return receipt


def assert_worktree_path_safe(main: Path, wt: Path) -> None:
    """The worktree must live outside the human checkout, never inside it."""
    if wt == main or main in wt.parents:
        raise IsolationError(f"the worktree must live outside the main checkout: {wt}")


def assert_not_main(main: Path, wt: Path) -> None:
    """The worktree must be a linked worktree, never the main checkout itself."""
    if wt == main:
        raise IsolationError(f"the main checkout is not an isolated worktree: {wt}")
    git_dir = Path(run_git(wt, "rev-parse", "--path-format=absolute", "--git-dir")).resolve()
    common = Path(run_git(main, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve()
    if git_dir == common:
        raise IsolationError(f"the main checkout is not an isolated worktree: {wt}")


def cmd_ensure() -> int:
    """One command for both task modes: a new branch, or an existing one."""
    root = repo_root()
    tid = task_id()
    branch = require_env("TASK_BRANCH")
    if branch in PROTECTED_BRANCHES:
        raise IsolationError(f"TASK_BRANCH must not be a protected branch: {branch}")

    main = main_worktree(root)
    wt = worktree_path(main, tid)
    assert_worktree_path_safe(main, wt)

    fetch_origin(root)
    base = base_branch(root)
    sha = base_sha(root, base)

    local = branch_exists(root, branch)
    remote = branch_exists(root, branch, remote=True)

    if local or remote:
        if not wt.exists():
            wt.parent.mkdir(parents=True, exist_ok=True)
            if local:
                run_git(root, "worktree", "add", str(wt), branch)
            else:
                run_git(root, "worktree", "add", "--track", "-b", branch, str(wt), f"origin/{branch}")
        else:
            top = run_git(wt, "rev-parse", "--show-toplevel")
            if Path(top).resolve() != wt:
                raise IsolationError(f"WT is not the top level of its worktree: {wt}")
            current = run_git(wt, "rev-parse", "--abbrev-ref", "HEAD")
            if current != branch:
                raise IsolationError(f"worktree {wt} is on {current}, expected {branch}")
            # An existing worktree belongs to exactly one task. Missing or
            # foreign ownership evidence means fresh isolation, not adoption.
            owner = receipt_base(wt).get("task_id")
            if owner is None:
                raise IsolationError(
                    f"ownership receipt missing for {wt}; refusing to adopt it"
                )
            if owner != tid:
                raise IsolationError(
                    f"worktree {wt} is owned by task {owner!r}, not {tid!r}"
                )
        if remote:
            run_git(wt, "merge", "--ff-only", f"origin/{branch}")
        # A continued task keeps the base it was branched from; only a first
        # sighting of an existing branch derives it from the merge base.
        resumed_base = receipt_base(wt).get("task_base_sha")
        if not isinstance(resumed_base, str) or not resumed_base:
            merged = git(wt, "merge-base", f"origin/{base}", branch)
            resumed_base = merged.stdout.strip() if merged.returncode == 0 else sha
        write_receipt(wt, tid, branch, resumed_base, main)
        reported_base = resumed_base
        state = "RESUMED_WORKTREE_OK"
    else:
        if wt.exists():
            raise IsolationError(f"worktree path already exists: {wt}")
        wt.parent.mkdir(parents=True, exist_ok=True)
        run_git(root, "worktree", "add", "-b", branch, str(wt), sha)
        write_receipt(wt, tid, branch, sha, main)
        reported_base = sha
        state = "NEW_WORKTREE_FROM_FETCHED_BASE_OK"

    print(f"TASK_BASE_SHA={reported_base}")
    print(f"WT={wt}")
    print(f"TASK_BRANCH={branch}")
    print(state)
    return 0


def cmd_verify() -> int:
    root = repo_root()
    tid = task_id()
    main = main_worktree(root)
    wt = worktree_path(main, tid)
    if not wt.exists():
        raise IsolationError(f"worktree does not exist: {wt}")

    assert_worktree_path_safe(main, wt)
    assert_not_main(main, wt)

    top = run_git(wt, "rev-parse", "--show-toplevel")
    if Path(top).resolve() != wt:
        raise IsolationError(f"WT is not the top level of its worktree: {wt}")

    branch = run_git(wt, "rev-parse", "--abbrev-ref", "HEAD")
    if branch in PROTECTED_BRANCHES:
        raise IsolationError(f"the task branch must not be a protected branch: {branch}")

    expected = os.environ.get("TASK_BRANCH", "").strip()
    if expected and branch != expected:
        raise IsolationError(f"branch is {branch}, expected {expected}")

    receipt = receipt_base(wt)
    if not receipt:
        raise IsolationError(f"ownership receipt missing for {wt}")
    if receipt.get("task_id") != tid:
        raise IsolationError(
            f"receipt task_id {receipt.get('task_id')!r} does not match {tid!r}"
        )
    if receipt.get("task_branch") != branch:
        raise IsolationError(
            f"receipt task_branch {receipt.get('task_branch')!r} does not match {branch!r}"
        )

    print(f"TASK_BASE_SHA={receipt.get('task_base_sha', '')}")
    print(f"WT={wt}")
    print(f"TASK_BRANCH={branch}")
    print("WORKTREE_ISOLATION_OK")
    return 0


COMMANDS = {"ensure": cmd_ensure, "verify": cmd_verify}


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in COMMANDS:
        print(
            f"FAIL: usage: {Path(argv[0]).name} {{ensure|verify}}", file=sys.stderr
        )
        return 1
    try:
        return COMMANDS[argv[1]]()
    except IsolationError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
