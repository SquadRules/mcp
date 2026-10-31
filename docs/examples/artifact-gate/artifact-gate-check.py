#!/usr/bin/env python3
# squadrules-artifact:
# slug: artifact-gate-check
# version: 1
"""Multi-step pre-flight gate shipped as a SquadRules adapter artifact.

Invoked by a one-line `shell` contract:

    interpreter: bash
    cmd: python3 "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/artifact-gate-check.py" --gate preflight

Runs standalone (`python3 artifact-gate-check.py --gate preflight`) so a failure
is reproducible outside SquadRules. Exits 0 when every condition of the gate
holds, 1 otherwise, printing one `FAIL: ...` line per unmet condition.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

CONFLICT_MARKERS = ("<<<<<<< ", ">>>>>>> ")
SKIPPED_DIRS = {".git", "node_modules", "dist", ".venv"}


def git(*args: str) -> str:
    proc = subprocess.run(["git", *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"FAIL: git {' '.join(args)}: {proc.stderr.strip()}")
    return proc.stdout.strip()


def check_clean_tree() -> str | None:
    dirty = git("status", "--porcelain", "--untracked-files=all")
    return f"working tree is not clean:\n{dirty}" if dirty else None


def check_branch() -> str | None:
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    return f"refusing to gate on protected branch '{branch}'" if branch in ("main", "master") else None


def check_conflict_markers() -> str | None:
    offenders = []
    for path in Path(".").rglob("*.md"):
        if SKIPPED_DIRS.intersection(path.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if any(marker in text for marker in CONFLICT_MARKERS):
            offenders.append(str(path))
    return "merge conflict markers in: " + ", ".join(offenders) if offenders else None


GATES = {
    "preflight": (check_clean_tree, check_branch, check_conflict_markers),
}


def main() -> int:
    parser = argparse.ArgumentParser(description="SquadRules example gate script.")
    parser.add_argument("--gate", required=True, choices=sorted(GATES))
    args = parser.parse_args()

    checks = GATES[args.gate]
    failures = [message for check in checks if (message := check())]
    if failures:
        for message in failures:
            print(f"FAIL: {message}", file=sys.stderr)
        return 1
    print(f"PASS: gate '{args.gate}' — {len(checks)} checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
