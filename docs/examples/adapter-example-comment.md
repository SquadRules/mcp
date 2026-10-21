# Example: Comment contract (knowledge adapter)

Short adapter example: a **read-only / knowledge adapter** whose only output is guidance the agent has now read. The closing `comment` acknowledgement is the honest minimum for adapters that produce no observable artifact and require no judgment. Ready to train with `train`.

## When to use `comment`

The `comment` contract is a **last resort** ([ADR 0024](../adr/0024-adapter-contract-verification-ladder.md) §4):

- At most **one** `comment` contract per adapter.
- **Never combined** with another contract type. An adapter that has any observable step does not also get an acknowledgement layer.
- Used only where rungs 1–3 of the verification ladder cannot apply: no file to assert (`shell`), no judgment to delegate (`subagent`), no tool transcript to verify (`mcp` forward-link).

Typical case: a reference adapter that delivers instructions, conventions, or knowledge. The agent reads it, and the acknowledgement proves it was delivered — nothing more.

## Activation Patterns

Run when user says "example comment" or "knowledge adapter acknowledgement".

## Step 1 — Deliver the reference content

This adapter's body is the knowledge itself: naming conventions for the project's test files. The agent reads the content above and below; there is no artifact to produce and no judgment to delegate.

The closing acknowledgement records that the reference was delivered.

```json
{
  "contract": {
    "type": "comment",
    "comment": {
      "min_length": 50
    },
    "required": true
  }
}
```

The `min_length` prevents an empty or single-character submission. Keep it modest (30–80 characters) — the goal is "something was written", not "a summary was produced". Do not use this as a quality gate; if quality matters, use `subagent` (rung 2) or `shell` (rung 1) instead.

## Step 2 — Run complete

Only reachable after Step 1 is solved. The reference content has been delivered and acknowledged. No additional challenge.

## Reward Signal

Only reachable after all prior steps are solved.
