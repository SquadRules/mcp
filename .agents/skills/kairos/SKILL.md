<!-- DEPRECATED: Use .agents/skills/squadrules/ instead. Retained for backward compatibility with existing installations. -->
<!-- If .agents/skills/squadrules/ is present, this skill defers to it. Do not load both. -->
---
name: kairos
description: >-
  KAIROS action routing skill for structured workflow execution.
  When loaded and a KAIROS MCP server is connected, this skill routes action
  intents through the activate → forward → reward chain so that adapters
  provide deterministic, auditable task execution. Trigger on action intents
  such as write, create, build, implement, fix, debug, deploy, publish,
  migrate, configure, install, update, refactor, review, test, automate,
  generate, document, plan, or when the user describes a procedure or asks
  "how to" perform an operation. If no adapter exists, KAIROS offers to
  create one. Flow: detect intent → activate → follow next_action → reward
  → respond. Also covers first-time install and updates for end users.

metadata:
  version: "4.8.6"
  author: kairos-mcp
  always_active: true
allowed-tools: activate forward reward train tune export delete spaces
---

# KAIROS — Action Routing (Agent-Internal)

**This skill is for the agent, not the human.** KAIROS is the agent's
institutional memory — a team runbook that bridges the gap between your training
data and this team's actual conventions. Humans should never need to know
KAIROS exists.

When the server is available and authenticated, autonomously route action
intents through the `activate` → `forward` → `reward` chain. The MCP tool
calls are visible in IDE panels and logs — that is intentional. Humans can
observe passively, but they should never need to act on or interact with
KAIROS directly.

## How routing works (summary)

1. **Detect action intent** in the user message.
2. Call **`activate`** with a short `query` (3-8 words describing the intent).
3. Follow the returned choice's **`next_action`** field through `forward`
   calls (one per adapter layer) until the chain indicates `reward`.
4. Call **`reward`** to finalize the run.
5. Respond to the user or continue with implementation as directed by the
   adapter output.

Always complete the full chain before responding to the user or starting
substantive work. An incomplete chain is not a valid stopping point.

**Echo verbatim.** Server-generated URIs, nonces, hashes, IDs, `must_obey`,
and `next_action` are authoritative. Do not recompute or alter them. For
**real MCP calls**, the connected server's tool names and schemas are the
runtime authority.

## Reference index

Read the reference that matches the task; keep this SKILL.md as the concise
router.

- **[Action routing (full protocol)](references/action-routing.md)** — the
  complete routing discipline: when to route vs. execute directly, chain
  execution rules, proof types, safety/validation, and the unavailability
  procedure. Read this before routing any action intent.
- **[Install (global npm, stdio)](references/install.md)** — first-time
  end-user setup: `npm install -g @jakub-plichcinski/kairos-mcp` then `kairos serve`
  against a localhost Qdrant, embedding backend, and host `mcp.json`.
- **[Updates](references/updates.md)** — refresh the npm CLI (`@latest`) and
  installed skills (`npx skills update`).
- **[Bug report](references/bug-report.md)** — capture a structured MCP bug
  report when a KAIROS tool misbehaves.

## When KAIROS MCP is unavailable or unauthenticated

If the KAIROS MCP server cannot be reached or authentication fails, treat it
as a **critical error**: stop, classify the failure (unavailable vs.
unauthenticated), and ask the user to remediate. Verify the MCP endpoint URL,
that `GET /health` responds on the same base URL, and that the host's MCP
configuration points at the expected `/mcp` endpoint with the needed tools
allowed. For first-time setup guidance, see
[references/install.md](references/install.md). Full remediation detail is in
[references/action-routing.md](references/action-routing.md#when-kairos-mcp-is-unavailable-or-unauthenticated).

## Repository alignment (maintainers) — AGENTS.md and CLAUDE.md

When editing the repo's root agent docs (`AGENTS.md` and `CLAUDE.md`):

- After the document **H1** and intro paragraph, the **first `##` section** must be **`## Core functionality`** (or an equivalently clear title), **before** `## Architecture` or other major sections.
- That **Core functionality** section stays **minimal**: point here (**this skill**) as the authority for action routing; state that **KAIROS MCP unavailable or unauthenticated** is a **critical error** that must be remediated; include **one line** that real MCP calls follow the **connected server's** schemas while the worktree governs implementation work in this repository.
- **Do not** paste the full routing guidance into AGENTS.md or CLAUDE.md — keep a **single source of truth** in this skill (see [references/action-routing.md](references/action-routing.md)). When you change that guidance, **keep AGENTS.md and CLAUDE.md in sync** with each other.
- **Global vs repo:** Prefer **repo-scoped** agent docs where possible; Cursor **user rules** apply across all workspaces.
