---
kind: build_system
name: 'Build System: npm-based Node.js/TypeScript Project with External Containerization'
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - .devcontainer/devcontainer.json
    - docs/adr/0030-tokenizers-arm64-native-binding-override.md
    - docs/adr/0006-two-integration-lanes.md
    - docs/adr/0017-critic-loop-work-submission.md
    - docs/adr/0032-change-class-routing-for-required-ci-gates.md
    - .agents/skills/squadrules/references/action-routing.md
    - .agents/skills/squadrules/references/install.md
    - .agents/skills/squadrules/references/updates.md
---

## What System Is Used

The repository is a Node.js / TypeScript application built through standard npm tooling. There are no Makefiles, Dockerfiles, or CI pipelines in this repository — those live in external locations:

- **npm scripts** drive compilation, testing, linting, and development (referenced via `npm run ...` commands throughout docs and ADRs).
- **Containerization** is maintained outside this repo under [`SquadRules/containers`](https://github.com/SquadRules/containers), as documented in `docs/README.md`.
- **CI** is referenced indirectly through ADRs that describe gate workflows (e.g., ADR 0019 "path-tiered-ci-gates", ADR 0023 "mandatory-ci-and-fail-closed-gates", ADR 0031 "ruleset-enforced-single-required-gate") but the actual workflow files are not present here.
- **Development container** support exists via `.devcontainer`, referenced in ADR 0030 for `linux/arm64` tokenizer binding resolution.

## Key Files and Packages

- `package.json` — npm manifest defining scripts, dependencies, and overrides (including the root-level `overrides` pinning `@anush008/tokenizers` to `^0.6.0` for arm64 native bindings, per ADR 0030).
- `package-lock.json` — lockfile; ADR 0030 notes it resolves to 0.6.0 with arm64 bindings.
- `.devcontainer` — development container configuration used on Apple Silicon hosts to provide `linux/arm64` builds for tokenizers.
- `docs/adr/0030-tokenizers-arm64-native-binding-override.md` — documents the cross-platform native dependency strategy.
- `docs/adr/0006-two-integration-lanes.md` — documents the test execution model (`npm run dev:test`, `npm run dev_stdio:test`).
- `docs/adr/0017-critic-loop-work-submission.md` — references test suites: `npm run test:spec-parity` (28 tests) and `npm run test:ui` (69 tests).
- `docs/adr/0032-change-class-routing-for-required-ci-gates.md` — references `npm run test:automation` (82 tests).
- `.agents/skills/squadrules/references/action-routing.md` — documents `npm run dev:test` as the canonical single command for running tests.
- `.agents/skills/squadrules/references/install.md` and `updates.md` — document `npm install -g @squadrules/mcp` as the installation/update mechanism.

## Architecture and Conventions

- **Single-package monorepo**: The entire application (CLI, HTTP server, MCP tools, services, web UI) lives under one `src/` tree with one `package.json`. There is no pnpm/yarn workspace or multi-package layout.
- **npm as the sole build entry point**: All developer-facing operations go through `npm run <script>` invocations. The agent skill explicitly codifies `npm run dev:test` as the canonical test command.
- **Externalized infrastructure**: Build artifacts, containers, and CI pipelines are intentionally kept out of this repository. Container images come from `SquadRules/containers`; CI gates are described in ADRs but implemented elsewhere.
- **Cross-platform native dependency handling**: The project pins `@anush008/tokenizers` at version `^0.6.0` via an npm `overrides` field so that `linux/arm64` environments (notably `.devcontainer` on Apple Silicon) resolve a compatible native binding. Consumers must maintain their own override since npm ignores nested overrides.
- **Test surface organization**: Tests are split into unit (`tests/unit/`) and integration (`tests/integration/`) suites, with integration tests using testcontainers for Redis/Qdrant. Multiple script targets exist: `test`, `dev:test`, `dev_stdio:test`, `test:spec-parity`, `test:ui`, `test:automation`.
- **Versioning and release**: Version numbers appear embedded in adapter frontmatter (e.g., `version: "5.14.7"` in `src/resources/embedded-mcp-resources.ts`), indicating a manual or externally-driven versioning process rather than automated changelog/version bumping within this repo.

## Conventions and Constraints

- **Developer workflow uses npm exclusively**: All documented commands use `npm run ...` syntax; no Makefile or shell-based build orchestration exists in this repository.
- **Containers are external**: Per `docs/README.md`, container definitions live under `SquadRules/containers`; this repo does not contain a `Dockerfile` or `docker-compose.yml`.
- **ARM64 native bindings require the root override**: ADR 0030 states that the root `package.json` `overrides` pinning `@anush008/tokenizers` to `^0.6.0` is required for `.devcontainer` on Apple Silicon to resolve correct `linux/arm64` bindings; consumers cannot rely on nested overrides.
- **Test execution is scripted**: The canonical test invocation is `npm run dev:test` (per `.agents/skills/squadrules/references/action-routing.md`); other targets (`dev_stdio:test`, `test:spec-parity`, `test:ui`, `test:automation`) target specific subsets.
- **Installation and updates are npm-based**: The agent skill documents `npm install -g @squadrules/mcp` for installation and `npm install -g @squadrules/mcp@latest` for updates.
- **No in-repo CI manifests**: CI behavior is governed by external workflows; this repo only documents the expected gate semantics in ADRs (0019, 0023, 0031, 0032).