---
version: "4.8.6"
slug: protocol-linking-guide
title: Protocol Linking Guide
---



# Protocol Linking Guide

Decision rules for structuring adapter relationships: layers vs chains,
`activate` vs `forward` + slug, chain-root collapsing, and MCP argument
validation for deterministic cross-protocol linking.

## Activation Patterns

**Typically invoked by:** `create-new-protocol` and
`phase-critic`.

**Can be invoked directly when agent needs:**
- "layers vs chains" / "when to split into multiple adapters"
- "how to link adapters" / "cross-protocol linking"
- "activate vs forward" / "when to use forward with slug"
- "chain-root collapsing" / "how chain_root works"

**Trigger pattern:** **layers** / **chains** / **linking** / **forward** +
(slug | adapter | protocol).

**Must Never:**
- Be used as an execution protocol.
- Recommend chaining when layers suffice.

**Must Always:**
- Be consulted before splitting a protocol into multiple adapters.
- Be consulted before adding `forward` calls or `chain_root` frontmatter.

**Good trigger examples:**
- "my protocol is 400 lines, should I split?" → load this
- "how do I link adapter A to adapter B?" → load this
- "what is chain_root?" → load this

**Bad trigger examples:**
- "which challenge type for this step?" → use `challenge-type-guide`
- "create a new protocol" → use `create-new-protocol`

## Layers vs Chains

**Layers** (H2 steps within one adapter) are the preferred unit of work. Use
layers when all steps fit in one adapter under 350 lines and serve a single
cohesive concern.

**Chain via `forward` + slug** — use only when:
- the adapter exceeds 350 lines
- weaker models cannot follow the full adapter in one pass
- runtime routing to different adapters is needed (Router pattern)
- a step is reusable across multiple parent adapters (e.g. `phase-critic`)

Chaining is NOT a replacement for layers. A 6-step protocol that fits in 350
lines should stay as one adapter with 6 H2 layers.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## `activate` vs `forward` + slug

| Situation | Use |
|---|---|
| Initial user-intent resolution | `activate` |
| Target adapter is known at authoring time | `forward` + slug |
| Target depends on runtime classification the current adapter cannot resolve | `activate` |
| Linking to the next adapter in a chain | `forward` + slug |
| Reusable sub-protocol invoked by multiple parents | `forward` + slug |

Never call `activate` just to get a slug you already know — it wastes a
round-trip and introduces non-determinism.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Chaining Back and Forward

When a family of adapters has a root conductor and smaller domain extensions,
document both directions of chaining.

### Chaining back with `chain_root`

Extension adapters should include `chain_root` frontmatter and a prerequisite
clause:

**Prerequisite:** Start from `<root-adapter-slug>` unless the caller already
provided a mission brief, safety gates, authorization boundary, and evidence
requirements.

This protects activation entry points. If a user or weak agent activates a
mid-chain extension directly, the extension can collapse back to the root unless
it already received the required parent context.

### Chaining forward with `forward`

`chain_root` does not replace explicit `forward` calls inside the chain.

When the next adapter is known at authoring time or after deterministic runtime
classification, use `forward` with the target slug. Do not call `activate` just
to rediscover a slug already known by the current adapter.

Forwarded adapters should receive:
- current mission brief;
- safety gates;
- authorization boundary;
- evidence requirements;
- user constraints;
- reason for forwarding.

Use `activate` only when the next adapter must be discovered from an ambiguous
runtime need.

### Multi-layer conductors and extension URIs

When you are executing **`forward`** inside a **multi-layer** adapter (for example
a root conductor), each continuation follows **`next_call`** for the **same**
`execution_id` until the last layer directs **`reward`**. A layer that mentions
another adapter URI only as routing guidance — for example
`squadrules://adapter/e2e-coding-pr-delivery` — does **not** cause the server to
switch executions: the next **`forward`** in that run still advances the
**current** adapter’s next layer.

To run an extension adapter, call **`forward`** with
`squadrules://adapter/<slug>` as a **new** first call (adapter URI; omit
`solution`). That starts a **separate** execution with its own layers. Common
pattern: complete the conductor with **`reward`**, then **`forward`** to the
extension slug when coding or PR-shaped work should run under that adapter’s
contracts.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## System adapters vs user adapters

Both system and user-authored adapters chain using slugs in `next_action`:

```text
call forward with squadrules://adapter/phase-critic ...
call forward with squadrules://adapter/implement-terraform ...
```

Slugs are globally unique (enforced by `train`), so resolution is
deterministic — no scoring, no ambiguity.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## MCP argument validation for chain links

A bare `mcp` contract checks only the tool name:

```json
{"contract":{"type":"mcp","mcp":{"tool_name":"forward"},"required":true}}
```

An `mcp` contract **with `arguments`** verifies the exact target:

```json
{"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/code-review-policy"}},"required":true}}
```

The server validates that `solution.mcp.arguments` is a superset of the
contract's `mcp.arguments` (subset/deep matching). This proves the agent
called `forward` with the correct slug, not just any `forward` call.

Use the `arguments` form whenever a step's purpose is to invoke a specific
known adapter.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Chain-root collapsing

When a chain has multiple adapters, `activate` might match a mid-chain adapter
directly. Without protection, the agent would start at the wrong step, missing
prerequisite context gathered by earlier phases.

**`chain_root` frontmatter field** solves this at the server level. Add it to
every mid-chain adapter:

```yaml
---
slug: implement-plan
version: 1.0.0
chain_root: implement
---
```

**Server behaviour:** When `activate` returns a match that has `chain_root`,
the server resolves the slug to the root adapter's URI and replaces the
choice's `uri` and `next_action` to point there. Multiple mid-chain matches
from the same chain are deduplicated to a single entry. The agent always
starts at the chain entry point.

**Defense in depth — protocol-level safeguards:** Each mid-chain adapter
should include a **Prerequisites** paragraph in its Activation Patterns
listing inputs required from earlier phases and directing the agent to start
from the chain root if those inputs are missing. This catches direct `forward`
calls that bypass `activate`.

**Rules:**
- The chain root adapter must NOT have `chain_root` in its frontmatter.
- `chain_root` must refer to an existing slug (the chain entry point).
- `forward` calls within a chain are unaffected — `chain_root` only changes
  `activate` output routing.

```json
{"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

The agent can now:
1. decide when to use layers vs chains
2. choose `activate` vs `forward` + slug correctly
3. use slug-based linking for all adapters (system and user)
4. apply MCP argument validation for deterministic chain links
5. implement `chain_root` collapsing with defense-in-depth safeguards
6. document chaining back (`chain_root` + prerequisites) and chaining forward
   (`forward` with known slugs) for root + extension families
