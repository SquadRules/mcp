# Example: Subagent contract (rungs 2 and 3)

Short adapter example: two delegated steps, one per rung of the verification ladder that uses a subagent ([ADR 0024](../adr/0024-adapter-contract-verification-ladder.md) §1). Rung 2 is delegated **judgment**; rung 3 is delegated **MCP tool work**. Both prove the same way — `evidence.report`, the subagent's actual report, never the caller's summary of it. This adapter has no `shell` step, so it is safe for MCP-only workflow tests. Ready to train with `train`.

## Activation Patterns

Run when user says "example subagent" or "subagent delegation".

## Step 1 — Rung 2: delegated judgment

Delegate a review that cannot be reduced to a test. `subagent.context` carries the task-specific instruction; the application appends the mandatory delegation instruction automatically. There is no `mcp` list here, because no tool call is required — the subagent's judgment *is* the evidence.

```json
{
  "contract": {
    "type": "subagent",
    "subagent": {
      "context": "Review the draft adapter against the verification ladder: state which rung each contract uses and, for every rung that was descended, whether the adapter text says why. Return PASS or FAIL with findings."
    },
    "required": true
  }
}
```

Submit the subagent's report verbatim, echoing `nonce` and `proof_hash`:

- Solution shape:

  ```json
  {"type":"subagent","outcome":"success","evidence":{"report":"FAIL — Step 3 uses comment where a shell check was possible."},"nonce":"<echo>","proof_hash":"<echo>"}
  ```

Do not perform the review yourself and do not rewrite the subagent's findings into your own words. A report you authored is not delegated judgment.

## Step 2 — Rung 3: delegated MCP tool work

Here the evidence *is* a tool result. Name the calls in `subagent.mcp` so the subagent cannot substitute a plausible narrative for the real call. **The listed tools are executed by the subagent, not by you** — the request and response transcript stays in the subagent's context and never reaches the caller's, which is the entire point of rung 3 ([ADR 0029](../adr/0029-subagent-mcp-and-context-authority.md)).

```json
{
  "contract": {
    "type": "subagent",
    "subagent": {
      "context": "Export every adapter in the target space and report each slug with its version and line count, then state whether any adapter exceeds the 350-line ceiling.",
      "mcp": [
        { "tool_name": "export", "arguments": { "all_adapters": true } }
      ]
    },
    "required": true
  }
}
```

`subagent.mcp` is **optional**, and these rules apply when it is present:

- Each entry needs a non-empty string `tool_name`; `arguments`, when present, must be a plain object. A malformed list is rejected with `subagent_mcp_invalid`.
- Omit the field entirely for rung-2 judgment, as in Step 1. Absence is valid, not an error.
- Proof does not change. It is still `evidence.report`. The list constrains what the subagent must *do*; it is never echoed back as proof.
- Never put an adapter link here. `subagent.mcp` names real MCP tool calls the subagent makes on its own thread; chaining to another adapter is a [`forward` contract](adapter-example-forward.md).
- Never make the listed calls yourself and then report the transcript. That defeats the context isolation rung 3 exists to buy.

## Step 3 — Run complete

Only reachable after Steps 1–2 are solved. Show both subagent reports to the user unchanged, and state which rung produced each. No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
