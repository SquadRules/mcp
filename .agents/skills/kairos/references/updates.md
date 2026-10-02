<!-- squadrules-compat-surface: skill directory + name: frontmatter (kairos / kairos-dev) are retained invocation identifiers; path/filename rename is an explicit non-goal and body prose references these names plus the retained kairos CLI alias -->
# Updates — refresh the CLI and installed skills

Keep both the KAIROS server/CLI and the installed agent skills current.

## Update the server / CLI (npm package)

Upgrade the globally installed package to the latest release:

```bash
npm install -g @jakub-plichcinski/kairos-mcp@latest
kairos --help
```

Pin a specific version by replacing `@latest` with `@<version>` when you need
reproducibility.

## Update the installed skills

The KAIROS agent skills are distributed through the `skills` CLI. Refresh them
with:

```bash
npx skills update
```

To (re)install just the user skill by name:

```bash
npx skills add jakub-plichcinski/kairos-mcp --skill kairos
```

`kairos` is the only user-facing skill. The maintainer skill `kairos-dev` is
developer-scoped (marked internal) and is auto-loaded from a cloned repository;
end users do not install it.

## After updating

- Restart your MCP host so it re-launches `kairos serve` with the new version.
- If a KAIROS tool misbehaves after an update, capture a report per
  [bug-report.md](bug-report.md).
