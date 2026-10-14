# Example: GitHub PR checks watcher

Shell adapter for babysitting GitHub PR CI checks. Runs `gh pr checks` with `--watch --fail-fast` to monitor CI in real-time. Ready to train with `train`.

## Activation Patterns

Run when user says "watch pr checks", "monitor pr ci", or "babysit pr" followed by a PR number.

## Step 1 — Watch PR checks

Execute `gh pr checks` for the given PR number, watching for updates and failing fast on first failure. Exit code 0 means all checks passed.

```json
{
  "contract": {
    "type": "shell",
    "shell": {
      "cmd": "gh pr checks 65 --watch --fail-fast",
      "timeout_seconds": 600
    },
    "required": true
  }
}
```

## Step 2 — Checks complete

Only reachable after Step 1 is solved. Show the output from Step 1 to the user (exit code, check results). No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
