---
name: sqd-dev-mcp-qa-e2e
description: >-
  squadrules-mcp: phased E2E QA of SquadRules MCP tools against SQUADRULES-DEVELOPMENT
  (local dev).
  Phase 1 MCP-only; phase 2 read-only repo + raw JSON trace reports under
  .local/mcp-qa-reports/; phase 3 failing integration tests; phase 4 plan
  and fix. Not installed via npx skills add (see .agents/skills/README.md).
---

# MCP E2E QA (squadrules-mcp)

**Repository:** `squadrules-mcp`. **Skill:** part of `squadrules-dev` (developer,
internal) — see
[`.agents/skills/README.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/README.md). **Not** shipped via `npx skills add`
(the user-facing `squadrules` skill is).

Use this skill for **structured end-to-end verification** of SquadRules MCP tools
against **local dev** (`SQUADRULES-DEVELOPMENT` in `.agents/mcp.json`), with strict
phases so QA does not read implementation source before you intend to.

`SQUADRULES-DEVELOPMENT` exists to validate **local code changes**. Do not treat it
as authoritative for adapters.

## Target MCP server

This skill targets `SQUADRULES-DEVELOPMENT`. Use the other environments only for
their stated purposes.

- **`SQUADRULES`**: Live. Treat it as authoritative for everything. When using it,
  you (the agent) act as a user and run workflows via the shipped
  [`.agents/skills/squadrules/SKILL.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/squadrules/SKILL.md).
- **`SQUADRULES-DEVELOPMENT`**: Local development server built from this worktree.
  Use it as a developer/QA to validate local code changes.
- **`SQUADRULES-HELM-INTEGRATION`**: Kubernetes instance built from the Helm chart in
  `helm/`. Use it as a developer/QA of the Helm chart to validate the Helm
  deployment process and app availability.

- **Config key:** `SQUADRULES-DEVELOPMENT` (see `docs/install/README.md#cursor-and-mcp`).
- **`call_mcp_tool` `server` argument:** the host's agent-visible id often differs.
  Resolve it from the error's **Available servers** list or the host's MCP panel.
  A common pattern is `project-0-mcp-SQUADRULES-DEVELOPMENT` — **do not** treat
  that as portable.
- **Auth / missing server:** [`mcp-host-bridge.md`](mcp-host-bridge.md).

For **real** tool names, schemas, and descriptions at runtime, treat the
**connected server** as authority; for **what this branch should do**, use this
worktree's `src/embed-docs/tools/`, source, and tests (after phase 1).

## Phase 1 — MCP-only verification

**Goal:** Exercise tools (and MCP resources if relevant) **only** through the
MCP bridge.

**Allowed**

- `call_mcp_tool`, `list_mcp_resources`, `fetch_mcp_resource` (and any
  host-required MCP discovery the IDE provides).
- **Adapter-governed runs:** **`activate`** → **`forward`** (loop per
  `next_action`) → **`reward`**. Follow
  [`.agents/skills/squadrules/SKILL.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/squadrules/SKILL.md) zero-drift rules.
  File paths, URIs, or payloads required **by the latest server response** are
  in scope for that run only.

**Not allowed in phase 1**

- Workspace **`Read`**, **`Write`**, **`Grep`**, **`SemanticSearch`**, or
  **`Glob`** against this repository for expectations, test matrices, or
  "checking implementation."
- **Shell** whose purpose is inspecting or changing repo files (including `cat
  src/...`, ripgrep in-tree, ad hoc scripts against the worktree).

**Host plumbing (narrow exception)**

- Your host may surface tool **schemas** as JSON under an MCP cache path. Using
  those descriptors **only** to shape valid `call_mcp_tool` arguments is host
  plumbing, **not** permission to read `src/` or `tests/` for product logic. If
  unsure, stay MCP-only until the user ends phase 1.

## Phase 2 — Read-only repo; write reports under `.local/`

**Start phase 2** after phase 1 ends (pass or fail).

**Allowed**

- **Read-only** use of the repo: embedded docs (`src/embed-docs/`), tests,
  `CONTRIBUTING.md`, etc., to interpret results or draft regressions.

**Writes**

- **Only** under **`.local/`** (gitignored). Create
  **`.local/mcp-qa-reports/`** if missing.
- Filename pattern:
  **`mcp-qa-<short-description>-<YYYY-MM-DD>.md`**
  (adjust date format if the run spans days; keep sortable dates).

### Report contents (mirror `squadrules-bug-report` rigor)

Match the **six-section** contract from
[`.agents/skills/squadrules/references/bug-report.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/squadrules/references/bug-report.md):

1. **Summary** — one sentence: outcome + server id + tool/resource.
2. **Calls and responses** — chronological **raw JSON** request then response
   per call (fenced `json`). Verbatim except **secret redaction**. Include
   **every** retry if the server signals retries; do not collapse attempts.
3. **Reasoning** — why each call; interpretation; **fault attribution**
   (agent error / server error / unclear) when something failed, with evidence.
4. **Environment / context** — SquadRules version, dependency health when available,
   OS/IDE, **env var names only** (no values for secrets).
5. **Reproduction** — minimal steps; expected vs actual.
6. **Checklist before saving** — same style of `- [ ]` items as
  `squadrules-bug-report` (adapt wording from "bug" to "QA run" where helpful).

**Before the Environment section:** when you have a dev **HTTP API base** (not
the MCP URL), `GET <SQUADRULES_API_URL>/health` and record `version` and
`dependencies` like the bug-report skill. **Do not invent** URLs.

**Difference from `squadrules-bug-report`:** mergeable public reports go under
`reports/` per that skill; **this** workflow keeps QA artifacts in **`.local/`**
only.

## Phase 3 — Regression tests (red before green)

1. Follow **[`sqd-dev-build-test`](build-test.md)**:
   `npm run dev:deploy`, then focused
   `npm run dev:test -- tests/integration/<file>.test.ts`.
2. Add or extend **`tests/integration/`** so the defect **fails** a test.
3. Run that test **without** production code fixes to confirm red-then-green
   discipline.

**Hard stop:** do not use ad hoc `npx jest` / bare `jest` as the default path.

## Phase 4 — Plan and fix

1. Switch to **Plan mode** (or equivalent maintainer planning) to agree on the
   fix scope and risks.
2. Implement, **`npm run dev:deploy`**, re-run the focused test, then
   **`npm run dev:test`** before handoff.
3. If the outcome is a **live** defect with full ship workflow, also follow
   **[`sqd-dev-bugfix-ship`](bugfix-ship.md)**.

## Related skills

| Skill | Role |
|-------|------|
| [`.agents/skills/squadrules/SKILL.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/squadrules/SKILL.md) | Adapter execution order and zero drift. |
| [`.agents/skills/squadrules/references/bug-report.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/squadrules/references/bug-report.md) | Trace layout for phase 2 (public `reports/` path). |
| [`sqd-dev-build-test`](build-test.md) | npm-only test contract. |
| [`sqd-dev-bugfix-ship`](bugfix-ship.md) | End-to-end bug fix to merge-ready. |

## CI note

`npm run lint:skills` validates only **`skills/`** via **`scripts/lint-agent-skills.py`**.
This **`.agents/skills/`** file follows the same frontmatter conventions without being in that lint path.
