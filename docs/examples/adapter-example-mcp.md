# Example: MCP forward-link contract

Short adapter example: one work step plus a tail forward link to the next adapter. An `mcp` contract is **only** valid as a forward link ([ADR 0025](../adr/0025-mcp-contract-forward-link-only.md)): `tool_name` must be exactly `"forward"` and `arguments.uri` must match `squadrules://adapter/<slug>`. Ready to train with `train`.

## Activation Patterns

Run when user says "example mcp" or "mcp forward link".

## Step 1 — Perform the work

Run the project lint check. This step produces an observable result (exit code 0).

```json
{
  "contract": {
    "type": "shell",
    "shell": {
      "interpreter": "bash",
      "cmd": "npm run lint",
      "timeout_seconds": 120
    },
    "required": true
  }
}
```

## Step 2 — Chain to the next adapter

After the work is complete, hand off to the next adapter in the chain. The forward link belongs at the adapter's **tail**, connecting this adapter's completion to the next one's activation.

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

The server verifies the submitted `arguments.uri` is a superset match of the contract's, so the link's target is checked — not merely its tool name. A forward link without `arguments.uri` is not a chain link and fails validation with `mcp_link_only`.

**Mid-adapter placement** is permitted only to a reusable sub-adapter driven through its own forward/reward loop (the standing case is `critic-loop`). All other mid-adapter tool work belongs in a `subagent` contract.

## What is NOT a valid `mcp` contract

Bare MCP tool calls — `activate`, `export`, `getMergeRequest`, or any other tool name — are **not** valid `mcp` contracts. They dump the full tool transcript into the executing agent's context, which is the defect [ADR 0025](../adr/0025-mcp-contract-forward-link-only.md) removes. Where an adapter step genuinely needs an MCP tool result, use one of:

- A **`subagent` contract** — the subagent makes the call and returns only its report (ladder rung 3).
- An **instruction verified by `shell`** — assert the observable result on disk rather than the call itself (ladder rung 1).

## Step 3 — Run complete

Only reachable after Steps 1–2 are solved. Show the output from Step 1 and confirm the forward link was accepted. No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
