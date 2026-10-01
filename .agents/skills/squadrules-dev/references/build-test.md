---
name: sqd-dev-build-test
description: >-
  squadrules-mcp: authoritative build, deploy, and test path. npm scripts only;
  always dev:deploy before dev:test; never use bare npx jest/jest as default.
  Invoke for CI parity, integration tests, handoff, or any "run tests" request.
---

# Build, deploy, and test (squadrules-mcp)

**Repository:** `squadrules-mcp` — Node 24 LTS minimum, TypeScript, Qdrant, Redis, optional Keycloak.
**Agent contract:** [`AGENTS.md`](https://github.com/SquadRules/mcp/blob/main/AGENTS.md). **Adapter execution (shipped skill):**
[`.agents/skills/squadrules/SKILL.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/squadrules/SKILL.md). **Skill index:**
[`.agents/skills/README.md`](https://github.com/SquadRules/mcp/blob/main/.agents/skills/README.md) (`sqd-dev-*`).

Use this skill whenever you need to **build**, **deploy**, or **test** this repository.
Derived from [`CONTRIBUTING.md`](https://github.com/SquadRules/mcp/blob/main/CONTRIBUTING.md); this file is the **authoritative**
execution path for agents in this worktree.

## Core rules (source of truth)

- In a **git worktree**, ensure **`.env*`** exists or will be copied from main, and that **`PORT`** / **`METRICS_PORT`** do not clash with another checkout on the same host; see **[`sqd-dev-worktree-env`](worktree-env.md)** (first **`npm run dev:*`** that uses **`deploy-run-env.sh`** copies **`.env`** when missing).
- Always install dependencies with **`npm ci`** before first build/test.
- Always **deploy before tests**: integration tests expect a running dev stack.
- Use **npm scripts** as the only default interface for build, deploy, test, lint.
- Prefer one integration file while iterating, then broaden.
- Deep policy: **`CONTRIBUTING.md`** — `## Developer commands`, `## Setup from clone to passing tests`, `## PR requirements`.

## Hard stop

- **Do not** use direct Jest invocations (`npx jest`, `jest …`, `node …/jest.js`) as the default path.
- **Do** use `npm run dev:test` (with optional file filter).

## Canonical sequence

1. **`npm ci`**
2. **`npm run dev:deploy`** (imports Qdrant test snapshot if `CI=true`)
3. **`npm run dev:test -- tests/integration/<file>.test.ts`** (iterate)
4. **`npm run dev:test`** (pre-PR / handoff)
5. **`npm run handoff`** when full maintainer validation is requested

## Qdrant test snapshot infrastructure

**Purpose:** Pre-seed Qdrant with trained adapters to avoid redundant `train` calls during tests.

**How it works:**
- `deploy-run-env.sh` triggers `import-test-snapshot.sh` when `CI=true`
- Import script restores both `squadrules_ci` and `squadrules_ci_traces` collections from `.local/qdrant-snapshot/`
- Snapshot contains 76+ adapters (system + test fixtures)
- Tests benefit from pre-seeded data; no need to re-train common adapters

**Snapshot management:**
- Create/update: `npm run test:seed-snapshot` (dev mode with auth) or auto-seeded in `dev_simple` mode
- Location: `.local/qdrant-snapshot/squadrules_ci.snapshot` + `squadrules_ci_traces.snapshot`
- Scripts: `scripts/seed-test-snapshot.sh` (export), `scripts/import-test-snapshot.sh` (restore)
- Both collections use multi-vector schema (vs1536, activation_pattern_vs1536, adapter_title_vs1536)

**Agent guidance:**
- Snapshot import happens automatically during `dev:deploy` when `CI=true`
- Do NOT manually call seed/import scripts unless updating snapshot content
- Track snapshot changes via git diff of import/seed scripts

## Auth variants

Without Keycloak:

```bash
AUTH_ENABLED=false npm run dev:test
```

With Keycloak (example):

```bash
npm run dev:deploy
KEYCLOAK_URL= AUTH_ENABLED=true npm run dev:test -- \
  tests/integration/auth-keycloak.test.ts
```

## Agent policy

- User asks to run tests → run **`npm run dev:deploy`** first unless they explicitly skip deploy.
- On conflict with ad hoc commands → follow this skill and state why.
- On failure → report suites and likely causes; do not "green" by switching to bare Jest.

## Fork portability

Same policy for forks: deploy-before-test, npm scripts. If script names differ, map equivalents and document before running.

## Related maintainer skills

- **[`sqd-dev-worktree-env`](worktree-env.md)** — `.env*` in worktrees; sync from main.
- **[`sqd-dev-mcp-qa-e2e`](mcp-qa-e2e.md)** — MCP-first QA against SQUADRULES-DEVELOPMENT.
- **[`sqd-dev-bugfix-ship`](bugfix-ship.md)** — bug report → fix → PR → CI.
- **[`sqd-dev-release-semver`](release-semver.md)** — semver release branch flow.
