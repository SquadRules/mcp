# Example: Shell contract

Short adapter example: one empirical check plus a final step. Shell is rung 1 of the verification ladder ([ADR 0024](../adr/0024-adapter-contract-verification-ladder.md)): it observes the work instead of trusting a claim about it. Every shell contract must name an interpreter ([ADR 0026](../adr/0026-shell-interpreter-required.md)); the allowed set is `bash | sh | python3 | python | node`. Ready to train with `train`.

## Activation Patterns

Run when user says "example shell" or "run shell example".

## Step 1 — Run the test suite

Execute the project test suite. Success means the command exits with code 0.

```json
{
  "contract": {
    "type": "shell",
    "shell": {
      "interpreter": "bash",
      "cmd": "npm test",
      "timeout_seconds": 60
    },
    "required": true
  }
}
```

The `interpreter` field is required. Absent interpreter is not a request for `bash`; it is an invalid contract and `train` rejects it with `shell_interpreter_required`. Build tools such as `docker` or `npm` are not interpreters — wrap them in `bash -c` (as above) or export the script and pick `node` / `python3` matching the project type.

## Step 2 — Run complete

Only reachable after Step 1 is solved. Show the output from Step 1 to the user (exit code, stdout, stderr if any). No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
