// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
Run an **adapter** layer by layer.

First call (start a run):

```json
{ "uri": "kairos://adapter/<slug>" }
```

Copy this from `activate.choices[].forward_first_call.uri`. Adapter URIs are
slug-only on the wire.

Continuation call:

```json
{
  "uri": "kairos://layer/<uuid>?execution_id=<uuid>",
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

#### mcp

```json
{
  "type": "mcp",
  "outcome": "success",
  "evidence": {
    "tool_name": "editJiraIssue",
    "arguments": { "issueIdOrKey": "BIB-1383" },
    "response": { "key": "BIB-1383", "webUrl": "..." }
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

#### tensor

```json
{
  "type": "tensor",
  "outcome": "success",
  "evidence": {
    "name": "priority_score",
    "value": [0.85, 0.72, 0.91]
  }
}
```

## Compatibility

The server also accepts older type-specific payload shapes where data is placed
directly under the type key instead of inside an `evidence` envelope:

```json
{
  "type": "mcp",
  "mcp": { "tool_name": "x", "result": {}, "success": true }
}
```

For new protocols and solutions, always use the unified envelope with `outcome`
and `evidence`. The server converts older shapes internally.
