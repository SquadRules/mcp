# SquadRules contract types — trainable examples

The documents in this folder are **real markdown adapters ready for `train`**. Each has one H1 (adapter title), one or more H2 steps, and a trailing ` ```json ` block per step with `{"contract": { ... }}`. Copy the contents of any example into a file and pass it to `train` (with `llm_model_id` and optional `force_update`).

## Example adapter documents

| File | Contract type(s) | Description |
|------|-----------------|-------------|
| [adapter-example-shell.md](adapter-example-shell.md) | shell | Empirical check with required `interpreter` field. |
| [adapter-example-artifact-gate.md](artifact-gate/adapter-example-artifact-gate.md) | shell | Multi-step gate shipped as an adapter artifact; one-line contract invocation. |
| [adapter-example-forward.md](adapter-example-forward.md) | shell, forward | Work step plus tail forward link to another adapter. |
| [adapter-example-subagent.md](adapter-example-subagent.md) | subagent | Rung-2 judgment plus rung-3 delegated MCP tool work. |
| [adapter-example-user-input.md](adapter-example-user-input.md) | user_input | Emergency authority gap — not routine confirmation. |
| [adapter-example-comment.md](adapter-example-comment.md) | comment | Knowledge adapter closing acknowledgement (last resort). |
| [adapter-example-all-types.md](adapter-example-all-types.md) | shell, forward, subagent, user_input, comment | Reference demonstration of every contract shape. |
| [adapter-twelve-step-linear-test.md](adapter-twelve-step-linear-test.md) | comment ×12 | UI/long-run test fixture (exempt from ≤1 comment rule). |

## How to train

1. Copy the full content of one of the adapter markdown files above (or combine steps into your own document).
2. Ensure each step ends with a single ` ```json ` block containing an object with a `contract` key (see the examples).
3. Call `train` with `content`, `llm_model_id`, and optionally `force_update: true`.
4. [adapter-example-artifact-gate.md](artifact-gate/adapter-example-artifact-gate.md) needs a second `train` for its gate script: artifact trains take `adapter_uri`, `mime`, `artifact_name`, and `llm_model_id`, and run only after the adapter exists.

## Contract types and structural rules

### shell

Rung 1 of the verification ladder ([ADR 0024](../adr/0024-adapter-contract-verification-ladder.md)). Observes the work empirically.

**Required fields:**

- `shell.interpreter` — must be one of: `bash`, `sh`, `python3`, `python`, `node` ([ADR 0026](../adr/0026-shell-interpreter-required.md)). Absent interpreter is an invalid contract, not a request for `bash`.
- `shell.cmd` — the command text. It is executed as **program text**, never as a
  file path: `bash`/`sh` and `python3`/`python` receive it via `-c`, `node` via
  `-e`. To run a script file, name the wrapper that runs it
  (`interpreter: "bash"`, `cmd: python3 "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/<name>.py" --gate <name>`).
- `shell.timeout_seconds` — execution timeout.

Build tools (`docker`, `npm`, `terraform`) are not interpreters — wrap them in a shell line. When a check needs several conditions or parses JSON, ship it as an adapter **artifact** and keep the contract a one-line invocation of that script: [artifact-gate/adapter-example-artifact-gate.md](artifact-gate/adapter-example-artifact-gate.md), [ADR 0031](../adr/0031-gate-scripts-as-adapter-artifacts.md).

### forward

**Link to another adapter only** ([ADR 0028](../adr/0028-forward-contract-type-rename.md), superseding [ADR 0025](../adr/0025-mcp-contract-forward-link-only.md)). A `forward` contract chains this adapter's completion to another adapter's activation:

- `forward.target` — must match `squadrules://adapter/<slug>`.

Bare MCP tool calls (`activate`, `export`, `getMergeRequest`, etc.) are **not** valid `forward` contracts — a `forward` contract names an adapter, never a tool. Validation rejects them with `forward_link_only`. Use `subagent` for delegated tool work.

### subagent

Rung 2 (delegated judgment) or rung 3 (delegated MCP tool work) of the verification ladder. The subagent performs the work and returns only its report — the tool transcript never reaches the caller's context.

**Fields:**

- `subagent.context` — task-specific context for the delegated subagent. The application auto-appends the mandatory delegation instruction.
- `subagent.mcp` *(optional)* — a list of `{ tool_name, arguments }` naming the real MCP tool calls the **subagent** must make (rung 3). Omit it for rung-2 judgment. See [adapter-example-subagent.md](adapter-example-subagent.md) and [ADR 0029](../adr/0029-subagent-mcp-and-context-authority.md).

Proof requires `evidence.report` containing the subagent's actual report.

### user_input

**Emergency only** ([ADR 0009](../adr/0009-autonomous-adapter-execution-no-human-gates.md)). For genuine authority gaps or missing decisions the agent cannot resolve autonomously. Not for routine confirmation or approval gates.

**Fields:**

- `user_input.prompt` — states what the agent determined, why it cannot decide alone, and what specific answer it needs.

### comment

**Last resort** ([ADR 0024](../adr/0024-adapter-contract-verification-ladder.md) §4). Only for read-only or knowledge adapters with no observable artifact and no judgment required.

- At most **one** per adapter.
- **Never combined** with another contract type.

**Fields:**

- `comment.min_length` — minimum character count for the acknowledgement.

## Solution shapes (for forward)

When the server returns a challenge, the agent submits a solution in `forward`. The solution must match the contract type.

| Type | Solution shape | Pass condition |
|------|----------------|----------------|
| **shell** | `type: "shell"`, `shell: { exit_code, stdout?, stderr?, duration_seconds? }` | `exit_code === 0` |
| **forward** | `type: "forward"`, `evidence: { target, success }` | `success === true`; `target` matches contract `forward.target` |
| **subagent** | `type: "subagent"`, `evidence: { report }` | `report` is non-empty |
| **user_input** | `type: "user_input"`, `user_input: { confirmation, timestamp? }` | Agent supplies confirmation from user |
| **comment** | `type: "comment"`, `comment: { text }` | `text.length` ≥ contract `min_length` |

Always echo `nonce` and `proof_hash` from the challenge (or previous response) when present; the server generates them.

After the final **`forward`** for the run, the server directs the client to
call **`reward`** to finish the run.

For execution semantics (how to perform each contract type, not infer or
fabricate), see the **`activate`**, **`forward`**, and **`reward`** tool
descriptions (and the companion workflow topics in the [project Wiki](https://github.com/SquadRules/mcp/wiki)
where noted).
