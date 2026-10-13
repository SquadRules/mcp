The `docs/` tree is a curated documentation surface organized into four sub-trees:
- `adr/` — Architecture Decision Records (0001–0015), one decision per numbered Markdown file following the context/decision/consequences/evidence template defined in `adr/README.md`; superseded decisions are not rewritten but marked via Status.
- `examples/` — human-readable adapter and test examples (MCP, shell, user-input, comment, all-types) plus a twelve-step linear test walkthrough.
- `security/` — audit log, threat model, incident runbook, and code-security setup.
- Top-level `CLI.md` and `README.md` serve as entry points; the root README explicitly routes code-derivable content to the Qoder RepoWiki and declares `.qoder/rules/documentation-authority.md` as the governance source.
Dependency direction is outward only: this module references sibling repositories (`SquadRules/containers`, `SquadRules/charts`) and the GitHub Wiki, but no code under `src/` depends on it.