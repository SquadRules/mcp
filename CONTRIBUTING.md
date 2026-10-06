# Contributing to SquadRules MCP

SquadRules MCP is an MCP server for persistent memory and deterministic
adapter execution. This document is the definitive contract for
contributors: setup, workflow, code conventions, and PR requirements.

## Principles

These principles apply to architecture, APIs, code, and documentation.

- **Agents are the primary users.** Optimize the interface for agent
execution, not human aesthetics.
- **Determinism over ambiguity.** Prefer one correct next action over
many possible actions.
- **Teach in the interface.** Tool descriptions, schemas, and errors
must explain what to do next.
- **Schemas match enforcement.** What hosts show in JSON Schema and what
`src/embed-docs/tools/` describe must agree with runtime validation for the
same tool; agents plan from schemas—drift becomes systematic mis-calls.
- **Server generates; agent echoes.** Identifiers, nonces, and proof
hashes are server-owned. The agent copies them back exactly.
- **Backend orchestrates complexity.** Validation, retries, state,
idempotency, and integrations live behind the interface.
- **Make failure recoverable.** Errors must be actionable. Retry paths
must be explicit.
- **Keep the core small.** Add primitives only when they unlock many
workflows or eliminate systemic failure modes.

## Agent-facing design principles

Apply these when contributing MCP tools, agent-facing REST APIs, or
changes to tool schemas and descriptions.

### 1. MCP users are AI agents

Primary users are AI agents, not humans. Design for programmatic
consumption. Every field name, description, and instruction is written
for LLM comprehension. Avoid vague messages like "Try again"; use
structured, actionable instructions.

### 2. LLM-friendly frontend

- **Consistent names.** Same concept = same name everywhere.
- **Unambiguous instructions.** Spell out exactly what to do.
- **Server generates; agent echoes.** Hashes, nonces, and identifiers
are server-owned; the agent copies them back exactly.
- **Describe field purpose in schema** so the agent knows when and how
to use each field.
- **Errors teach, don't punish.** Error messages must guide the agent
to correct and retry.

### 3. Frontend vs backend roles

- **Frontend (MCP tools, schemas, descriptions):** Optimize for agent
comprehension and execution.
- **Backend:** Orchestrate complexity — business logic, validation,
retries, idempotency, and state.
- **Spaces: names at the frontend, IDs in the backend.** Tool
parameters and responses use space **names**. The backend resolves
names to space **IDs** for Qdrant filters and Redis keys.

### 4. Outputs designed for execution

- **Embed URIs in `next_action`.** Prefer `next_action` with exact URIs
and instructions the agent can copy.
- **Always provide an actionable next step** on success.
- **must_obey semantics:** `must_obey: true` means the agent must
follow `next_action`; `must_obey: false` means the agent may choose
among options.
- **Unify response shapes** across tools to reduce patterns the agent
must learn.

### 5. Error outputs that help execution

- **Errors are recoverable by default.** Include fresh challenge data
on error so the agent can retry without re-fetching.
- **Field-level rejection.** For invalid tool arguments, surface paths
  (for example as `invalid_fields`) and distinguish missing fields from wrong
  types or pattern violations so the model can edit one key and retry.
- **Include `next_action` in errors** with exact retry instructions.
- **Use structured error codes** for monitoring and agent branching.
- **Retry escalation:** Retries 1–N use `must_obey: true` with a
deterministic correction path. After N retries, `must_obey: false`
allows repair, abort, or escalation.
- Use a circuit breaker to avoid infinite retry loops.

### 6. Self-correcting workflows

- Support repair paths (for example, update the step or abort after
max retries).
- When **activate** finds no match, offer a deterministic **train**
(create adapter) path.
- Keep **`reward`** a simple finalization; make the last layer a normal
verification step.

### 7. Contract, schema parity, and vocabulary

Agents plan from **JSON Schema** (`tools/list`), **tool descriptions**, and
**the last response body**. Those three must not contradict the runtime
validator (for example Zod `safeParse` in the tool handler). If the SDK needs a
loose envelope so malformed calls still reach the handler, the **published**
schema and docs must still describe the **strict** contract agents should aim
for—never the reverse.

- **Structured contract first.** Anything required for correctness belongs in
  structured fields (`contract`, tool args, `error_code`, `invalid_fields`).
  Natural-language `next_action` **supplements** the contract; it does not
  replace it.
- **Shell proof status is structured evidence.** Shell proof success is the
  real process status reported in `solution.shell.exit_code`, not the presence
  or absence of stdout. When documenting silent shell checks, require a final
  agent-readable status marker that preserves the same process status, and
  treat stdout and stderr as supporting evidence only.
