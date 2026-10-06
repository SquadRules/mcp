---
trigger: always_on
---

## Documentation authority & DRY doctrine

This repository keeps documentation DRY and auto-maintained. Every fact has
exactly **one home**, chosen by *who derives it*. Other locations link to that
home; they never restate it ("rule of one").

### Content class → single home

| Content class | Home (single source of truth) | How it is maintained |
|---|---|---|
| Architecture, HTTP/MCP API, workflow engine, memory, auth internals, CLI surface, deployment topology, testing, UI, artifacts | Qoder RepoWiki (`.qoder/repowiki/en/content/`, generated) → published to GitHub Wiki | Auto (Qoder regenerates from code) |
| Install secrets/env, Keycloak + Google IdP setup, business use-cases, threat model, incident runbook, known issues, test-snapshot ops | Slim `docs/` (curated; enumerated in the allowlist below) | DRY/structure enforced by agent + CI; content decisions by human/AI |
| Agent operation, execution model, maintainer workflows | Skills (`.agents/skills/` — `kairos`, `kairos-dev`) + `AGENTS.md` | Human/AI |
| Test fixtures, install and CLI functional inputs | `docs/examples/`, `docs/install/`, `docs/CLI.md` (functional inputs, not prose docs) | Tied to code/tests |
| Root project docs | `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `TRADEMARK.md`, `AGENTS.md` | Human/AI |

### Must always

- Treat the Qoder RepoWiki as the source of truth for anything derivable from
  code. To change that content, edit the code or the Qoder catalog prompt and
  let Qoder regenerate — do **not** hand-edit generated pages.
- Keep curated `docs/` limited to the irreducible allowlist below.
- Link to the single home instead of copying facts between locations.
- When you add a topic that is not derivable from code, place it under the
  correct `docs/` subtree and add it to the allowlist in this rule.

### Must never

- Hand-edit `.qoder/repowiki/en/content/` or `.qoder/repowiki/en/meta/`
  (Qoder-managed, prompt-generated; hand edits are clobbered and new pages are
  orphaned).
- Restate a fact that already has a home elsewhere. Cross-link instead.
- Re-introduce `docs/architecture/**` prose (retired; the wiki owns it).

### Irreducible `docs/` allowlist (curated, not code-derivable)

- `docs/keycloak/**` — Keycloak / Google IdP operator setup
- `docs/business/**` — business use-cases
- `docs/security/**` — threat model, incident runbook, code-security setup, audit log
- `docs/adr/**` — architecture decision records (why a decision was taken and when it
  expires); one decision per file, supersede rather than rewrite
- `docs/known-issues-and-limitations.md`
- `docs/kairos-bundles.md`
- `docs/test-snapshot-*.md`
- `docs/specs/**`
- `docs/README.md` — thin router only (links to wiki + the entries above)

Functional inputs (kept, but not prose docs): `docs/install/**`, `docs/CLI.md`,
`docs/examples/**`. `docs/install/helm.md` is curated docs (it is not part of the
install-skill `COPIES` set).

### Colocated README shape contract (AI-first audience)

The documentation audience is shifting from human to AI. Agents discover context
via `AGENTS.md` → skills → RepoWiki → `src/embed-docs/`, **not** by crawling
per-directory READMEs. Therefore every kept colocated `README.md` (outside root
and `docs/`) must:

- begin with a one-line purpose statement;
- contain only **directory-local** facts needed by someone operating in that
  directory;
- contain **no** restatement of wiki or root-doc content — link out instead;
- carry an explicit marker `<!-- kairos-doc-keep: <reason> -->` when its
  existence is intentional but a heuristic might flag it.

The two shipped skills (`.agents/skills/kairos`, `.agents/skills/kairos-dev`)
are hand-authored; keep depth in each skill's `references/`, not restated in
root docs. The only auto-generated documentation is the Qoder RepoWiki (see
**Must never** above) — never hand-edit it.

### Enforcement

- `scripts/lint-docs-links.mjs` (`npm run lint:docs`) fails on dangling relative
  links and links to retired paths, and checks the colocated-README contract.
- `.agents/skills/kairos-dev/references/doc-governance.md` audits and
  auto-repairs drift, and hands wiki regeneration to Qoder + the
  `sync-qoder-repowiki-to-github-wiki` workflow (`scripts/sync-wiki.sh`).
