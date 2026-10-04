# Agent skills — squadrules-mcp

Canonical path: **`.agents/skills/`**. Agent hosts load repo-scoped skills from
**`.agents/`** and user-scoped skills from **`~/.agents/`**. The `skills` CLI
also discovers this directory, so `npx skills add jakub-plichcinski/squadrules-mcp` works.

This repository ships exactly **two** discoverable skills:

| Skill | Audience | Purpose |
|-------|----------|---------|
| [`squadrules`](squadrules/SKILL.md) | **Users** | Action routing (`activate` → `forward` → `reward`), first-time install, updates, and MCP bug reports. This is the only skill end users install. |
| [`squadrules-dev`](squadrules-dev/SKILL.md) | **Developers** | Docker Compose dev environment plus every maintainer workflow. Marked `metadata.internal: true` so it is hidden from user-facing `npx skills add` listings, while cloned-repo hosts still auto-load it. |

Depth lives in each skill's `references/` (progressive disclosure); keep each
`SKILL.md` a concise router.

## `squadrules` (user) references

- [`references/action-routing.md`](squadrules/references/action-routing.md) — full routing discipline.
- [`references/install.md`](squadrules/references/install.md) — npx zero-config stdio install.
- [`references/updates.md`](squadrules/references/updates.md) — refresh CLI + installed skills.
- [`references/bug-report.md`](squadrules/references/bug-report.md) — structured MCP bug report.

## `squadrules-dev` (developer) references

| Task | Reference |
|------|-----------|
| Docker Compose full-stack dev environment | [dev-environment.md](squadrules-dev/references/dev-environment.md) |
| Build, deploy, test (npm-only; `dev:deploy` before `dev:test`) | [build-test.md](squadrules-dev/references/build-test.md) |
| Phased E2E MCP QA against **SQUADRULES-DEVELOPMENT** | [mcp-qa-e2e.md](squadrules-dev/references/mcp-qa-e2e.md) |
| Bug reproduce → failing test → fix → PR → CI → merge-ready | [bugfix-ship.md](squadrules-dev/references/bugfix-ship.md) |
| Releases/prereleases, semver levels, tag policy | [release-semver.md](squadrules-dev/references/release-semver.md) |
| Human-facing `src/ui/` UX/spec, a11y, tokens | [ui-spec.md](squadrules-dev/references/ui-spec.md) |
| Git without opening a blocking editor | [git-editor-safe.md](squadrules-dev/references/git-editor-safe.md) |
| Git index / `write-tree` repair | [git-index-repair.md](squadrules-dev/references/git-index-repair.md) |
| Worktree `.env*` and port collisions | [worktree-env.md](squadrules-dev/references/worktree-env.md) |
| Documentation drift audit (DRY governance) | [doc-governance.md](squadrules-dev/references/doc-governance.md) |
| MCP server id resolution / host bridge | [mcp-host-bridge.md](squadrules-dev/references/mcp-host-bridge.md) |
| Authoring agent skills in this repo | [skill-authoring.md](squadrules-dev/references/skill-authoring.md) |

## MCP environments

This repo commonly uses three MCP server instances, each with a different
purpose and authority boundary:

- **`SQUADRULES`**: Live server. Authoritative for everything; use it with the
  [`squadrules`](squadrules/SKILL.md) skill. Here you (the agent) act as a user.
- **`SQUADRULES-DEVELOPMENT`**: Development instance built from this worktree,
  configured in [`.agents/mcp.json`](../mcp.json). Use it as a developer/QA to
  validate local code changes.
- **`SQUADRULES-HELM-INTEGRATION`**: Kubernetes instance built from the Helm chart
  in `helm/`, configured in [`.agents/mcp.json`](../mcp.json). Use it as a
  developer/QA of the Helm chart. The app version can vary.

Full host-bridge troubleshooting: [mcp-host-bridge.md](squadrules-dev/references/mcp-host-bridge.md).

## Default developer flow (muscle memory)

1. **Change code** → obey [`AGENTS.md`](../../AGENTS.md) and the
   [`squadrules`](squadrules/SKILL.md) skill for any adapter/tool execution story.
2. **Verify** → [build-test.md](squadrules-dev/references/build-test.md)
   (`dev:deploy` → `dev:test`).
3. **MCP regression** → [mcp-qa-e2e.md](squadrules-dev/references/mcp-qa-e2e.md).
4. **Production bug** → [bugfix-ship.md](squadrules-dev/references/bugfix-ship.md)
   (`reports/` via the `squadrules` skill's
   [bug-report.md](squadrules/references/bug-report.md)).
5. **Release** → [release-semver.md](squadrules-dev/references/release-semver.md).
6. **UI work** → [ui-spec.md](squadrules-dev/references/ui-spec.md).
7. **Git pain** → [git-editor-safe.md](squadrules-dev/references/git-editor-safe.md)
   + [git-index-repair.md](squadrules-dev/references/git-index-repair.md).
8. **New worktree / missing `.env`** →
   [worktree-env.md](squadrules-dev/references/worktree-env.md).
9. **Wiki sync** → no skill: the
   `sync-qoder-repowiki-to-github-wiki` workflow runs `scripts/sync-wiki.sh` on
   push to `main`. See [doc-governance.md](squadrules-dev/references/doc-governance.md).
10. **Doc drift / DRY audit** →
    [doc-governance.md](squadrules-dev/references/doc-governance.md).
11. **MCP server id / auth errors** →
    [mcp-host-bridge.md](squadrules-dev/references/mcp-host-bridge.md).

## Authoring rules

- One primary concern per reference; link to
  [`CONTRIBUTING.md`](../../CONTRIBUTING.md) / [`AGENTS.md`](../../AGENTS.md)
  instead of forking command lists.
- Keep each `SKILL.md` a concise router (~500 lines max); push depth into
  `references/`.
- Links **out of a skill** must be absolute `https://github.com/...` URLs
  (skills are npx-installable onto machines without this repo); intra-skill
  links stay one level deep (`references/x.md`).
- `npm run lint:skills` validates `.agents/skills/`, including the no-relative-
  link rule for each `SKILL.md`.
