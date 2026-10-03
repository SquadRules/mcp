---
name: kmcp-dev-doc-governance
description: >-
  kairos-mcp: audit and auto-repair documentation drift so docs stay DRY and
  self-maintaining. Enforces the documentation-authority rule: Qoder RepoWiki is
  the single source of truth for code-derivable docs; curated docs/ is limited to
  an irreducible allowlist; colocated READMEs follow the shape contract. Covers
  the audit cadence (after significant merges, before releases), running
  npm run lint:docs, repointing/removing drifted links, flagging stale curated
  docs, and handing wiki regeneration to Qoder + the
  sync-qoder-repowiki-to-github-wiki workflow (scripts/sync-wiki.sh).
---
<!-- squadrules-compat-surface: skill directory + name: frontmatter (kairos / kairos-dev) are retained invocation identifiers; path/filename rename is an explicit non-goal and body prose references these names plus the retained kairos CLI alias -->

# Documentation governance (kairos-mcp)

**Repository:** `kairos-mcp`
**Authority rule:** [`documentation-authority`](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.qoder/rules/documentation-authority.md) (always-on)
**Agent contract:** [`AGENTS.md`](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/AGENTS.md)
**Skill index:** [`.agents/skills/README.md`](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.agents/skills/README.md) (`kairos-dev` references)

This skill makes documentation **auto-maintained by the agent**. It reads the
always-on `documentation-authority` rule and repairs drift against it. The rule
is the doctrine; this skill is the enforcement/repair loop.

## Rule of one (the doctrine, in brief)

Every fact has exactly **one home**, chosen by *who derives it*:

| Content class | Single home |
|---|---|
| Code-derivable (architecture, API, workflow engine, memory, auth internals, CLI surface, deployment, testing, UI, artifacts) | Qoder RepoWiki `.qoder/repowiki/en/content/` → GitHub Wiki |
| Irreducible curated (install secrets/env, Keycloak+Google IdP, business use-cases, threat model, incident runbook, known issues, test-snapshot ops) | Slim `docs/` (allowlist in the rule) |
| Agent operation / maintainer workflows | Skills + `AGENTS.md` |
| Functional inputs (test fixtures, install-skill sources) | `docs/examples/**`, `docs/install/**`, `docs/CLI.md` |
| Root project docs | `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `TRADEMARK.md`, `AGENTS.md` |

Other locations **link** to the home; they never restate it.

## When to run

- After a **significant code merge** (new module, API surface, or subsystem).
- **Before a release** (pair with `kmcp-dev-release-semver`).
- When `npm run lint:docs` reports new findings in CI.
- When someone adds a `docs/` file or a colocated `README.md`.

## Audit loop

### 1. Mechanical pass — run the linter

```bash
npm run lint:docs          # report-only: prints every finding, exits 0
npm run lint:docs -- --strict   # enforce: exits non-zero on ERROR-class findings
```

`scripts/lint-docs-links.mjs` checks:

- **(a) dangling relative links** in tracked `*.md` → ERROR.
- **(b) links to retired `docs/architecture/**`** → ERROR (repoint to the Wiki).
- **(c) colocated README shape** (H1 purpose line or `<!-- kairos-doc-keep: -->`
  marker) → WARNING.
- **(d) `docs/` H1 duplicating a wiki catalog name** → WARNING (DRY drift).

Rollout is staged: default report-only keeps CI green while pre-existing dangling
links are burned down. Once the backlog is clear, promote to `--strict` in
`package.json` / CI.

### 2. DRY-drift pass — docs/ vs Wiki catalog

- Load catalog names from `.qoder/repowiki/en/meta/repowiki-metadata.json`
  (`wiki_catalogs[].name`) — this is what check (d) uses.
- For each curated `docs/` file, ask: **is this fact derivable from code?**
  - **Yes** → it belongs in the Wiki. Remove the prose from `docs/`, ensure the
    topic is covered by a Wiki catalog prompt, and leave a link to the Wiki.
  - **No** (irreducible) → confirm it is in the allowlist in the rule; if it is a
    new topic, add it to the allowlist.
- Never hand-author into `.qoder/repowiki/en/{content,meta}/` — it is
  Qoder-owned and prompt-generated (hand edits are clobbered). Migrate
  code-derivable content by editing the code or the Qoder catalog **prompt** and
  letting Qoder regenerate; publish via the `sync-qoder-repowiki-to-github-wiki`
  workflow (`scripts/sync-wiki.sh`).

### 3. Link-repair pass

- **Retired paths** (`docs/architecture/**`): repoint to the project Wiki
  (`https://github.com/jakub-plichcinski/kairos-mcp/wiki`) with a descriptive section
  name, or drop the link if it added nothing.
- **Dangling links**: fix the path or remove the reference. Prefer linking to the
  single home over re-adding a copied file.

### 4. Colocated-README pass (AI-first audience)

Agents discover context via `AGENTS.md` → skills → RepoWiki → `src/embed-docs/`,
**not** by crawling per-directory READMEs. For every kept colocated `README.md`
(outside root and `docs/`):

- opens with a one-line purpose statement;
- contains only **directory-local** facts;
- contains **no** restatement of Wiki/root-doc content — links out instead;
- carries `<!-- kairos-doc-keep: <reason> -->` when its existence is intentional
  but a heuristic might flag it.

Trim any duplication down to a pointer. Never hand-edit generated READMEs.

### 5. Stale curated-doc pass

For each irreducible `docs/` file, sanity-check it against the current code
(config keys, env var names, endpoints, CLI flags). Flag drift; fix small
inaccuracies inline, or open a `reports/` note for larger corrections.

## Functional inputs — do NOT collapse into the Wiki

These are *topically* covered by the Wiki but are **build inputs** and must stay:

- `docs/examples/**` — read by `tests/integration/kairos-train-docs-examples.test.ts`.
- `docs/install/**` (except `helm.md`) + `docs/CLI.md` — referenced by source
  error messages and by the `kairos` skill's install reference.

This is intentional, justified non-DRY at the doc-text level.

## Must always

- Treat the RepoWiki as source of truth for code-derivable docs; regenerate via
  Qoder, never hand-edit generated pages.
- Keep curated `docs/` limited to the rule's allowlist; add new irreducible
  topics to the allowlist when introduced.
- Link to the single home instead of copying facts.
- Run `npm run lint:docs` and resolve findings before release.

## Must never

- Hand-edit `.qoder/repowiki/en/{content,meta}/` (Qoder-managed).
- Re-introduce `docs/architecture/**` prose.
- Restate a fact that already has a home elsewhere.
- Remove `docs/examples/**`, `docs/install/**`, or `docs/CLI.md` (functional
  inputs) as if they were prose docs.
- Extend the Husky pre-commit hook with doc checks (fragile — CI + `npm run lint`
  own enforcement).

## Related skills

- [`sync-qoder-repowiki-to-github-wiki` workflow](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.github/workflows/sync-qoder-repowiki-to-github-wiki.yml)
  + [`scripts/sync-wiki.sh`](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/scripts/sync-wiki.sh) —
  publish RepoWiki content to the GitHub Wiki (CI runs the script on push to `main`).
- [`build-test`](build-test.md) — build/lint/test after changes (`npm run lint`
  includes `lint:docs`).
- [`release-semver`](release-semver.md) — run this audit before cutting a release.
