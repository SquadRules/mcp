# Example: Shell challenge

Short adapter example: one real step plus a final verification step. Run a command to prove completion. Ready to train with `train`.

## Activation Patterns

Run when user says "example shell" or "run shell example".

## Step 1 — Run the test suite

Execute the project test suite. Success means the command exits with code 0.

```json
{
  "contract": {
    "type": "shell",
    "shell": {
      "cmd": "npm test",
      "timeout_seconds": 60
    },
    "required": true
  }
}
```

## Step 2 — Run complete

Only reachable after Step 1 is solved. Show the output from Step 1 to the user (exit code, stdout, stderr if any). No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
