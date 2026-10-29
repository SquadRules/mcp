# Scripts

This directory holds maintainer and automation helpers. Prefer **`npm run …`** from the repo root `package.json` instead of invoking shell entrypoints directly unless you know you need to.

## Naming (CI-style stages)

File names use a **prefix** so you can see which pipeline stage they belong to:

| Prefix | Meaning |
|--------|---------|
| **`lint-`** | Static checks and policy gates (skills layout, forbidden patterns in `src/`) |
| **`build-`** | Codegen, packaging, and build-time config consumed by Vite/tsc (`prebuild`, `.tgz`) |
| **`test-`** | Test drivers, fixtures, and integration helpers (including Playwright captures) |
| **`ci-`** | **GitHub Actions workflow glue** — step wrappers, `$GITHUB_STEP_SUMMARY`, infra polling, etc. |
| **`ci-test-`** | CI-oriented **test verification** (e.g. install smoke checks for release tarballs); still run locally via `npm run` when needed |
| **`deploy-`** | Local/prod **environment** lifecycle: `.env`, Compose/Keycloak, CLI readiness, raw Qdrant probes |
| **`agent-`** | Agent runtime helpers invoked by always-on agent rules (not part of a CI pipeline stage) |

**Rule:** Workflow orchestration in `scripts/` **must** start with **`ci-`** (e.g. `ci-github-step-summary.mjs`, `ci-wait-for-infra.sh`). Scripts whose main job is **test-style checks for CI / release** may use **`ci-test-`** (e.g. `ci-test-tgz-install.mjs`) instead of plain `test-`. (Jest’s job-summary reporter stays under `tests/reporters/` because Jest loads it by path.)

`src/embed-docs/` is **not** under `scripts/`; it is the source tree the **`build-embed-docs`** step reads.

## Overview

Most work flows through **npm scripts**, which call **Node/Python** utilities for lint/build/test. **CI** uses **`ci-*`** helpers for `$GITHUB_STEP_SUMMARY`. Keycloak JSON under `keycloak/import/` is applied by **`deploy-configure-keycloak-realms.py`**.

```mermaid
flowchart TB
  pkg["package.json npm scripts"]
  pre["prebuild"]
  embed["build-embed-docs.ts"]
  ci["GitHub Actions integration.yml"]
  kc["deploy-*.py Keycloak"]
  data["keycloak/import JSON"]
  manual["direct node / python3 …"]
  pkg --> pre
  pre --> embed
  ci --> pkg
  ci --> kc
  kc --> data
  pkg --> manual
```

## Script index

Paths are relative to the repo root (`scripts/…`). **Used from** lists primary call sites; *manual* means there is no `npm` script.

