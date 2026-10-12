# SquadRules documentation router

Thin router for the curated `docs/` tree. Anything derivable from code —
architecture, the HTTP/MCP API, the workflow engine, memory, auth internals, the
CLI surface, testing, UI, and artifacts — lives in the project **Wiki**
(generated from the Qoder RepoWiki), not here. This directory holds only the
irreducible, non-code-derivable records enumerated by the
`documentation-authority` rule.

## Start here

- [Architecture decision records](adr/README.md) — why each decision was taken
  and when it expires; one decision per file.
- [CLI reference](CLI.md) — invocation, global options, the command surface, and
  output formats for the `squadrules` tool.

## Elsewhere

- Project Wiki — the source of truth for code-derivable content:
  <https://github.com/SquadRules/mcp/wiki>
- Container images, Docker Compose deployment, and the Helm chart are owned by
  sibling repositories, not this one:
  [`SquadRules/containers`](https://github.com/SquadRules/containers) and
  [`SquadRules/charts`](https://github.com/SquadRules/charts).

## Governance

Documentation authority and the DRY doctrine (what has a single home, and where)
are defined in `.qoder/rules/documentation-authority.md`. Link checks run through
`npm run lint:docs`; markdown style through `npm run lint:markdown`.
