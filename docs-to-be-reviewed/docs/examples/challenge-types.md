# SquadRules challenge types — trainable examples

The documents in this folder are **real markdown adapters ready for `train`**. Each has one H1 (adapter title), one or more H2 steps, and a trailing ` ```json ` block per step with `{"contract": { ... }}`. Copy the contents of any example into a file and pass it to `train` (with `llm_model_id` and optional `force_update`).

## Example adapter documents

| File | Challenge type(s) | Description |
|------|------------------|-------------|
| [adapter-example-shell.md](adapter-example-shell.md) | shell | Step 1: run a command. Step 2: show output to user (no challenge). |
| [adapter-example-user-input.md](adapter-example-user-input.md) | user_input | Step 1: get human confirmation. Step 2: show output to user (no challenge). |
| [adapter-example-comment.md](adapter-example-comment.md) | comment | Step 1: provide a text summary (min length). Step 2: show output to user (no challenge). |
| [adapter-example-mcp.md](adapter-example-mcp.md) | mcp | Step 1: call an MCP tool and report success. Step 2: show output to user (no challenge). |
| [adapter-example-all-types.md](adapter-example-all-types.md) | shell, mcp, user_input, comment | Steps 1–4: one per type. Step 5: show outputs to user (no challenge). |

## How to train

1. Copy the full content of one of the adapter markdown files above (or combine steps into your own document).
2. Ensure each step ends with a single ` ```json ` block containing an object with a `challenge` key (see the examples).
3. Call `train` with `content`, `llm_model_id`, and optionally `force_update: true`.

## Solution shapes (for forward)

When the server returns a challenge, the agent submits a solution in `forward`. The solution must match the challenge type.

| Type | Solution shape | Pass condition |
|------|----------------|----------------|
| **shell** | `type: "shell"`, `shell: { exit_code, stdout?, stderr?, duration_seconds? }` | `exit_code === 0` |
| **mcp** | `type: "mcp"`, `mcp: { tool_name, result, success, arguments? }` | `success === true` |
| **user_input** | `type: "user_input"`, `user_input: { confirmation, timestamp? }` | Agent supplies confirmation from user |
| **comment** | `type: "comment"`, `comment: { text }` | `text.length` ≥ challenge `min_length` (and optional semantic check) |

Always echo `nonce` and `proof_hash` from the challenge (or previous response) when present; the server generates them.

After the final **`forward`** for the run, the server directs the client to
call **`reward`** to finish the run.

For execution semantics (how to perform each challenge type, not infer or
fabricate), see the **`activate`**, **`forward`**, and **`reward`** tool
descriptions (and the companion workflow topics in the [project Wiki](https://github.com/SquadRules/mcp/wiki)
where noted).
