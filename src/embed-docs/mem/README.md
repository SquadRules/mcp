# Bundled meta-protocols

This directory contains the bundled SQUADRULES-internal adapters and policy
documents that are injected into the Squadrules app space at boot.

<!-- squadrules-doc-keep: directory-local authority for the shipped meta-protocol bundle (slugs, versions, chain-linking rules); source of truth for these files, not a restatement of wiki Core Concepts -->

Version: **4.4.0**

## Philosophy

SQUADRULES exists for AI agents and for human–AI harmony.

The bundle is designed to help agents recognise the right mode at the right
time: discovery, clarification, ideation, planning, execution, validation,
review, and handoff. The bundle prefers truth, explicit sequencing, and
observable verification over polished but weak wording.

**Autonomy (AI-ownership).** The bundle is written for autonomous execution:
adapters resolve intent from context, run critic-loop in a loop until it returns
`PASS`, and gate irreversible remote mutations with objective pre/post **shell**
checks — every shell contract names a required `interpreter` — rather than human
confirmation. They do **not** stop to ask a human to approve or acknowledge.
`user_input` is an **emergency gate only**: a human explicitly requiring
involvement, or a dangerous operation where a human answer materially raises the
agent's confidence. It is never a post-critic-FAIL approval or a routine
confirmation.

Bundled mem resources that intentionally use **protocol** and **adapter** as
synonyms. Prefer **adapter** in new copy when you are not mirroring user-facing trigger phrases.

## Contract policy

The server accepts four operative proof types — `shell`, `subagent`, `user_input`,
`comment` (`tensor` is reserved). The `mcp` type has been **erased**; the
[`subagent`](challenge-type-guide.md) delegation pattern replaces it. See
[ADR 0024](../../../docs/adr/0024-verification-ladder-erase-mcp-required-interpreter.md).

**Verification ladder** — for any step that needs more than a textual
acknowledgement, prefer, in order:

1. a **`shell` empirical check** — a short, observable safety gate (a file
   written, an exit code, a directory state);
2. a **critic-loop `subagent` call**, looped until it returns `PASS`;
3. a **`subagent` instructed to call the MCP tool** and verify its outcome from a
   re-read;
4. fallback: a single **`comment`** acknowledgement.

**Shell contracts are safety gates, not puzzles.** Keep `cmd` short and readable.
`interpreter` is **required** (`bash | sh | python3 | python | node`) — there is
no default, and `train`/`tune` reject a shell contract without one. When a step
needs multi-line or structured logic, especially anything that touches **JSON**,
attach a **script artifact** to the adapter's frontmatter; the executing agent
exports it into its working directory and runs it. Match the script language to
the repository (`node` for JS/TS, `python3` for Python tooling; `bash` only for
light file/text work). Full rules and examples live in
[`challenge-type-guide.md`](challenge-type-guide.md).

**One contract per adapter is the default.** Guidance and reference documents
carry a single `comment` acknowledgement, not one per section. More contracts
appear only where each step is independently executable and gated (an executable
adapter such as [`author-adapter.md`](author-adapter.md)).

## Protocols

| File | Slug | Purpose |
|------|------|---------|
| [author-adapter.md](author-adapter.md) | `author-adapter` | Authoring adapter — create, review, or refactor SQUADRULES protocols |
| [refine-search.md](refine-search.md) | `refine-search` | Refine search — recover user intent after failed `activate` |
| [critic-loop.md](critic-loop.md) | `critic-loop` | Phase-boundary adversarial review — verify claims against evidence |

### Linked authoring flow

```text
author-adapter (Author) → forward(squadrules://adapter/critic-loop) → critic-loop (Critic-Loop Review) → train (with review_evidence)
```

## Reference Documents

| File | Slug | Purpose |
|------|------|---------|
| [challenge-type-guide.md](challenge-type-guide.md) | `challenge-type-guide` | Challenge type selection, interpreter choice, and stronger verification patterns |
| [protocol-linking-guide.md](protocol-linking-guide.md) | `protocol-linking-guide` | Layers vs chains, `activate` vs `forward` + slug, chaining back/forward, multi-layer conductor vs extension URI, chain-root collapsing, chain-link target handling |
| [critic-loop-guide.md](critic-loop-guide.md) | `critic-loop-guide` | Critic-loop integration rules, mutation gates, solution check vs critic decision table |

## Cross-Protocol Linking

### Layers vs chains

**Layers (H2 steps within one adapter)** are the preferred unit of work. Use
layers when all steps fit in one adapter under 350 lines and serve a single
cohesive concern.

**Chain via `forward` + slug** — use when:

- the adapter exceeds 350 lines
- weaker models cannot follow the full adapter in one pass
- runtime routing to different adapters is needed (Router pattern)
- a step is reusable across multiple parent adapters (e.g. `critic-loop`)

Chaining is NOT a replacement for layers. A 6-step protocol that fits in 350
lines should stay as one adapter with 6 H2 layers.

### How forward + slug works

Both system and user-authored adapters chain using slugs in `next_action`:

```text
call forward with squadrules://adapter/critic-loop and no solution to start the critic loop
call forward with squadrules://adapter/implement-terraform and no solution to start this adapter
```

Slugs are globally unique (enforced by `train`), so resolution is
deterministic — no scoring, no ambiguity.

### Verifying chain links

The `mcp` argument-check contract was **erased** (ADR 0024); there is no longer
a server-side argument-superset check. Link integrity is carried by the
verification ladder (see **Contract policy** above). To require that a specific
downstream link actually ran, delegate it to a **`subagent`** instructed to call
`forward` on the exact slug and report the outcome it earned:

```json
{"contract":{"type":"subagent","subagent":{"context":"Delegate: call forward with squadrules://adapter/code-review-policy, then report the final contract type and the result."},"required":true}}
```

Because a delegation is observable only through the returned report, gate a
hard-to-undo link with an objective `shell` check or a critic-loop `subagent` PASS
wherever an artifact makes that possible; reserve the bare delegation for steps
with nothing empirically observable.

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
