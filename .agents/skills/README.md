# Agent skills — squadrules-mcp

Canonical path: **`.agents/skills/`**. Agent hosts load repo-scoped skills from
**`.agents/`** and user-scoped skills from **`~/.agents/`**. The `skills` CLI
also discovers this directory, so `npx skills add jakub-plichcinski/squadrules-mcp` works.

This repository ships exactly **one** discoverable skill:

| Skill | Audience | Purpose |
|-------|----------|---------|
| [`squadrules`](squadrules/SKILL.md) | **Users** | Action routing (`activate` → `forward` → `reward`), first-time install, updates, and MCP bug reports. This is the only skill end users install. |

Depth lives in the skill's `references/` (progressive disclosure); keep
`SKILL.md` a concise router.

## `squadrules` (user) references

- [`references/action-routing.md`](squadrules/references/action-routing.md) — full routing discipline.
- [`references/install.md`](squadrules/references/install.md) — npx zero-config stdio install.
- [`references/updates.md`](squadrules/references/updates.md) — refresh CLI + installed skills.
- [`references/bug-report.md`](squadrules/references/bug-report.md) — structured MCP bug report.

## Authoring rules

- One primary concern per reference; link to
  [`CONTRIBUTING.md`](../../CONTRIBUTING.md) / [`AGENTS.md`](../../AGENTS.md)
  instead of forking command lists.
- Keep `SKILL.md` a concise router (~500 lines max); push depth into
  `references/`.
- Links **out of a skill** must be absolute `https://github.com/...` URLs
  (skills are npx-installable onto machines without this repo); intra-skill
  links stay one level deep (`references/x.md`).
- `npm run lint:skills` validates `.agents/skills/`, including the no-relative-
  link rule for `SKILL.md`.
