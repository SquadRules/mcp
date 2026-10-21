# Example: All contract types

<!-- S1 exemption: teaching fixture demonstrating every contract type side by side; the ≤1-comment and never-combined rules (ADR 0024 §4) do not apply to a reference document. -->

One adapter with five steps, one per contract type (shell, mcp, subagent, user_input, comment). This file is a **reference demonstration** — it shows each contract shape so authors can copy the correct form. It is not a model of a production adapter: [ADR 0024](../adr/0024-adapter-contract-verification-ladder.md) §4 caps `comment` at one per adapter and forbids combining it with other types. Ready to train with `train`.

## Activation Patterns

Run when user says "example all types" or "all contract types".

## Step 1 — Shell: empirical check

Run the given shell command. Exit code 0 means success. The `interpreter` field is required ([ADR 0026](../adr/0026-shell-interpreter-required.md)).

```json
{
  "contract": {
    "type": "shell",
    "shell": {
      "interpreter": "bash",
      "cmd": "echo OK",
      "timeout_seconds": 10
    },
    "required": true
  }
}
```

## Step 2 — MCP: forward link

An `mcp` contract must be a forward link to another adapter ([ADR 0025](../adr/0025-mcp-contract-forward-link-only.md)): `tool_name` is exactly `"forward"` and `arguments.uri` matches `squadrules://adapter/<slug>`. Bare tool calls (`activate`, `export`, etc.) are **not** valid `mcp` contracts — use `subagent` for delegated tool work.

```json
{
  "contract": {
    "type": "mcp",
    "mcp": {
      "tool_name": "forward",
      "arguments": { "uri": "squadrules://adapter/critic-loop" }
    },
    "required": true
  }
}
```

## Step 3 — Subagent: delegated judgment or tool work

Delegate the task to a subagent and return its actual report. The subagent performs the work (an MCP call, a review, a judgment task) and only its report lands in the caller's context. Proof requires `evidence.report`.

```json
{
  "contract": {
    "type": "subagent",
    "subagent": {
      "context": "Review the output from Step 1 and confirm correctness. Report your findings."
    },
    "required": true
  }
}
```

## Step 4 — User input: emergency authority gap

Obtain a decision the agent cannot resolve autonomously. This is **not** for routine confirmation — only for genuine authority gaps or missing decisions ([ADR 0009](../adr/0009-autonomous-adapter-execution-no-human-gates.md)).

```json
{
  "contract": {
    "type": "user_input",
    "user_input": {
      "prompt": "The deployment target is ambiguous: staging and production share a slug. Which target should receive this release?"
    },
    "required": true
  }
}
```

## Step 5 — Comment: closing acknowledgement

Write a short summary (at least 30 characters). This is the **last-resort** contract: only for read-only or knowledge adapters that produce no observable artifact and require no judgment. At most one per adapter, never combined with other types in production ([ADR 0024](../adr/0024-adapter-contract-verification-ladder.md) §4).

```json
{
  "contract": {
    "type": "comment",
    "comment": {
      "min_length": 30
    },
    "required": true
  }
}
```

## Step 6 — Run complete

Only reachable after Steps 1–5 are solved. Show the outputs from all prior steps to the user. No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
