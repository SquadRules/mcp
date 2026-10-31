# Example: Forward-link contract

Short adapter example: one work step plus a tail forward link to the next adapter. A `forward` contract is **only** valid as a link to another adapter ([ADR 0028](../adr/0028-forward-contract-type-rename.md), superseding [ADR 0025](../adr/0025-mcp-contract-forward-link-only.md)): `forward.target` must match `squadrules://adapter/<slug>`. Ready to train with `train`.

## Activation Patterns

Run when user says "example forward" or "forward link".

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
    "type": "forward",
    "forward": {
      "target": "squadrules://adapter/implement-terraform"
    },
    "required": true
  }
}
```

The server verifies the submitted `evidence.target` equals the contract's `forward.target`, so the link's destination is checked — not merely that some handoff happened. A forward contract without `forward.target` is not a chain link and fails validation with `forward_link_only`.

**Mid-adapter placement** is permitted only to a reusable sub-adapter driven through its own forward/reward loop, and only when that sub-adapter is **not** auditing the caller. A `critic-loop` review is never reached this way: a `forward` hop runs the critic on the thread that produced the work, so the reviewer is the reviewed. Reach the critic with a `subagent` contract whose `subagent.mcp` names `forward` → `squadrules://adapter/critic-loop` ([ADR 0034](../adr/0034-verification-isolation-critic-hop.md)). All other mid-adapter tool work belongs in a `subagent` contract.

## What is NOT a valid `forward` contract

Bare MCP tool calls — `activate`, `export`, `getMergeRequest`, or any other tool name — are **not** valid `forward` contracts. A `forward` contract names an adapter, never a tool. Inline tool calls dump the full tool transcript into the executing agent's context, which is the defect [ADR 0025](../adr/0025-mcp-contract-forward-link-only.md) removes and [ADR 0028](../adr/0028-forward-contract-type-rename.md) makes self-evident by naming the type after what it does. Where an adapter step genuinely needs an MCP tool result, use one of:

- A **`subagent` contract** with a `subagent.mcp` list — the subagent makes the call and returns only its report (ladder rung 3). See [adapter-example-subagent.md](adapter-example-subagent.md).
- An **instruction verified by `shell`** — assert the observable result on disk rather than the call itself (ladder rung 1).

## Step 3 — Run complete

Only reachable after Steps 1–2 are solved. Show the output from Step 1 and confirm the forward link was accepted. No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
