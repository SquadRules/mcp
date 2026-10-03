# Handover — SquadRules rebrand & repo split (issue #835)

Purpose: continue this effort in a new chat/session. Everything below was verified by agents during the session of 2026-10-02/03. Treat remote state (`gh api`) as authoritative over this file when they disagree.

## 1. Repos, branches, PRs

| Repo | Local checkout | State |
|---|---|---|
| `SquadRules/mcp` | `~/git/github.com/squadrules/mcp` | main = `bae3404`. PR [#6](https://github.com/SquadRules/mcp/pull/6) OPEN, head `chore/purge-kairos-branding` @ `23ccd684` (kairos content purge, 465 files). **PR #6 checks are NOT green — user reported tests not passing on the PR.** Not merged. |
| `SquadRules/charts` | `~/git/github.com/squadrules/charts` | main = `465c2c9` (chart extracted from app repo; `charts/mcp/`, README, chart-release workflow). |
| `jakub-plichcinski/iac-github` | `~/git/github.com/jakub-plichcinski/iac-github` | Pushed `dcbdb9e`: kairos-mcp settings imported, SquadRules org + repos standardized (Terragrunt/OpenTofu, `live/repos/squadrules/`), branch protection applied on mcp (`BPR_kwDOU3vLPs4FAzF6`); charts protection deferred by design. |
| `jakub-plichcinski/kairos-mcp` (source) | IDE workspace | Original rebrand commit `47419dad`; superseded by SquadRules/mcp work. |

Husky gates in SquadRules/mcp: pre-commit blocks commits on `main`; pre-push blocks tag pushes (tags only via CI or GitHub API refs).

## 2. Release pipeline state (FROZEN — user: "ignore release for now")

- `.github/workflows/release.yml` is **`disabled_manually`** (freeze mechanism). Re-enable with `gh workflow enable release.yml --repo SquadRules/mcp` only when a release is approved.
- npm `@squadrules/mcp`: only `4.8.6`, dist-tag `latest`. Git tags: only `v4.8.6`. No drafts/stray releases (premature `v5.0.0` tag + draft deleted 2026-10-02).
- npm Trusted Publisher configured: org `SquadRules`, repo `mcp`, workflow `release.yml`, **environment `release`** (this field was the ENEEDAUTH root cause; permissions: npm publish / stage publish / dist-tag).
- Secrets set: `DOCKER_USERNAME/PASSWORD`, `QUAY_USERNAME/PASSWORD`, `GH_PAT` (= user's `gh auth token`, owner id 11193963), `CHARTS_DISPATCH_TOKEN`, `OPENAI_API_KEY`. Variables: `QUAY_NAMESPACE=squadrules`, `AUTOMATION_ENABLED=false`, `AUTOMATION_USER_ID=11193963`.
- Registry orgs exist: `quay.io/squadrules`, `hub.docker.com/u/squadrules`.
- semantic-release baseline risk: with only `v4.8.6` tag and unreleased breaking commits on main, any enabled main-branch run publishes stable `5.0.0` — keep frozen until prerelease strategy executes.
- Known pitfalls (verified earlier): GitHub release PATCH without `tag_name` reverts draft to untagged placeholder; OIDC authorizes `npm publish` only (separate dist-tag PUT → 403); Trusted Publisher must match the workflow file that actually runs `npm publish`.

## 3. What is MISSING / next actions (priority order)

1. **Task #23 (pending, unassigned): rename kairos-containing FILENAMES + make PR #6 green.**
   User directive: filenames must be renamed too, otherwise file contents are forced to keep `kairos` (imports/paths). Scope: `src/tools/kairos-uri.ts`, `src/utils/kairos-user-dirs.ts`, `src/mcp-apps/kairos-ui-constants.ts`, `scripts/kairos-db-init/`, `eslint/plugins/kairos-*.cjs` (plugin filenames AND rule ids, update `eslint.config.cjs` + tests), `logo/kairos-mcp.svg`, `.agents/skills/kairos*/`, test paths; update every reference (TS imports, jest/vite/tsconfig/knip configs, package.json bin *targets* — bin *names* `kairos`/`kairos-mcp` stay as compat aliases, Dockerfile COPY, compose.yaml, workflows referencing paths, `ci-validate-workflows.mjs`). Excluded: `.github/workflows/*` filenames + job names (required-check identities), `.qoder/repowiki/**`.
   Then diagnose and fix ALL failing checks on PR #6 (`gh pr checks 6 --repo SquadRules/mcp`) and push until green. Do not merge.
2. **Task #22 (pending, ON HOLD per user): prerelease before stable.** Plan: branch `next` cut from the purge branch with `release.config.mjs` entry `{name:'next', prerelease:'beta'}`; gating workflows must succeed at next's head SHA; trigger via `gh workflow run release.yml --ref next -f dry-run=false`; verify `5.0.0-beta.1` on dist-tag `beta`, `latest` untouched at 4.8.6, OCI images tagged, GitHub release tag-bound; re-disable workflow afterwards.
3. **After beta validated:** merge PR #6, unfreeze release, allow stable 5.0.0 (user approval required).
4. **Task #16 (in progress, no agent):** end-to-end workflow verification of the publish path — satisfied by the task #22 beta run evidence (npm + both registries + charts dispatch).
5. Minor/open items: Dependabot `ip-address` PR failing (transitive, cosmetic); 4 unit suites fail locally for env reasons (`config-driven-cache-backend`, `execution-trace-store`, `train-artifact-adapter-uri`, `kairos-codeql-line-comments.rule` — Qdrant unavailable / CJS transform) — confirm they pass in CI or fix; `.qoder/repowiki/**` still contains kairos (246 files, regenerate-only, never hand-edit); production hardening: dedicated automation-bot PAT to replace `GH_PAT` user token, then flip `AUTOMATION_ENABLED=true` after dry-runs; SquadRules/charts `chart-release.yml` + repository_dispatch notification never exercised end-to-end.

## 4. Compat surfaces that MUST keep `kairos` (tagged `squadrules-compat-surface: <reason>` in-file)

`kairos://` canonical emission; `KAIROS_*` env aliases; `kairos_session` cookie; `kairos_local_artifact_dir` JSON field; `ui://kairos/*` resources; Qdrant collections `kairos`/`kairos_memories`/`kairos_ci`/`kairos_simple_ci`; KAIROS_NAMESPACE UUID `6f1d7e2b-...`; redis prefix; Keycloak realms/clients (`scripts/keycloak/import/*.json`); `space:kairos-app`; keyring `kairos-cli` + config-dir `kairos` fallbacks; compose `-p kairos-mcp`; package.json bin aliases. ESLint rule `kairos-forbidden-text/no-forbidden-kairos-text` (plugin `eslint/plugins/kairos-forbidden-text.cjs`, `noInlineConfig: true`) bans bare `kairos` case-insensitively except marker-tagged files; marker requires non-empty reason; proof-test: untagged scratch file must fail lint.

## 5. Reference artifacts

- Plan: `/Users/jakub.plichcinski/Library/Application Support/Qoder/SharedClientCache/cache/plans/squadrules-rebrand-split_d50083d9.md` (do not edit).
- Purge inventory (760 files, A/B/C buckets): `/Users/jakub.plichcinski/.qoder/cache/projects/kairos-mcp-a4a5d395/agent-tools/d50083d9/{504ba3a2,51eb7b31,e1650f33}.txt`.
- Task board: tasks 1–23 (1–21 completed; 22 pending-on-hold; 23 pending; 16 in progress awaiting #22 evidence).
- Docs doctrine: RepoWiki is generated (never hand-edit); curated `docs/` allowlist only; colocated README contract with `<!-- kairos-doc-keep: -->` markers.

## 6. Operating notes for the next session

- Work in `~/git/github.com/squadrules/mcp` on branch `chore/purge-kairos-branding`; run `setopt nocorrect nocorrectall` first (zsh `correct` hangs on commands containing "log" there).
- Edits outside the IDE workspace: use SearchReplace/Write with absolute paths or a helper script; re-verify `git status --porcelain` before mutating (concurrent actors happened before).
- User preferences: English only; always render PRs as hyperlinks; truth-first (state uncertainty, never invent).
- Do not merge PR #6, do not publish stable npm versions, do not move dist-tag `latest`, do not delete tags/releases without explicit user approval.
