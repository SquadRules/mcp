---
name: squadrules-dev
description: >-
  squadrules-mcp maintainer umbrella (developer-scoped, internal). Loads the
  Docker Compose full-stack development environment plus every maintainer
  workflow for this repository: build/deploy/test, MCP end-to-end QA, bug
  fix-to-ship, semver releases, UI/UX specs, git editor-safe commands, git
  worktree index repair, worktree .env handling, documentation governance,
  and MCP host-bridge server selection. Trigger when working ON the
  squadrules-mcp codebase as a developer/maintainer: running the dev stack,
  building, testing, releasing, fixing defects, or auditing docs. Not for
  end users — the user-facing skill is `squadrules`. Each workflow lives in a
  reference under references/; read the one that matches the task.
metadata:
  author: squadrules-mcp
  internal: true
---

# SquadRules — Developer / Maintainer Umbrella

**Developer-scoped, internal.** This skill is for maintainers working **on**
the squadrules-mcp repository. End users never need it — they use the `squadrules`
skill. `metadata.internal: true` keeps it out of user-facing
`npx skills add` listings while cloned-repo agent hosts still auto-load it
from `.agents/skills/`.

Everything a maintainer needs is split into focused references. Read the one
that matches your task; do not paste their content elsewhere (single source of
truth).

## Development environment (Docker Compose full stack)

For anything beyond the end-user npx path, run the repository the way CI does:
Docker Compose full stack via npm scripts.

- **[dev-environment.md](references/dev-environment.md)** — spin up the local
  full stack (`npm ci`, `npm run infra:up`, `dev:deploy`), ports, and how it
  maps to [CONTRIBUTING.md](https://github.com/SquadRules/mcp/blob/main/CONTRIBUTING.md).
- **[build-test.md](references/build-test.md)** — the authoritative build /
  deploy / test contract: npm scripts only, always `dev:deploy` before
  `dev:test`. Read this before running any test.

## Maintainer workflow index

| Task | Reference |
|------|-----------|
| Build, deploy, run the test suite | [build-test.md](references/build-test.md) |
| Phased end-to-end MCP QA against SQUADRULES-DEVELOPMENT | [mcp-qa-e2e.md](references/mcp-qa-e2e.md) |
| Fix a reported bug from reproduction to merge-ready PR | [bugfix-ship.md](references/bugfix-ship.md) |
| Cut a release or prerelease (dispatch Release workflow) | [release-semver.md](references/release-semver.md) |
| Human-facing UI/UX specs and accessibility for `src/ui/` | [ui-spec.md](references/ui-spec.md) |
| Run Git without spawning a blocking editor | [git-editor-safe.md](references/git-editor-safe.md) |
| Recover a corrupted Git index / `write-tree` failure | [git-index-repair.md](references/git-index-repair.md) |
| `.env*` handling and port collisions across worktrees | [worktree-env.md](references/worktree-env.md) |
| Audit and repair documentation drift (DRY governance) | [doc-governance.md](references/doc-governance.md) |
| Resolve which MCP server id to call (host bridge) | [mcp-host-bridge.md](references/mcp-host-bridge.md) |
| Author or edit agent skills in this repo | [skill-authoring.md](references/skill-authoring.md) |

## Repo Wiki publishing (no skill)

Publishing `.qoder/repowiki/en/content/` to the GitHub Wiki is **not** a manual
skill. Qoder regenerates the RepoWiki, and the
[`sync-qoder-repowiki-to-github-wiki`](https://github.com/SquadRules/mcp/blob/main/.github/workflows/sync-qoder-repowiki-to-github-wiki.yml)
workflow runs [`scripts/sync-wiki.sh`](https://github.com/SquadRules/mcp/blob/main/scripts/sync-wiki.sh)
on push to `main`. See [doc-governance.md](references/doc-governance.md).
