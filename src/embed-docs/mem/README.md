# Bundled meta-adapters

This directory contains the bundled SQUADRULES-internal adapters and policy
documents that are injected into the Squadrules app space at boot.

<!-- squadrules-doc-keep: directory-local authority for the shipped meta-adapter bundle (slugs, versions, chain-linking rules); source of truth for these files, not a restatement of wiki Core Concepts -->

Version: **5.0.0**

## Philosophy

SQUADRULES exists for AI agents and for human–AI harmony.

The bundle is designed to help agents recognise the right mode at the right
time: discovery, clarification, ideation, planning, execution, validation,
review, and handoff. The bundle prefers truth, explicit sequencing, and
observable verification over polished but weak wording.

**Autonomy (AI-ownership).** The bundle is written for autonomous execution:
adapters resolve intent from context, delegate `critic-loop` to a subagent and
loop until it returns `PASS`, and gate irreversible remote mutations with
objective pre/post `shell` contracts rather than human confirmation. They do
**not** stop to ask a human to
approve or acknowledge. Human escalation is reserved for genuinely ambiguous intent
or a hard blocker (a required tool/auth that cannot be established automatically).

**Verification ladder.** Every contract must use the strongest observable
verification available:

1. `shell` — for file/state/command verification. **`interpreter` is REQUIRED**
   (allowed: `bash`, `sh`, `python3`, `python`, `node`).
2. `subagent` — delegated judgment (a critic), and delegated MCP tool work whose
   transcript must stay out of the caller's context.
3. `comment` — last resort. Max 1 per adapter, only as closing ACK for
   knowledge/reference adapters.

`forward` is not a ladder rung: it is a **link** to another adapter, and it must
set `forward.target` matching `squadrules://adapter/<slug>`. Bare MCP tool calls
are not valid `forward` contracts — delegate them inside a `subagent`.
`user_input` is not a rung either: it is an emergency type for a genuine human
decision, never a verification (see *`user_input` — emergency only* in
`docs/adapter-authoring-guide.md`).

**The critic never runs on the executor's thread.** A contract that reviews the
work of the current run is a `subagent` contract whose `subagent.mcp` names
`forward` → `squadrules://adapter/critic-loop`; it is never a `forward` contract,
which would have the audited agent perform its own review. A separate
server-owned review (different model, session, and content-bound receipt) is the
end state; the subagent hop is the best available form today.

Rungs and counts are **soft-enforced** by these docs and the review checklists.
The fail-closed structural rules are the three objective ones:
`shell_interpreter_required`, `forward_link_only`, `subagent_mcp_invalid`.

Bundled mem resources intentionally use **adapter** and **workflow** as preferred
terms. Avoid bare "protocol" in new copy.

## Adapters

| File | Slug | Purpose |
|------|------|---------|
| [author-adapter.md](author-adapter.md) | `author-adapter` | Authoring adapter — create, review, or update SQUADRULES adapters |
| [refine-search.md](refine-search.md) | `refine-search` | Refine search — recover user intent after failed `activate` |
| [critic-loop.md](critic-loop.md) | `critic-loop` | Phase-boundary adversarial review — verify claims against evidence |
| [adapter-migration.md](adapter-migration.md) | `adapter-migration` | Batch structural migration — update all adapters to latest scheme |
| [bulk-insert-adapters-via-cli.md](bulk-insert-adapters-via-cli.md) | `bulk-insert-adapters-via-cli` | Bulk train adapters from a local directory via CLI |

### Linked authoring flow

```text
author-adapter (Author) → subagent hop (forward → critic-loop) → verdict file → gate PASS → train (with review_evidence)
```

## Reference Documents

| File | Slug | Purpose |
|------|------|---------|
| [challenge-type-guide.md](challenge-type-guide.md) | `challenge-type-guide` | Challenge type selection, interpreter choice, and verification patterns |
| [protocol-linking-guide.md](protocol-linking-guide.md) | `protocol-linking-guide` | Layers vs chains, `activate` vs `forward` + slug, chain-root collapsing, forward-link validation |
| [critic-loop-guide.md](critic-loop-guide.md) | `critic-loop-guide` | Critic-loop integration rules, mutation gates, solution check vs critic decision table |

## Cross-Adapter Linking

### Layers vs chains

**Layers (H2 steps within one adapter)** are the preferred unit of work. Use
layers when all steps fit in one adapter under 350 lines and serve a single
cohesive concern.

**Chain via `forward` + slug** — use when:

- the adapter exceeds 350 lines
- weaker models cannot follow the full adapter in one pass
- runtime routing to different adapters is needed (Router pattern)
- a step is reusable across multiple parent adapters (e.g. `critic-loop`)

Chaining is NOT a replacement for layers. A 6-step adapter that fits in 350
lines should stay as one adapter with 6 H2 layers.

### How forward + slug works

Both system and user-authored adapters chain using slugs in `next_action`:

```text
call forward with squadrules://adapter/implement-terraform and no solution to start this adapter
```

A review hop is not a chain link: reach `critic-loop` from a `subagent` contract
so the review runs apart from the agent that produced the work.

Slugs are globally unique (enforced by `train`), so resolution is
deterministic — no scoring, no ambiguity.

### Forward-link contracts

All `forward` contracts must name their target adapter:

Example ```json
{"contract":{"type":"forward","forward":{"target":"squadrules://adapter/code-review-policy"},"required":true}}
```

The server validates that the submitted `evidence.target` equals the contract's
`forward.target`. This proves the agent called `forward` with the correct slug,
not just any `forward` call.

### When to use `activate` vs `forward` + slug

| Situation | Use |
|---|---|
| Initial user-intent resolution | `activate` |
| Target adapter is known at authoring time | `forward` + slug |
| Target depends on runtime classification the current adapter cannot resolve | `activate` |
| Linking to the next adapter in a chain | `forward` + slug |
| Reusable sub-adapter invoked by multiple parents | `forward` + slug |
| Inviting `critic-loop` to review this run's work | `subagent` hop naming `forward` |

Never call `activate` just to get a slug you already know — it wastes a
round-trip and introduces non-determinism.

### Chain-root collapsing

When a chain has multiple adapters, `activate` might match a mid-chain adapter
directly. Without protection, the agent would start at the wrong step, missing
prerequisite context gathered by earlier steps.

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

**Defense in depth:** Each mid-chain adapter should include a **Prerequisites**
paragraph in its Activation Patterns section that lists required inputs from
earlier steps and directs the agent to start from the chain root if those inputs
are missing.

**Rules:**

- The chain root adapter itself must NOT have `chain_root` in its frontmatter.
- `chain_root` must refer to an existing slug (the chain entry point).
- `forward` calls within a chain are unaffected — `chain_root` only changes
  `activate` output routing.