- **Ground every proof in server output.** Nonces, `proof_hash`, `execution_id`,
  and canonical URIs returned by the previous step are the anchors agents must
  echo. Instructions that can be satisfied without reading the last response
  train fabrication, not compliance.
- **Disambiguate URI lanes in errors and docs.** Adapter execution uses
  `squadrules://adapter/...` and `squadrules://layer/...`. Do not reuse phrasing that
  suggests other URI families (for example `squadrules://mem/...` protocol chains)
  apply to **`forward`** unless this server truly accepts them there.
- **Surgical validation errors.** Prefer machine-oriented paths
  (`invalid_fields`), stable `error_code` values, and messages that distinguish
  **missing** vs **wrong JSON type** vs **pattern or enum mismatch**, plus one
  copy-paste-safe retry example that matches the schema.
- **Localized recovery.** Prefer errors that let the agent **fix one argument
  and retry the same tool** with the same run identifiers, instead of implying a
  full restart unless the run is invalid.
- **Depth belongs in resources.** Keep tool descriptions scannable; put long
  narratives in `src/embed-docs/tools/` (and link or name them in the tool doc).

### 8. Checklist for new or changed APIs

- Outputs use LLM-friendly, consistent field names.
- `next_action` embeds exact URIs and instructions.
- **`tools/list` input schema matches runtime validation** for required fields,
  types, and patterns (or the docs explicitly state the strict contract when the
  wire schema is intentionally permissive).
- Errors include recovery instructions and fresh data to retry.
- Two-phase error handling: retry first, then grant autonomy.
- No redundant fields; single source of truth for each concept.
- Server generates identifiers and hashes; agent echoes them.
- Self-correction paths (for example, **`tune`** / **`train`**) are
exposed and documented.
- A creation fallback exists when no match is found.

## Code of conduct

Participants must maintain a respectful and inclusive environment.

## Prerequisites

- Node.js >= 24.0.0 (Node 24 LTS and Node 26 Current are required CI lanes — see `.github/workflows/integration.yml` and `.github/workflows/README.md`)
- Docker and Docker Compose (v2)
- Git

### SquadRules MCP protocol (agents and editors)

When **SquadRules** is connected as an MCP server (for example **Cursor** →
Installed MCP Servers → **SquadRules**), run stored workflows in this order:

1. `**activate`** — use the user’s intent as `query` (or a short phrase).
   Optional `space` / `space_id` narrows search (same forms as **`train`** /
   **`tune`**). Match rows include **`space_name`**. Use **`spaces`** to list
   allowed spaces; **`train`** + `source_adapter_uri` forks into another space;
   **`tune`** + `space` moves an adapter.
2. `**forward**` — first call with the **adapter** URI from the chosen
  `next_action` and **no** `solution`; then call again with each **layer**
   URI and a `solution` matching `contract.type` until `next_action` points
   to `**reward`**.
3. `**reward**` — finalize with the **layer** URI from the final forward
  response (include `execution_id` when required). When a step sets
   `must_obey: true`, do not treat the task as finished until `**reward`**
   succeeds.

**Rules**

- Follow each response’s `**next_action`** and the tool’s `**must_obey**`
fields.
- Authoritative text for contributors is in `**AGENTS.md**` and
`**src/embed-docs/tools/**` (`activate`, `forward`, `reward`, `train`,
`tune`, `export`, `delete`, `spaces`).
- Echo server-issued **nonce** and **proof_hash** values **verbatim** in
the next call; never compute or guess them.

A `**/squadrules`**invocation in agents that load the **squadrules** skill means:
start with `**activate`**, then complete `**forward**` through `**reward**`
before answering the user.

**Git vs MCP:** branches, commits, and pull requests follow the sections
below. The activate → forward → reward sequence above runs **against the SquadRules server** your editor
targets (for example **SQUADRULES LIVE**), not against Git.

### Claude Code (`.claude/hooks`)

`.claude/*` is ignored by Git except `**.claude/settings.json`** (see
`.gitignore`). Do not add hook scripts to version control unless the
maintainers explicitly choose to track them.

## Development environment (local dev stack)

Users install SquadRules from npm and let their agent host spawn
`squadrules serve` (see the root [README](README.md) and
[docs/install/](docs/install/README.md)). Contributors run the app itself via
`npm run dev*` on the host, and start the backing infrastructure locally via
`compose/infra.yaml`: Qdrant by default; optionally Valkey, Postgres, and
Keycloak under the `fullstack` profile.

