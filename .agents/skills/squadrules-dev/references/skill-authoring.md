---
name: sqd-dev-skill-authoring
description: >-
  squadrules-mcp: how agent skills are organized and authored in this repo. Skills
  live under .agents/skills/ (squadrules, squadrules-dev), each a directory with a
  required SKILL.md and optional references/. Covers the spec, folder layout,
  and CI validation (npm run lint:skills). Use when adding or editing a skill or
  a references/ file in this repository.
---

# Skills folder — references and structure (skill authors)

Generic info for **skill authors**: how the `.agents/skills/` folder is
organized in this repo and where to author. We do not ship one skill per SquadRules
protocol (agent skill slots are limited; protocols are unlimited). For **using**
and installing skills, see
[the skills README](https://github.com/SquadRules/mcp/blob/main/.agents/skills/README.md).

## References

- **[Agent Skills specification](https://agentskills.io/specification)** — Canonical format: skill directory, `SKILL.md` YAML frontmatter (`name`, `description`, optional `license`, `compatibility`, `metadata`, `allowed-tools`), optional `scripts/`, **`references/`**, `assets/`, progressive disclosure, validation with **`skills-ref`**. The former Anthropic spec file now points here; see also [anthropics/skills](https://github.com/anthropics/skills).
- **[Anthropic: Agent skills overview](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview)** — Product docs for skills in Claude agents.
- **[skills CLI (vercel-labs/skills)](https://github.com/vercel-labs/skills)** — `npx skills add`, list, remove, init; discovery paths and supported agents.
- **[Claude Code: Extend Claude with skills](https://code.claude.com/docs/en/skills)** — Where skills live (personal, project, plugin), frontmatter (for example `disable-model-invocation`, `context: fork`), arguments (`$ARGUMENTS`), dynamic context, subagents.
- **[The Agent Skills Directory (skills.sh)](https://skills.sh/)** — Discover and install skills with `npx skills add <owner/repo>`; supports Cursor, Claude Code, and other agents.

## Folder structure

In this repo, skills are discovered under **`.agents/skills/`**. Each skill is a
directory with a required `SKILL.md` and optional supporting dirs per the
[Agent Skills spec](https://agentskills.io/specification). Agent hosts also load
these from `~/.agents/skills/` when the repo is not checked out.

```
.agents/skills/
├── README.md              # How to use these skills (skill index)
├── squadrules/            # Everyday user-facing workflow skill (shipped via npx skills add)
│   ├── SKILL.md
│   └── references/        # action-routing.md, bug-report.md, install.md, updates.md
└── squadrules-dev/        # Maintainer umbrella (internal; metadata.internal: true)
    ├── SKILL.md
    └── references/        # build-test.md, release-semver.md, doc-governance.md, this file, …
```

- **`squadrules`** is the everyday, user-facing skill. Bug-report and install
  guidance are **`references/`** under `squadrules/` (`references/bug-report.md`,
  `references/install.md`) — not separate top-level skills.
- **`squadrules-dev`** is the maintainer-only umbrella. `metadata.internal: true`
  keeps it out of user-facing `npx skills add` listings while cloned-repo hosts
  still auto-load it. It has no version field (see
  [`release-semver.md`](release-semver.md) §4) and its `references/` hold the
  maintainer workflows.

## Per-skill layout (spec-aligned)

- **`SKILL.md`** — Required. YAML frontmatter (`name`, `description`) and markdown body. Optional: `argument-hint`, `allowed-tools`, `license`, `compatibility`, `metadata`.
- **`references/`** — Optional. Extra Markdown loaded on demand; use paths like
  `[guide](references/REFERENCE.md)` one level deep from `SKILL.md` (per spec).
- **`scripts/`** — Optional. Runnable tooling the agent can invoke.
- **`assets/`** — Optional. Templates, images.

Keep `SKILL.md` under ~500 lines; put detail in referenced files.

## Validating skills

The repo runs skill validation in CI and optionally on pre-commit when files
under `.agents/skills/` are staged. Validation uses **skills-ref** from the
[Agent Skills spec](https://agentskills.io/specification#validation) (Python),
driven by **`scripts/lint-agent-skills.py`**.

- **CI / local:** `npm run lint:skills` (part of `npm run lint`).
- If `skills-ref` is not installed locally, `npm run lint:skills` skips and exits
  0; CI still validates. To validate locally, install the same pip package and
  ensure `skills-ref` is on your `PATH`.

## Version metadata

`npm run version:sync-skills` (via `scripts/build-sync-skill-versions.mjs`) sets
`metadata.version` in each **direct-child** `.agents/skills/<name>/SKILL.md`
(e.g. `squadrules`) to the last stable tag; `squadrules-dev` has no version field and is
skipped. See [`release-semver.md`](release-semver.md) §4 for the full contract.

## Relation to existing docs

This repository includes deeper documentation for maintainers, but a shipped
skill may be installed on machines that do not have this repo checkout. Keep the
user-facing `squadrules` `SKILL.md` self-contained and avoid relative links to
repository files there; maintainer references (this `squadrules-dev` tree) may link
within `references/` since they only ship with the repo.
