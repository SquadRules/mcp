Return an **adapter** layer's instructions and advance its workflow state.

**Effects of this tool:** starts/updates execution metadata, proof records, traces,
and quality feedback. It returns shell/MCP contracts for the caller to execute;
it does **not** execute those shell commands, invoke the described MCP tools,
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
