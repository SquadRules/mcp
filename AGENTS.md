# SquadRules

Repository guidance for agents developing SquadRules. The development
constitution below governs all product, code, documentation, and workflow
changes. Operational instructions live in the linked skills.

## Core functionality

Action routing for agents is defined in
**[`.agents/skills/squadrules/SKILL.md`](.agents/skills/squadrules/SKILL.md)** — the
single source of truth for the **`activate`** → **`forward`** → **`reward`**
chain (hosts also load it from `~/.agents/skills/squadrules/SKILL.md`). Do not paste
that routing guidance here; keep it in one place.

If SquadRules MCP is **unavailable or unauthenticated**, treat that as a **critical
error** and stop; fix the host connection per
**[README.md#manual-installation](README.md#manual-installation)**.

For **real MCP calls**, follow the **connected server's** tool names, schemas,
and descriptions; for **implementation in this repository**, follow this
worktree's source, tests, and embedded docs (`src/embed-docs/tools/` is the
authoritative execution contract).

## Development constitution

**Agent ownership and autonomous execution are the organizing principles of
SquadRules.** Apply them to every development decision.

1. **Build for agents.** SquadRules is a framework where AI agents exchange
   knowledge of user and team preferences and procedures. Agents are its only
   operational users. One AI and one human already form a team. Ideally, humans
   never need to know SquadRules exists; installation material may address them.
2. **Agents own their workflows.** Agents must create, repair, and maintain
   adapters when preferences change or execution exposes missing, ambiguous,
   or outdated instructions. Repairing an inadequate adapter is part of finishing
   the task. Keep shared knowledge within its intended team and scope.
3. **Consult team knowledge before acting.** Familiarity with a task, including
   a simple Git commit, does not establish this team's preferences. The skill
   must establish this habit and require maintenance when execution exposes gaps.
4. **Make built-in adapters teach autonomy.** Teach agents to find, execute,
   create, repair, and share workflows. Use semantic search to discover related
   knowledge. Use explicit links for required steps or dependencies, with clear
   inputs, results, and continuation; avoid forced related-reading chains.
5. **Keep entry points aligned.** The skill and MCP prompt must expose the same
   core instructions from a shared source. Changes must not let them drift.
6. **Support less capable models.** Write brief, precise instructions with
   explicit conditions, exact next actions, and observable completion criteria.
   Remove repetition, not necessary guidance. Keep state handling, validation,
   and recovery in the framework rather than asking agents to infer them.
7. **Respect real boundaries.** Avoid unnecessary human involvement. Use existing
   authorization, but never invent a preference or permission to avoid a necessary
   question. Ask only for genuinely missing decisions or authority.
8. **Verify the real outcome.** Completing a tool sequence does not prove the
   user's task succeeded. Report evidence honestly, repair recoverable failures,
   and identify unresolved blockers.

These are development requirements, not a claim that every current adapter or
runtime path already complies. Review changes against them and fix conflicting
instructions within the change's scope. Keep this section as the single source
of truth; other contributor documents should link here.

## Development

- **Task isolation — read before any edit:**
  [`.qoder/rules/task-isolation.md`](.qoder/rules/task-isolation.md). The main
  checkout is human-only; every task runs in its own linked worktree with an
  ownership receipt.
- **Contributor setup, build/test contract, code style, and design
  principles:** [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Code-derivable reference** (architecture, auth, storage, search, workflow
  engine, testing topology): the
  [project Wiki](https://github.com/SquadRules/mcp/wiki).
- **Architecture Decision Records** ([`docs/adr/`](docs/adr/)): when making
  significant architectural decisions (CI topology, runtime model, embedding
  provider, storage backend, etc.), create or update an ADR. One decision per
  file; state the context, decision, consequences, and evidence. Update the
  ADR index (`docs/adr/README.md`) when adding new records.

## Runtime authority split

**CRITICAL:** Agents are connected to a real SquadRules MCP server at runtime.
Use the version shown at connect, the connected server's tool list, and the
connected server's tool descriptions as the authority for MCP calls.

When the connected MCP surface differs from this worktree:

- For actual MCP calls, follow the connected server's runtime contract.
- For code changes in this repo, implement the target behavior described by
  this branch's source, tests, and embedded docs.
- If runtime and worktree differ, call out the mismatch before proceeding.
- Do not use the current branch name as protocol authority. Branch names are a
  hint only.

## Cursor agent MCP server identifiers

When using Cursor's **agent MCP bridge** (`call_mcp_tool`), the **server**
argument is **not** always the same string as the key in `.cursor/mcp.json`.

- **Config key (human / `mcp.json`):** e.g. `SQUADRULES-DEVELOPMENT` for local dev
  at `http://localhost:3300/mcp`.
- **Agent-visible id:** Cursor prefixes or transforms the key. Examples:
  **`project-<n>-<workspace-folder-slug>-<key>`** for workspace-scoped MCP,
  **`user-<Name>`** for user-level servers (e.g. Context7), **`plugin-…`** for
  plugin-supplied MCP, and other forms. With this repo as workspace root
  `mcp`, a common SquadRules dev id is `project-0-mcp-SQUADRULES-DEVELOPMENT`.

**If `call_mcp_tool` fails with "MCP server does not exist"**, read the error's
**Available servers** list (or check Cursor's MCP panel) and use the entry that
corresponds to your configured server — often the one ending in
`-SQUADRULES-DEVELOPMENT` for local dev. Do not treat any single example string as
portable across workspaces or Cursor versions.

**MCP auth or availability:** If a tool fails with auth errors or the server is
missing, probe with minimal calls first; do not continue without required MCP —
ask the user to fix auth or config.

## Legacy skill paths

The `squadrules` skill directory under `.agents/skills/` is the canonical
routing skill. If `.agents/skills/squadrules/` is present, hosts should prefer it
over any legacy top-level `squadrules/` directory to avoid duplicate routing
registration.
