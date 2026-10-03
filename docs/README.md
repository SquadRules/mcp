# SquadRules MCP documentation

This directory holds **curated knowledge that is not derivable from the code**,
plus a few **functional inputs** consumed by the build and tests. Everything
that *can* be regenerated from the source tree — architecture, transport, auth
internals, storage, search, the adapter execution engine, tool workflows, UI,
and testing topology — lives in the auto-generated **project Wiki**, which is
the single source of truth for those topics.

- Product overview and quick start: root [README](../README.md)
- Code-derivable reference (architecture, auth, workflows, search, logging,
  deployment, testing): **[project Wiki](https://github.com/SquadRules/mcp/wiki)**

> Rule of one: a fact has exactly one home. Pages here link to the Wiki for
> code-derivable topics instead of restating them. See the
> `documentation-authority` rule under `.qoder/rules/` for the full doctrine.

## Install and CLI (functional inputs)

Sources under `install/` and `CLI.md` are functional inputs consumed by the
build and tests; keep them build-accurate.

- [Install index](install/README.md) — entry point and diagram
- [Prerequisites](install/prerequisites.md)
- [Docker Compose — simple stack](install/docker-compose-simple.md) — Qdrant +
  app (default profile)
- [Optional `fullstack` Compose note](install/docker-compose-full-stack.md) —
  not a Keycloak install guide
- [Helm deployment](install/helm.md)
- [CLI reference](CLI.md) — `squadrules`, auth, batch
  training
- [SquadRules bundles](squadrules-bundles.md) — bundle layout plus export/import paths

## Curated operator knowledge (not in the code)

- [Keycloak notes (operators)](keycloak/README.md) — outside the install path
- [Google sign-in for Keycloak (dev)](keycloak/google-auth-dev.md)

## Examples and adapter authoring (test fixtures)

Files under `examples/` are read by
`tests/integration/write/squadrules-train-docs-examples.test.ts`; treat them as fixtures.

- [Adapter examples](examples/README.md) — trainable example adapters
- [Challenge types](examples/challenge-types.md) — challenge/solution shapes

## Business use-cases

- [Business overview](business/README.md)
- [Compliance review from PDF](business/case-compliance-review-from-pdf.md)
- [Standardize commits and merge requests](business/case-standardize-commits-and-merge-requests.md)
- [Terraform module standardization](business/case-terraform-module-standardization.md)

## Security and operations (curated)

- [Security policy](../SECURITY.md)
- [Threat model](security/threat-model.md)
- [Incident runbook](security/incident-runbook.md)
- [Code security setup](security/code-security-setup.md)
- [Audit log](security/audit-log.md)
- [Known issues and limitations](known-issues-and-limitations.md)

## Specs

- [Artifact export parity spec](specs/artifact-export-parity-spec.md)

## Skills and contributor guidance

- [Agent skills README](../.agents/skills/README.md) — the two shipped skills
  (`squadrules`, `squadrules-dev`) and their reference index.
- [Skill authoring guide](../.agents/skills/squadrules-dev/references/skill-authoring.md)
  — how a skill can bundle an adapter, declare requirements, and run
  **activate** → **train** if missing → **forward** / **reward**.
- [Contributing](../CONTRIBUTING.md)
- [Developer commands](../CONTRIBUTING.md#developer-commands) — build, deploy,
  and test (`dev:build`, `dev:deploy`, `dev:test`). Always deploy before testing.
- [Agent-facing design principles](../CONTRIBUTING.md#agent-facing-design-principles)
  — doctrine for MCP tools, schemas, descriptions, and error shapes.
