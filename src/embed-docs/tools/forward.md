Return an **adapter** layer's instructions and advance its workflow state.

**Effects of this tool:** starts/updates execution metadata, proof records, traces,
and quality feedback. It returns shell, forward, and subagent contracts for the
caller to execute; it does **not** execute those shell commands, invoke the
described MCP tools,
edit repository files, or train/tune adapter content. A user-input contract may
request host elicitation on continuation.
This is stateful, not a read-only tool. Later actions remain subject to their own
scope and host permissions; starting a workflow does not authorize all its steps.

**Adapter authoring:** `author-adapter` handles **create, review, and update**,
not just creation. Copy the complete
`activate.choices[].forward_first_call`, including `authoring` when present:

```json
{
  "uri": "squadrules://adapter/author-adapter",
  "authoring": {
    "operation": "update",
    "target_adapter_uri": "squadrules://adapter/sample-pr-workflow"
  }
}
```

`authoring` is optional for original callers. When supplied, create forbids a target;
review/update require an existing adapter URI. The operation and target are fixed
for the run, stored server-side, and echoed in responses and forward next calls.
Omitted continuation context is restored; changed context or a different workflow
is rejected. Context describes intent, not permission: train/tune remain separate
mutations. For a new operation or target, start a new run.

First call (start a run):

```json
{ "uri": "squadrules://adapter/<slug>" }
```

Copy this from `activate.choices[].forward_first_call.uri`. Adapter URIs are
slug-only on the wire.

Continuation call:

```json
{
  "uri": "squadrules://layer/<uuid>?execution_id=<uuid>",
  "solution": {
    "type": "<contract.type>",
    "outcome": "success",
    "evidence": { /* type-specific proof data */ },
    "nonce": "<contract.nonce when present>",
    "proof_hash": "<contract.proof_hash when present>"
  }
}
```

Copy `forward.next_call.args` from the previous response, then fill the
`solution.evidence` payload. Layer URIs are UUID-only; never substitute a slug
for a layer URI.

Output always includes:

- `contract` for the current layer
- `next_action` prose guidance
- `next_call` (authoritative machine-readable next call)

`next_call.kind` is:

- `forward` on non-terminal layers
- `reward` on terminal layers

## Running a `shell` contract

`contract.shell` is fully specified — run it exactly as given:

- `shell.cmd` — the command text (not a file path).
- `shell.interpreter` — the wrapper that runs it: `bash`, `sh`, `python3`, `python`, or `node`. `bash`/`sh`/`python3`/`python` receive `cmd` via `-c`, `node` via `-e`.
- `shell.invocation_display` — the server-computed argv for this contract. **Run that line**; do not rebuild one.
- `shell.timeout_seconds` — the timeout.

Capture stdout and stderr without suppressing them. `exit_code 0` is a pass; any other code is a failure. Report the real values.

A contract with no `interpreter` is invalid: the adapter was stored without one. Re-train it (`train` with `force_update: true`, contract `shell.interpreter` set) and start the run again. Do not guess a wrapper.

### Scripts a contract invokes

A `cmd` that names a script file only works when that file exists. The file ships with the adapter as an **artifact**: obtain it **before** the first `shell` contract that invokes it. `forward` does not repeat the artifact list, and a choice can carry no artifact rows at all.

1. If the `activate` choice you started from lists the artifact, run that row's `materialize.cmd` verbatim — it writes the file, verifies the digest, and sets permissions. On the stdio transport, call the MCP `export` tool with the row's `arguments` first and set `B64` to the returned `content`; on HTTP, `cmd` downloads the artifact itself. Never retype artifact bytes through an editor or a heredoc.
2. If it is not listed, call **`export`** for that adapter (`uri: "squadrules://adapter/<slug>"`, `format: skill_tree` for the file list, `format: skill_zip` for the bundle) and take the script from **`artifacts/`**. **`export` is the tool that returns adapter files** — `activate` returns artifact rows, `forward` returns instructions.
3. If the script is in neither place, it does not exist. Check whether the contract names a path that exists in the current repository — a repo-owned gate — and use it only if it is the same script the contract intends, reporting the path you used.

