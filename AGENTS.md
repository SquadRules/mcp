# SquadRules

Repository-specific agent guidance for this codebase. This file is a **thin
router**: it states what SquadRules is, points to the single sources of truth, and
keeps only the notes agents need at **runtime**.

SquadRules MCP is a Model Context Protocol server for persistent memory and
deterministic adapter execution. It stores workflows as linked adapters whose
layers can carry proof-of-work challenges. You execute an adapter run by calling
**`activate`** (semantic match), then **`forward`** for each layer's contract
(loop until `next_action` directs you to **`reward`**), then **`reward`** to
finalize the run. Every hash, nonce, and identifier is server-generated; echo
them verbatim — never compute them.

## Core functionality

Action routing for agents is defined in
**[`.agents/skills/squadrules/SKILL.md`](.agents/skills/squadrules/SKILL.md)** — the
single source of truth for the **`activate`** → **`forward`** → **`reward`**
chain (hosts also load it from `~/.agents/skills/squadrules/SKILL.md`). Do not paste
that routing guidance here; keep it in one place.

If SquadRules MCP is **unavailable or unauthenticated**, treat that as a **critical
error** and stop; fix the host connection per
**[docs/install/README.md#cursor-and-mcp](docs/install/README.md#cursor-and-mcp)**
and **[`.agents/skills/squadrules-dev/references/mcp-host-bridge.md`](.agents/skills/squadrules-dev/references/mcp-host-bridge.md)**.

For **real MCP calls**, follow the **connected server's** tool names, schemas,
and descriptions; for **implementation in this repository**, follow this
worktree's source, tests, and embedded docs (`src/embed-docs/tools/` is the
authoritative execution contract).

## Development

- **Contributor setup, build/test contract, code style, and design
  principles:** [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Maintainer workflows** (build/test, bug-fix ship, release, MCP QA, Git
  safety, UI specs, wiki publishing): the
  [`squadrules-dev`](.agents/skills/squadrules-dev/SKILL.md) skill and its
  [`references/`](.agents/skills/squadrules-dev/references/).
- **Code-derivable reference** (architecture, auth, storage, search, workflow
  engine, testing topology): the
  [project Wiki](https://github.com/SquadRules/mcp/wiki).

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
  at `http://localhost:3300/mcp` (see `docs/install/README.md#cursor-and-mcp`).
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
missing, follow
**[`.agents/skills/squadrules-dev/references/mcp-host-bridge.md`](.agents/skills/squadrules-dev/references/mcp-host-bridge.md)**
(probe with minimal calls first; do not continue without required MCP — ask the
user to fix auth or config). Cursor-specific `server` id resolution is in the
same reference under **Cursor-specific**.

## Legacy skill paths

The former `kairos` and `kairos-dev` skill directories are retained under
`.agents/skills/` for backward compatibility with existing installations. If
`.agents/skills/squadrules/` is present, hosts should prefer it over the legacy
`kairos/` directory to avoid duplicate routing registration.
