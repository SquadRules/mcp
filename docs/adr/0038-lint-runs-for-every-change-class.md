# ADR 0038: CI runs the canonical lint aggregate for every change class

## Status

Accepted — taken 2026-11-01, implemented in this change
([`ci-gate.yml`](../../.github/workflows/ci-gate.yml) Documentation lane,
[`tests/scripts/workflow-structure.test.mjs`](../../tests/scripts/workflow-structure.test.mjs)).
Augments the Documentation-lane step list of
[0032](0032-change-class-routing-for-required-ci-gates.md); it does not change that
record's routing model, and 0032's body is left intact because accepted ADRs are not
rewritten in place.

## Context

`on.pull_request.paths` filters mean a workflow can be skipped for a revision that
still needs it. ADR 0032 solved this for required *evidence* by routing one always-on
gate by change class, and gave the Documentation lane three documentation lints:
`npm run lint:markdown`, `node scripts/lint-docs-links.mjs --strict`,
`npm run lint:skills`.

Repo-wide ESLint was not in that lane. It runs only in `integration.yml`'s build job
(`npm run lint`), whose path filter covers application paths
(`src/`, `tests/`, `scripts/`, `compose/`, `.github/workflows/`, `eslint/`,
`.agents/skills/`, package/tsconfig manifests). A revision classified
`documentation-only` — every changed path matching `docs/**`, `.qoder/**`,
`.agents/**` or root `*.md` and none matching the application set — therefore ran no
ESLint anywhere in CI.

That matters because ESLint is the *only* mechanical checker of some documentation
rules: `eslint/flat-config.cjs` section 3d lints `**/*.md` with the
`squadrules-forbidden-text/no-forbidden-squadrules-text` rule, which no other script
implements. So a documentation-only PR could introduce disallowed wording and still
pass every required context.

This gap became sharper with the same change that introduced
`.qoder/rules/low-memory-hosts.md`: on hosts that cannot hold a multi-GB V8 heap,
`.husky/pre-commit` now defers `eslint .` to CI. If CI also skipped ESLint for a class
of revisions, that class would have no lint coverage at all — locally or in CI.

## Decision

The Documentation lane runs the canonical aggregate `npm run lint` (which is
`eslint . && npm run lint:skills && npm run lint:markdown && npm run lint:docs`) plus
the explicit strict link check, instead of a hand-picked subset of `lint:*` scripts.
Its wall-clock budget rises from 1200 s to 1800 s inside the gate job's 90-minute
timeout to make room for the ESLint program.

`tests/scripts/workflow-structure.test.mjs` pins the invariant: the lane must run
`npm run lint` and must not substitute individual `lint:markdown` / `lint:skills`
invocations. Routing itself is unchanged — `documentation-only`, `application`,
`mixed`, `unmatched-paths`, `unclassified` and empty diffs keep the classes and
fail-closed behaviour defined in ADR 0032.

Coverage by class after this decision:

| Class | Where lint runs |
| --- | --- |
| `application` | `integration.yml` build job (`npm run lint`), required through the gate |
| `documentation-only` | this lane (`npm run lint`) |
| `mixed` | both (duplicate lint work, as already accepted for the three lints) |
| `unmatched-paths`, `unclassified`, failed classification | both, because the classifier sets `docs=true` and `app=true` |

## Consequences

### Positive

- No change class can merge without ESLint having run on its head commit, so the
  pre-commit deferral for constrained hosts never leaves lint unrun.
- The lane tracks `package.json#scripts.lint` automatically; adding a lint step to the
  aggregate later requires no workflow edit, which removes one way for CI and the
  hook to drift apart.
- Forbidden wording in prose is enforced by the same mechanism that enforces it in
  code.

### Negative

- Documentation-only PRs now pay an install plus a full ESLint program. On
  application-hosted runners this is minutes, not the previous short lane; the 1800 s
  budget was chosen to bound it, not measured here.
- `mixed` revisions run ESLint twice (once per workflow).

### Neutral

- `knip` and `npm run typecheck` remain confined to the `integration.yml` build job;
  this decision is about lint coverage only.

## Alternatives considered

- **Add `docs/**`, `**/*.md`, `.qoder/**`, `.husky/**` to `integration.yml`'s path
  filter.** Rejected: it drags the whole integration and security topology onto prose
  PRs, which is the cost ADR 0032 exists to avoid.
- **A separate always-on `lint.yml` workflow.** Rejected: the merge ruleset requires
  named contexts (`Automation policy passed`, `CI gate passed`), so a new workflow
  would report status without being enforced, and adding a required context is an
  org-administration action rather than a repository change.
- **Keep the three lints and add `npx eslint .` beside them.** Rejected: it hardcodes a
  second definition of "what lint means" and can fall behind `package.json`.
- **Leave the gap and rely on the pre-commit hook.** Rejected: it makes lint coverage
  depend on the memory of whoever's machine happened to run the commit.

## Evidence

- `eslint/flat-config.cjs` section 3d — `**/*.md` with the forbidden-text rule,
  `max-lines` off; CONTRIBUTING.md and `.agents/skills/**/*.md` are exempted there.
- `.github/workflows/integration.yml` — `on.pull_request.paths` list, and
  `- run: npm run lint` in the build job.
- `scripts/ci-change-class.mjs` — `APP_PATHS`, `DOCS_PATHS = ['docs/**', '.qoder/**',
  '.agents/**', '*.md']`, and the fail-closed `unclassified` / `unmatched-paths`
  returns.
- Local measurement on a Termux/Android host with ~3.2 GB available: `npx eslint .`
  aborts at the default V8 heap and passes with a 3072 MB heap; this is the constraint
  that motivated the hook deferral and makes CI the authority for this check.

## Revisit condition

If ESLint's share of the Documentation lane makes the 1800 s budget overrun on
documentation-only PRs, split ESLint into its own always-on required context instead
of reverting to the subset. If the ruleset is ever extended with a required lint
context, this lane can hand that responsibility over.

## Related

- [ADR 0031](0031-ruleset-enforced-single-required-gate.md) — single required gate
- [ADR 0032](0032-change-class-routing-for-required-ci-gates.md) — change-class routing
- `.qoder/rules/low-memory-hosts.md` — agent behaviour on constrained hosts
- `.qoder/rules/documentation-authority.md` — enforcement section listing the linters