Requirements: Docker + Docker Compose v2, Node.js 24+, and a `.env` at the repo
root (from [`scripts/env/.env.template`](scripts/env/.env.template)).

```bash
npm ci                 # install dependencies
npm run infra:up       # start Qdrant, Valkey, Postgres, Keycloak (fullstack)
npm run dev:deploy     # build + (re)start the dev server (uses .env)
npm run dev:test       # run the integration suite against the running server
```

For the pure-npm / LanceDB / fastembed dev loop (no Docker required), use
`npm run dev_simple:deploy` and `npm run dev_simple:test`; for stdio MCP host
smoke testing use `npm run dev_stdio:deploy`.

The `fullstack` Compose profile provides the optional cache / DB / OIDC
services. **Keycloak / IdP configuration is your responsibility** — see the
Deployment and Operations pages in the
[project Wiki](https://github.com/SquadRules/mcp/wiki).

The [`squadrules-dev`](.agents/skills/squadrules-dev/SKILL.md) agent skill documents
this environment plus every maintainer workflow (build/test, bug-fix ship,
release, QA, wiki publishing). Its reference files live under
[`.agents/skills/squadrules-dev/references/`](.agents/skills/squadrules-dev/references/).

## Setup from clone to passing tests

1. Fork the repository on GitHub.
2. Clone your fork:

  ```bash
   git clone https://github.com/YOUR_USERNAME/mcp.git
   cd mcp
  ```

1. Install dependencies:

  ```bash
   npm ci
  ```

1. Create **`.env`** at the repository root from
   [`scripts/env/.env.template`](scripts/env/.env.template), then set variables
   for your dev stack (embeddings, Qdrant, Valkey, session, and any IdP secrets you
   use). **IdP setup is not part of `docs/install/`** — see the
   Deployment and Operations topic in the [project Wiki](https://github.com/SquadRules/mcp/wiki).
2. Start infrastructure (Compose `fullstack` profile and helpers as needed):

  ```bash
   npm run infra:up
  ```

1. Deploy and run tests:

  ```bash
   npm run dev:deploy && npm run dev:test
  ```

All tests pass against a running dev server. Deploy before testing —
tests run against the live process, not in-process.

## Developer commands

All build, deploy, and test operations are npm scripts. **Always deploy before testing:** tests run against the running dev server, so deploy your changes first.

**Build**

```bash
npm run dev:build    # lint + knip + ui build + TypeScript build path used by dev deploy
```

**Deploy**

```bash
npm run dev:deploy   # dev:build + restart dev server
```

**Test**

Deploy first, then run only what you need. Prefer a single test file during development instead of the full suite.

```bash
# Deploy so the dev server has your changes
npm run dev:deploy

# Run a single test file (recommended while iterating)
npm run dev:test -- tests/integration/readonly/squadrules-dump.test.ts

# Run the full integration suite when done or before PR
npm run dev:test
```

To test without Keycloak, set `AUTH_ENABLED=false` in `.env`, then
deploy and test. To override without editing the file:

```bash
AUTH_ENABLED=false npm run dev:test
```

**Test with Keycloak (AUTH_ENABLED=true)**

Jest global-setup starts Keycloak via Testcontainers when `KEYCLOAK_URL`
is unset, provisions the test user, and writes
`.test-auth-env.dev.json`. The app must already be running.

```bash
npm run dev:deploy
KEYCLOAK_URL= AUTH_ENABLED=true npm run dev:test -- \
  tests/integration/auth-keycloak.test.ts
```

**CLI auth E2E (browser login):** If the CLI auth E2E test fails, check
`reports/` for `e2e-cli-auth-failure-*.png` and `*.html` to see what
Keycloak rendered (screenshot and page HTML are saved on failure).

**Dev environment controls**

```bash
npm run dev:start     # start
npm run dev:stop      # stop
npm run dev:restart   # restart
npm run dev:logs      # view logs
npm run dev:status    # check status
npm run dev:redis-cli # Redis CLI (dev)
npm run dev:qdrant-curl # Qdrant via curl (dev)
```

**Infrastructure**

```bash
# Starts Redis, Qdrant, Postgres, Keycloak.
# Requires QDRANT_API_KEY, REDIS_PASSWORD, KEYCLOAK_ADMIN_PASSWORD,
# and KEYCLOAK_DB_PASSWORD in .env.
npm run infra:up
```

**Code quality**

```bash
npm run lint          # ESLint
npm run lint:fix      # ESLint with auto-fix
npm run lint:skills   # Validate shipped agent skills
npm run verify:clean  # check for uncommitted changes
npm run knip          # dead code / unused exports
```

**Docker**

```bash
npm run docker:build  # build image (quay.io/squadrules/mcp)
```

**Snapshot management**

Set `QDRANT_SNAPSHOT_ON_START=true` to enable automatic Qdrant backups on
boot. Override `QDRANT_SNAPSHOT_DIR` for the path (default `/snapshots`
in Docker; use `./data/qdrant/snapshots` in dev). Trigger on demand:
`POST /api/snapshot`.

## Project structure

```
src/               TypeScript source
src/embed-docs/    Built-in adapter workflows embedded as MCP resources
dist/              Compiled output (generated)
tests/             Test files
tests/test-data/   Test fixtures
tests/workflow-test/ Workflow test harness; prompt in tests/workflow-test/PROMPT.md
reports/           Workflow test output (gitignored except .gitkeep)
docs/examples/     Mintable adapter examples for dev workflow tests
.agents/skills/    Shipped agent skills (squadrules, squadrules-dev)
scripts/           Build and utility scripts
```

## Contribution workflow

1. Create a branch from `main`:

  ```bash
   git checkout -b feature/your-feature-name
  ```

1. Make your changes.
2. Run tests: `npm run dev:deploy && npm run dev:test`
3. Run the full handoff check: `npm run handoff`
4. Commit with a descriptive message (see commit conventions below).
5. Push and open a pull request against `main`.

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) — semantic-release derives release versions from these types (`release.config.mjs`):

- `feat:` — new feature (releases a **minor**)
- `fix:` — bug fix (releases a **patch**)
- `feat!:` / `fix!:` or a `BREAKING CHANGE:` footer — breaking change (releases a **major**)
- `perf:` — performance improvement (releases a **patch**)
- `chore(deps):`, `chore(deps-dev):`, `deps:` — historical dependency updates (patch)
- `docs:` / other `chore:` / `refactor:` / `ci:` / `test:` — no release on their own

Scope suffixes are encouraged for readability, e.g. `feat(ui):`, `fix(ci):`.

## PR requirements

- All tests pass (`npm run dev:test`).
- `npm run handoff` completes without errors.
- Docs are updated when behavior changes.
- Branch is up to date with `main`.
- PR description states what changed, why, and how to test it.

## Merge queue (repository setting)

To enable a [merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) for `main` (GitHub’s equivalent of GitLab merge trains):

1. **Repo** → **Settings** → **Rules** → **Rulesets** → open the ruleset that applies to `main`, or **Branches** → **Branch protection** for `main`.
2. Enable **Require merge queue**.
3. Optional settings:

- **Merge method:** merge / rebase / squash (e.g. **Squash** for single-commit PRs).
- **Build concurrency:** 1–100 (max concurrent `merge_group` runs; e.g. **3**).
- **Only merge non-failing pull requests:** on = **ALLGREEN** (every PR in the group must pass); off = **HEADGREEN** (only the combined head must pass).
- **Status check timeout:** how long to wait for CI before treating as failed (e.g. 15 min).
- **Merge limits:** min/max PRs per merge (e.g. 1–5), and wait time for minimum group size.

Integration, Security, and Automation policy support `merge_group`, so their required checks run for queued revisions. If enabling a queue, adapt the dependency controller to enqueue through its supported API before enabling unattended merges. Never bypass the queue or required checks.

## Releases

Releasable changes on `main` publish automatically after full Integration, Security, and Automation policy validation at the exact source SHA. Semantic-release chooses the version: dependency/internal fixes are patches, features are minor releases, and declared breaking changes are major releases. An unreleased feature or breaking change takes precedence over dependency patches.

Do not create release tags locally or open version-bump PRs. Tests and protected merge checks are mandatory; no approval bot, administrator bypass or AI decision participates in the release path.

Follow the [release and dependency automation runbook](.agents/skills/squadrules-dev/references/release-semver.md) for migration, dry-run previews, trusted publishing settings and partial-publish recovery. The [workflow design](.github/workflows/README.md) describes the validation jobs and privilege boundaries.

## Code style

- **Language:** TypeScript for all source files.
- **Linter:** ESLint. Run `npm run lint` before committing. Use
`npm run lint:fix` for auto-fixable issues. The pre-commit hook runs
lint automatically; version-bump commits (only `package.json` and
`package-lock.json` staged) skip hooks so no `--no-verify` is needed.
- **Pre-commit hook (`.husky/pre-commit`):** Blocks commits on `main`, runs
version/skills checks when relevant, `lint:skills` when `.agents/skills/` is staged,
then drops any staged paths whose blob is missing from the object database
immediately before and after `**npm run lint**`. For worktree index issues,
see `**.agents/skills/squadrules-dev/references/git-index-repair.md**`. Hook history:
`git log -- .husky/pre-commit`.
- **Imports:** Use `.js` extensions on relative imports (Node ESM).
- **Naming:** `camelCase` for variables and functions; `PascalCase` for
classes and types; `SCREAMING_SNAKE_CASE` for module-level constants
read from the environment.
- **Files:** One primary export per file; filename matches the export
(for example, `structured-logger.ts` exports `structuredLogger`).
- **Error handling:** Throw typed errors or return structured error
objects. Never swallow errors silently. Include `error_code` and
`request_id` in log payloads at the call site.
- **Logger:** Use `structuredLogger` (from
`src/utils/structured-logger.ts`) for HTTP/MCP request flow. The same module
also exports `logger` as an alias used by services. See the
Testing and Observability topic in the [project Wiki](https://github.com/SquadRules/mcp/wiki) for levels, fields, and examples.
- **Tests:** Write integration tests for new tools and API endpoints.
Place them in `tests/integration/`.

## Multitenancy (Qdrant + Redis) audit checklist

When adding or changing code that touches Qdrant or Redis, verify:

- **Allowed spaces:** Derive only from the verified token or session
(Keycloak `sub` + `groups`). Never trust client-supplied space lists.
- **Qdrant reads:** Search uses `getSearchSpaceIds()` (allowedSpaceIds +
SquadRules app space). Scroll and filter operations use
`getSpaceContext().allowedSpaceIds`. Every retrieve-by-id must check
that the point's `space_id` is in `allowedSpaceIds`; otherwise treat
as not found (404).
- **Qdrant writes:** Every upsert includes `space_id` from
`getSpaceContext().defaultWriteSpaceId` or a validated parameter. The
SquadRules app space is read-only for users.
- **Redis:** Keys are namespaced by space via `getKey()` (prefix +
space id + key). Each request runs inside `runWithSpaceContext()`.
- **Optional space param:** Validate HTTP query `space` / `space_id`
and MCP tool args against `allowedSpaceIds`; invalid → 400/403.

See the Authentication and Security topic in the
[project Wiki](https://github.com/SquadRules/mcp/wiki)
for Keycloak URL routing and the current auth model.

## Constraints

SquadRules MCP must remain safe to run in production with clear environment
separation (dev/live). Agent-facing changes must preserve older-release compatibility or provide explicit upgrade paths. Operational dependencies
(Redis + Qdrant) must be predictable; avoid hidden state.

## Decision rules

When goals conflict:

1. Correctness and determinism over convenience.
2. Interface that reduces agent errors over interface that reduces
  developer typing.
3. Changes that simplify the agent-facing surface over moving complexity
  into agents.

## Consumer migrations (MCP / HTTP)

Tool and REST responses expose the local handoff path only as **`squadrules_local_artifact_dir`** (lowercase snake of env **`SQUADRULES_LOCAL_ARTIFACT_DIR`**, alias **`SQUADRULES_LOCAL_ARTIFACT_DIR`**). Migrate any client or shell automation still using older env aliases or the superseded short JSON key for that path; the repository forbids reintroducing those symbols in source (see the identifier list in `eslint/plugins/squadrules-forbidden-text.cjs`).

The field's value is an **ordered array** of client-resolvable URI hints (preferred first), e.g. `["project://.local/squadrules/work","user://.config/squadrules/work"]`. Schemes resolved on the client only: `project://<rel>` → `<client project root>/<rel>`; `user://<rel>` → `<client home or $XDG_CONFIG_HOME>/<rel>`. The server never emits a path on its own filesystem, so the same value is correct for stdio and remote (HTTP / Docker) transports. The client picks one hint by scope rule (`project://` when there is exactly one project context; otherwise `user://`), resolves locally, and exports `SQUADRULES_LOCAL_ARTIFACT_DIR` for shell challenges. The field is **output-only**; clients no longer pass it as input. Server defaults are configurable via the comma-separated env **`SQUADRULES_LOCAL_ARTIFACT_DIRS`** (alias **`SQUADRULES_LOCAL_ARTIFACT_DIRS`**; each entry must be a `project://<rel>` or `user://<rel>` URI; absolute paths and `..` segments are rejected at boot).

## Reporting issues

Include:

- Description of the issue
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details (Node.js version, OS)
- Relevant logs or error messages

## Feature requests

Open an issue with a description, use case, and any proposed
implementation.

## Questions

Open an issue for questions or discussion.