| Script | What it does | Used from |
|--------|----------------|-----------|
| `scripts/deploy-dev-cli-ready.sh` | Waits for local MCP readiness; may run Keycloak realm configure when admin password is set | *manual* (its former `npm run dev:cli-ready` target was retired) |
| `scripts/deploy-copy-env-from-main.sh` | In a git worktree, copies `.env` from the main worktree when missing | *manual* standalone helper (formerly invoked by the retired `deploy-run-env.sh`) |
| `scripts/env/create-env.sh` | Thin wrapper: creates `.env` via secrets generator when you use this entrypoint | Invokes `deploy-generate-dev-secrets.py` |
| `scripts/ci-wait-for-infra.sh` | Polls Redis, Qdrant, Postgres, and Keycloak in Docker Compose (CI) | `.github/workflows/integration.yml` |
| `scripts/deploy-add-keycloak-demo-user.sh` | Adds `demo` user to `squadrules-dev` via `kcadm` inside the Keycloak container | Documented in `scripts/keycloak/import/README.md` |
| `scripts/deploy-generate-dev-secrets.py` | Fills repo-root `.env` from `scripts/env/.env.template` (secrets from env or generated) | `.github/workflows/integration.yml`, `scripts/env/create-env.sh`; see `docs/keycloak/README.md` and `compose/infra.yaml` comments |
| `scripts/deploy-configure-keycloak-realms.py` | Idempotent realm admin: merges `scripts/keycloak/import/*.json`, clients, groups, test users | `deploy-dev-cli-ready.sh`, `.github/workflows/integration.yml`, `tests/global-setup-auth.ts`, `tests/utils/keycloak-container.ts` (run after `docker compose … --profile fullstack up -d`) |
| `scripts/deploy-add-keycloak-user` | Adds a realm user with auto-generated password via Admin REST API | `scripts/keycloak/import/README.md` (examples) |
| `scripts/agent-task-isolation.py` | Creates and verifies an isolated linked worktree for an agent task (ownership receipt in the worktree's Git admin dir) | `.qoder/rules/task-isolation.md`, `tests/scripts/agent-task-isolation.test.mjs` |
| `scripts/lint-agent-skills.py` | Validates agent skills layout against repo rules | `npm run lint:skills` |
| `scripts/lint-verify-clean-source.mjs` | Prebuild gate: forbids `console.*` and test mocks under `src/` (AST-based) | `npm run verify:clean` (`prebuild`) |
| `scripts/build-embed-docs.ts` | Bundles `src/embed-docs/**` into generated TS resources for the server | `npm run prebuild` (`npx ts-node scripts/build-embed-docs.ts`) |
| `scripts/build-embed-docs-slug-meta.ts` | Slug/frontmatter helpers for `build-embed-docs.ts` | Imported by `build-embed-docs.ts` only |
| `scripts/build-vite-ui-env-define.ts` | Exposes package version to Vite/Vitest via `import.meta.env` | `vite.config.ts`, `vitest.config.ts` |
| `scripts/build-sync-skill-versions.mjs` | Propagates `package.json` version into versioned agent skills and every shipped built-in adapter under `src/embed-docs/mem/`; check mode rejects missing/stale built-in versions | `npm run prebuild`, `npm run version:sync-skills`, `npm run version:check-skills`, Release Please PR synchronization |
| `scripts/ci-test-tgz-install.mjs` | Installs the built tarball into a temp dir to verify packaging | `npm run test:tgz` |
| `scripts/ci-github-step-summary.mjs` | Runs a subprocess and appends a Vitest-style block to `$GITHUB_STEP_SUMMARY` | `.github/workflows/integration.yml` (many steps) |
| `scripts/ci-typecheck-tests-report.mjs` | Report-only type-check of `tests/` (`tsconfig.tests.json` — the Jest suite plus the `tests/ui` Vitest suite): prints an error-code histogram + appends a `$GITHUB_STEP_SUMMARY` block, always exits 0 (gate landed in #180; backlog burn-down tracked in #184) | `npm run typecheck:tests`, `.github/workflows/integration.yml` (report-only step) |
| `scripts/test-embedding-key.mjs` | Quick check that `OPENAI_API_KEY` can call the configured embedding model | `npm run dev:test-embedding-key` |
| `scripts/test-capture-viewports.mjs` | Playwright capture of UI viewports for design review | `npm run design:viewports` |
| `scripts/test-integration-app-base-url.mjs` | Resolves local SQUADRULES base URL from env (shared helper) | `test-ai-mcp-integration.mjs`, `test-capture-viewports.mjs` |
| `scripts/deploy-raw-qdrant-search.mjs` | Runs a raw scroll/search against Qdrant using env config | *manual* — `node -r dotenv/config scripts/deploy-raw-qdrant-search.mjs "query"` (its former `npm run prod:raw-qdrant-search` target was retired) |
| `scripts/test-ai-mcp-integration.mjs` | End-to-end AI MCP integration driver (reports, proof flow) | *manual* — `node scripts/test-ai-mcp-integration.mjs` (its former `npm run dev:ai-mcp-integration` target was retired); listed in `.github/codeql/codeql-config.yml` |
| `scripts/test-ai-mcp-integration-auth-utils.mjs` | Bearer/auth header helpers for integration scripts | `test-ai-mcp-integration.mjs` |
| `scripts/test-ai-mcp-integration-proof-utils.mjs` | Proof/challenge helpers for integration scripts | `test-ai-mcp-integration.mjs` |
| `scripts/test-ai-mcp-integration-report-utils.mjs` | Report formatting for integration output | `test-ai-mcp-integration.mjs`, `tests/unit/ai-mcp-integration-report-utils.test.ts` |

### Related files (not executable scripts)

| Path | Role |
|------|------|
| `scripts/env/.env.template` | Template consumed by `deploy-generate-dev-secrets.py` |
| `scripts/keycloak/import/*.json` | Realm JSON merged by `deploy-configure-keycloak-realms.py` (see `scripts/keycloak/import/README.md`) |
| `scripts/squadrules-db-init/README.md` | Notes for DB init assets |

## Troubleshooting

1. **Looking for the old `dev`/`prod` profile runner?**  
   It is retired. `npm start` runs the env-less **SINGLE** mode (stdio + embedded LanceDB, no auth, zero config). Override any component with shell/CI env (e.g. `TRANSPORT_TYPE=http`, `QDRANT_URL=…`, `AUTH_ENABLED=true`) or by editing `.env`. There is no `deploy-run-env.sh` and no `.env.dev_*` profile to source.

2. **Shell scripts fail with “Permission denied”**  
   Ensure execute bits are set (e.g. `chmod +x scripts/deploy-dev-cli-ready.sh scripts/ci-wait-for-infra.sh`). Clone and umask differences sometimes drop `+x`.

3. **Python Keycloak scripts fail with 401 or connection errors**  
   Confirm Keycloak is up (`docker compose -p squadrules-mcp --env-file .env -f compose/infra.yaml --profile fullstack up -d` or your stack), `KEYCLOAK_URL` matches, and `KEYCLOAK_ADMIN_PASSWORD` is set in `.env`. For realm JSON changes, re-run `python3 scripts/deploy-configure-keycloak-realms.py`.

4. **Node reports wrong version or missing modules**  
   This repo expects **Node 24 LTS or newer** (`package.json` `engines`). Run `npm ci` at the repo root after pulling; scripts assume dependencies are installed.

5. **CI-only helpers print nothing locally**  
   `ci-github-step-summary.mjs` only appends to `$GITHUB_STEP_SUMMARY` when that variable is set (GitHub Actions). Running it locally still runs the wrapped command; the summary file is simply absent.
