# SquadRules 6 — benched workstream (archive)

**Status: benched 2026-11-24.** The multi-database / graph-native ontological knowledge
architecture is not part of the forward roadmap. The consolidation branch was renamed
`squadrules-6` → `archive/squadrules-6`; nothing from this branch is merged to `main`, and
`main` continues as the single-database (vector-store-centric) architecture.

## What is preserved here

- **Delivered implementation** — the graph layer, `GraphRepository` port, LadybugDB
  embedded backend, ArangoDB shared backend, inheritance evolution, evidence-gated
  proposals, ontological history/restore, `/health` graph surfacing and the compose
  profile, landed via PRs #294–#303 (see the issue archive below for the full ledger).
- **ADRs 0042–0049** — `docs/adr/` on this branch. These exist only here; `main`'s ADR
  series stops at 0041.
- **Specs** — `docs/specs/` on this branch: graph schema, ontological knowledge system,
  inheritance simulation, technology evaluation, license compatibility matrix, AI-centered
  UX design, LadybugDB prototype write-up.
- **The prototype continuation** — `squadrules-6-graph-schema` (commits `a46f2d44`,
  `b2192150`, `e37f4ed0`, `d0e10afd`, `77853f12`) was merged into this branch at
  `a4d589cc` immediately before benching. Its content was already superseded by the
  later PRs, so the merged tree is identical to the pre-merge `squadrules-6` tree; the
  commits are preserved in history.
- **Issue archives** — `issues/` holds full backups of the GitHub issues closed when the
  workstream was benched, including comments.

## Open items at bench time

See [TODO.md](TODO.md).

## If this is ever revived

Do not build on this branch in place. Rename or copy it to a fresh workstream branch,
rebase onto current `main` (it diverged at `98047dcd`, 2026-11-04), and re-run the CI
gates — dependency and spec surfaces on `main` have moved since. The issues archived
under `issues/` can be re-opened or re-filed as needed.
