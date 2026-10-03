# Bundled meta-protocols

This directory contains the bundled SQUADRULES-internal adapters and policy
documents that are injected into the Squadrules app space at boot.

<!-- squadrules-doc-keep: directory-local authority for the shipped meta-protocol bundle (slugs, versions, chain-linking rules); source of truth for these files, not a restatement of wiki Core Concepts -->

Version: **4.2.0**

## Philosophy

SQUADRULES exists for AI agents and for human–AI harmony.

The bundle is designed to help agents recognise the right mode at the right
time: discovery, clarification, ideation, planning, execution, validation,
review, and handoff. The bundle prefers truth, explicit sequencing, and
observable verification over polished but weak wording.

Bundled mem resources that intentionally use **protocol** and **adapter** as
synonyms. Prefer **adapter** in new copy when you are not mirroring user-facing trigger phrases.

## Protocols

| File | Slug | Purpose |
|------|------|---------|
| [create-new-protocol.md](create-new-protocol.md) | `create-new-protocol` | Authoring adapter — create, review, or refactor SQUADRULES protocols |
| [refine-search.md](refine-search.md) | `refine-search` | Refine search — recover user intent after failed `activate` |
| [phase-critic.md](phase-critic.md) | `phase-critic` | Phase-boundary adversarial review — verify claims against evidence |
| [adapter-migration.md](adapter-migration.md) | `adapter-migration` | Batch structural migration — update all adapters to latest scheme |

### Linked authoring flow

```text
create-new-protocol (Author) → forward(squadrules://adapter/phase-critic) → phase-critic (Phase-Critic Review) → train (with review_evidence)
```

## Reference Documents

| File | Slug | Purpose |
|------|------|---------|
| [challenge-type-guide.md](challenge-type-guide.md) | `challenge-type-guide` | Challenge type selection, interpreter choice, and stronger verification patterns |
| [protocol-linking-guide.md](protocol-linking-guide.md) | `protocol-linking-guide` | Layers vs chains, `activate` vs `forward` + slug, chaining back/forward, multi-layer conductor vs extension URI, chain-root collapsing, MCP argument validation |
| [phase-critic-guide.md](phase-critic-guide.md) | `phase-critic-guide` | Phase-critic integration rules, mutation gates, solution check vs critic decision table |

## Cross-Protocol Linking

### Layers vs chains

**Layers (H2 steps within one adapter)** are the preferred unit of work. Use
layers when all steps fit in one adapter under 350 lines and serve a single
cohesive concern.

**Chain via `forward` + slug** — use when:

- the adapter exceeds 350 lines
- weaker models cannot follow the full adapter in one pass
- runtime routing to different adapters is needed (Router pattern)
- a step is reusable across multiple parent adapters (e.g. `phase-critic`)

Chaining is NOT a replacement for layers. A 6-step protocol that fits in 350
lines should stay as one adapter with 6 H2 layers.

### How forward + slug works

Both system and user-authored adapters chain using slugs in `next_action`:

```text
call forward with squadrules://adapter/phase-critic and no solution to start the phase critic
call forward with squadrules://adapter/implement-terraform and no solution to start this adapter
```

Slugs are globally unique (enforced by `train`), so resolution is
deterministic — no scoring, no ambiguity.

### Verifying chain links with MCP argument checks

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

### When to use `activate` vs `forward` + slug

| Situation | Use |
|---|---|
| Initial user-intent resolution | `activate` |
| Target adapter is known at authoring time | `forward` + slug |
| Target depends on runtime classification the current adapter cannot resolve | `activate` |
| Linking to the next adapter in a chain | `forward` + slug |
| Reusable sub-protocol invoked by multiple parents | `forward` + slug |

Never call `activate` just to get a slug you already know — it wastes a
round-trip and introduces non-determinism.

### Chain-root collapsing

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

**Defense in depth — protocol-level safeguards:** In addition to server-side
collapsing, each mid-chain adapter should include a **Prerequisites** paragraph
in its Activation Patterns section that lists required inputs from earlier
phases and directs the agent to start from the chain root if those inputs are
missing. This catches direct `forward` calls that bypass `activate`.

**Rules:**

- The chain root adapter itself must NOT have `chain_root` in its frontmatter.
- `chain_root` must refer to an existing slug (the chain entry point).
- `forward` calls within a chain are unaffected — `chain_root` only changes
  `activate` output routing.
