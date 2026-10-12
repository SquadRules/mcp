# Example: MCP challenge

Short adapter example: one real step plus a final verification step. Requires the agent to call an MCP tool and report success. Ready to train with `train`.

## Activation Patterns

Run when user says "example mcp" or "mcp challenge".

## Step 1 — Call activate

Invoke the `activate` tool with a query and report the result. The solution must include `success: true`.

```json
{
  "contract": {
    "type": "mcp",
    "mcp": {
      "tool_name": "activate"
    },
    "required": true
  }
}
```

Omit `mcp.arguments` when any tool call is enough. When the step must use
specific parameters, add **`arguments`** (a JSON object). Use **`{}`** when the
contract should require a plain object but impose no specific keys. The agent’s
`solution.mcp.arguments` must be an object and must match every contract key
(subset semantics: extra keys in the solution are allowed).

Example with constrained arguments:

```json
{
  "contract": {
    "type": "mcp",
    "mcp": {
      "tool_name": "activate",
      "arguments": { "query": "example search" }
    },
    "required": true
  }
}
```

## Step 2 — Run complete

Only reachable after Step 1 is solved. Show the output from Step 1 to the user (tool name, query, and result). No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