When the file is missing:

1. Do not re-run the same command. The absence is deterministic; a repeat produces the same failure and burns the retry budget.
2. Obtain the file as described above, then run the contract again.
3. If the file cannot be obtained anywhere, do not invent it and do not substitute a different command: report the step as failed with the missing path in `stderr`, and rate the run `failure`. The adapter is broken — repair it with `train` (artifact) or `tune` (contract), do not work around it.

## Unified solution envelope

Every solution, regardless of type, follows the same envelope:

```json
{
  "type": "<challenge_type>",
  "outcome": "success | failure | skipped",
  "evidence": { /* type-specific proof data */ },
  "nonce": "<echo from contract>",
  "proof_hash": "<echo from contract>"
}
```

### Per-type `evidence` shapes

#### shell

```json
{
  "type": "shell",
  "outcome": "success",
  "evidence": {
    "exit_code": 0,
    "stdout": "...",
    "stderr": "",
    "duration_seconds": 1.2
  }
}
```

`next_call.args.solution_template` shows the **shape** only — its `exit_code: 0`, `stdout: "<real stdout>"`, and `stderr: "<real stderr>"` are placeholders. Replace them with the real exit code and output; never echo the template. The server rejects a submission whose stdout or stderr still contains the placeholder markers (`PLACEHOLDER_EVIDENCE`).

#### forward

A `forward` contract continues the chain on the caller's own thread. Never use it
to reach the critic — a review of the caller's own work is a `subagent` contract.

```json
{
  "type": "forward",
  "outcome": "success",
  "evidence": {
    "target": "squadrules://adapter/implement-terraform",
    "success": true
  }
}
```

#### comment

```json
{
  "type": "comment",
  "outcome": "success",
  "evidence": {
    "text": "Verified all 78 issues now have repo: labels."
  }
}
```

#### user_input

```json
{
  "type": "user_input",
  "outcome": "success",
  "evidence": {
    "confirmation": "agreed. proceed",
    "timestamp": "2026-05-18T14:49:00Z"
  }
}
```

## When a step fails

A failed step returns `error_code` and `retry_count` next to the same contract:

- `COMMAND_FAILED` — the command ran and failed. Fix the cause, then continue with `forward` on the same layer URI, echoing the `nonce` and `proof_hash` from that response.
- `NONCE_MISMATCH` — the proof token was stale. Continue with the `retry_nonce` from that response.
- `MAX_RETRIES_EXCEEDED` — `must_obey` is `false`; the server stops retrying this step. Repair the adapter (`train` with `force_update: true` when the contract itself is wrong; `tune` for prose) or finish the run with `reward` and `outcome: "failure"` plus the reason. Do not keep re-running the same failing command.

`retry_count` counts attempts on the current challenge. Each retry needs fresh evidence from a real run — never resubmit the previous attempt's output.

## Reward truthfulness

`next_call.args.outcome_template` is a **shape**, not evidence: it carries the outcome the server can justify for the layer it points at (`failure` when that layer's last proof failed, `success` otherwise). Your `outcome` must still match what happened. The server rejects a `success` reward for a layer whose stored proof failed (`REWARD_SUCCESS_CONFLICTS_FAILED_PROOF`) — rate that layer `failure` with the reason, or fix the step and run it again.

## Compatibility

The server also accepts older type-specific payload shapes where data is placed
directly under the type key instead of inside an `evidence` envelope:

```json
{
  "type": "forward",
  "forward": { "target": "squadrules://adapter/implement-terraform", "success": true }
}
```

For new protocols and solutions, always use the unified envelope with `outcome`
and `evidence`. The server converts older shapes internally.
