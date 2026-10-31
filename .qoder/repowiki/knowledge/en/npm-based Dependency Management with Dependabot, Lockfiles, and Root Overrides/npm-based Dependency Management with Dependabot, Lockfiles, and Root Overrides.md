---
kind: dependency_management
name: npm-based Dependency Management with Dependabot, Lockfiles, and Root Overrides
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - docs/adr/0014-always-latest-mcp-spec-and-sdk.md
    - docs/adr/0018-automated-dependency-pr-merge-via-reconcile.md
    - docs/adr/0030-tokenizers-arm64-native-binding-override.md
    - scripts/ci-automation.mjs
    - .github/workflows/npm-audit-fix.yml
---

## System / Approach

The SQUADRULES MCP Server Runtime is a Node.js/TypeScript project managed exclusively through **npm**:
- `package.json` declares direct dependencies.
- `package-lock.json` pins the full transitive tree (lockfile-first).
- No vendored `node_modules`; no `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock`.
- The package is published as the global CLI `@squadrules/mcp` (`npm install -g @squadrules/mcp`).

Dependency updates flow from two producers into GitHub PRs that must pass the same three required gates as human PRs (Integration, Security, Automation policy):
1. **Dependabot** — enabled for security advisories only; version PRs are disabled via `open-pull-requests-limit: 0` in Dependabot settings.
2. **`npm-audit-fix` workflow** — an hourly fallback that runs `ci-audit.mjs` and opens its own PR when Dependabot cannot resolve a production moderate-or-higher advisory.

Automated merging is handled by a custom reconcile loop in `scripts/ci-automation.mjs` (`reconcile()`, `managedPull()`, `orderPulls()`), which squash-merges eligible dependency PRs every 6 hours after verifying all required gate runs passed on the PR head SHA and branch protection is enforced. Renovate was explicitly removed (ADR 0018, Issue #73); Dependabot owns all version updates.

## Key Files

- `package.json` — root dependency declarations and npm `overrides` block.
- `package-lock.json` — deterministic lockfile committed to the repo.
- `docs/adr/0014-always-latest-mcp-spec-and-sdk.md` — policy that `@modelcontextprotocol/sdk` is tracked at the latest release rather than a stale caret floor.
- `docs/adr/0030-tokenizers-arm64-native-binding-override.md` — documents the root `overrides["@anush008/tokenizers"] = "^0.6.0"` used to force a compatible native binding matrix.
- `docs/adr/0018-automated-dependency-pr-merge-via-reconcile.md` — merge policy for Dependabot and `npm-audit-fix` PRs.
- `scripts/ci-automation.mjs` — reconcile implementation (unit-tested in `tests/scripts/automation.test.mjs`).
- `.github/workflows/auto-update-pr-branches.yml` — current auto-merge workflow (superseded ADR 0018's `auto-merge-deps.yml`).
- `.github/workflows/npm-audit-fix.yml` — audit fallback producer.

## Architecture and Conventions

### Semver posture
- Most dependencies use caret ranges in `package.json` (e.g. `fastembed@^3.0.0`, `@modelcontextprotocol/sdk@^1.32.1`), relying on `package-lock.json` for determinism.
- MCP SDK currency is treated as a product concern, not a routine chore: ADR 0014 mandates tracking the latest published MCP spec revision and adopting newly added surfaces (e.g. `server/discover`) deliberately, with Dependabot owning security PRs but no auto-merge rule pointing at "latest".

### Transitive override strategy
- Root-level `package.json` `overrides` is used to pin transitive dependencies when upstream semver floors are broken. The canonical example is forcing `@anush008/tokenizers` to `^0.6.0` so `fastembed` resolves a complete napi binding matrix including `linux-arm64-gnu` and `linux-arm64-musl`. This is documented in ADR 0030 and verified by `tests/unit/tokenizers-arm64-override.test.ts`.
- The override does **not** propagate to consumers of the published tarball; downstream repos (e.g. `SquadRules/containers`) must keep their own override.

### Lockfile-driven caching
- CI caches embedding models keyed off `hashFiles('package-lock.json')` (ADR 0007) so model downloads are reused across runs per dependency change.
- Cache keys under release stamping also hash `package-lock.json` alongside source files (ADR 0005).

### Private registries
- No `.npmrc`, `GOPRIVATE`, or private registry configuration was found in the repository surface examined. All dependencies referenced in the ADRs and docs resolve against the public npm registry.

### Vendor strategy
- No vendoring of third-party code. Dependencies are installed from npm at build time.

## Conventions and Constraints

- **Lockfile is authoritative**: `package-lock.json` is committed and hashed in cache keys; dependency changes require refreshing the lockfile (ADR 0030 evidence cites refreshed lockfile).
- **Security-only Dependabot**: version bumps from Dependabot are suppressed (`open-pull-requests-limit: 0`); only security advisories open PRs (ADR 0018).
- **Audit fallback**: when Dependabot cannot resolve an advisory, the `npm-audit-fix` workflow produces a replacement PR (ADR 0018).
- **Gate-enforced merges**: dependency PRs are automatically squash-merged only after Dependabot/audit-fix PRs pass Integration, Security, and Automation policy gates; failed/pending gate runs are skipped (ADR 0018).
- **MCP SDK currency is manual/scheduled**: despite Dependabot handling security, ADR 0014 states there is no auto-merge rule pointing at "latest" for the MCP SDK major/minor bump — it is a deliberate, separate change.
- **Transitive overrides live at the root**: `package.json` `overrides` is the mechanism for fixing broken transitive semver floors (ADR 0030); nested overrides in published packages are ignored by npm.
- **No Renovate**: Renovate was removed and Dependabot owns all updates (ADR 0018).