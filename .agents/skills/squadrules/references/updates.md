# Updates — refresh the CLI and installed skills

Keep both the SquadRules server/CLI and the installed agent skills current.

## Update the server / CLI (npm package)

Upgrade the globally installed package to the latest release:

```bash
npm install -g @squadrules/mcp@latest
squadrules --help
```

Pin a specific version by replacing `@latest` with `@<version>` when you need
reproducibility.

## Update the installed skills

The SquadRules agent skills are distributed through the `skills` CLI. Refresh them
with:

```bash
npx skills update
```

To (re)install just the user skill by name:

```bash
npx skills add SquadRules/mcp --skill squadrules
```

`squadrules` is the only user-facing skill. The maintainer skill `squadrules-dev` is
developer-scoped (marked internal) and is auto-loaded from a cloned repository;
end users do not install it.

## After updating

- Restart your MCP host so it re-launches `squadrules serve` with the new version.
- If a SquadRules tool misbehaves after an update, capture a report per
  [bug-report.md](bug-report.md).
