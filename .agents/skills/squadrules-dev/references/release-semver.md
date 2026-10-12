---
name: sqd-dev-release-semver
description: >-
  Protected-main npm releases with Release Please, Conventional Commits,
  GitHub Release artifacts and npm Trusted Publishing.
---

# npm releases

The repository uses a **Release PR** model. Protected `main` is never mutated
directly by a release workflow.

## Normal flow

1. Normal feature/fix PRs pass the required Integration, Security and Automation
   policy checks and merge to `main`.
2. A push to `main` runs [release.yml](https://github.com/SquadRules/mcp/blob/main/.github/workflows/release.yml).
3. Release Please parses Conventional Commits since the previous release and
   creates or updates one Release PR.
4. The Release PR contains the next `package.json` / `package-lock.json`
   version and `CHANGELOG.md`.
5. The release workflow checks out the Release Please branch, runs the existing
   version synchronization and embedded-resource generator, commits only those
   generated/version-derived source changes back to the Release PR branch, and
   pushes with the repository-scoped release App installation token.
6. That PR runs the same required checks as every other change. Branch
   protection remains authoritative; there is no release bypass for `main`.
7. After synchronization, enable protected auto-merge for the exact PR head.
   GitHub merges automatically only after the required checks pass.
8. The resulting push to `main` lets Release Please create `vX.Y.Z` and the
   GitHub Release from the merged release commit.
9. The publish job checks out that exact release SHA, validates the source
   version, builds/tests the npm tarball, publishes with npm Trusted Publishing,
   uploads the tarball/SBOM to the GitHub Release, and verifies npm visibility.

The release workflow never executes `git push ... main`.

## Version semantics

Release Please uses Conventional Commits:

- `fix:` / `perf:` and other releasable non-feature changes -> patch.
- `feat:` -> minor.
- `!:` or `BREAKING CHANGE:` -> major.

Use Conventional Commit PR titles and squash merges so the protected-main
history is the release input.

The authoritative released version must agree across:

- `package.json`;
- root/workspace versions in `package-lock.json`;
- the user-facing skill metadata and every shipped built-in adapter under
  `src/embed-docs/mem/*.md` (except README);
- generated `src/resources/embedded-mcp-resources.ts`, containing the exact
  version-stamped built-in adapter markdown;
- git tag `vX.Y.Z`;
- GitHub Release;
- npm `@squadrules/mcp@X.Y.Z`.

`.release-please-manifest.json` is Release Please's last-released-version state.
It is bootstrapped at the last valid GitHub/npm release when the mechanism is
introduced and thereafter maintained in Release PRs.


This built-in adapter stamping is runtime behavior, not cosmetic documentation.
At boot, `mem-resources-boot.ts` compares each shipped adapter frontmatter
`version` with the stored adapter version and updates the app-space adapter only
when the shipped version is newer. Losing the stamp would therefore break built-in
adapter upgrades even if the npm package itself published successfully.

## GitHub authentication

Release PR creation, source synchronization and auto-merge use short-lived GitHub
App installation tokens, minted separately for each job and revoked at job end.
Tokens are restricted to this repository and the permissions needed by each job.
The producer uses Contents, Pull requests and Issues write; synchronization only
uses Contents write; auto-merge uses Contents and Pull requests write plus Checks
and Commit statuses read. The App must not be a branch-protection or ruleset bypass actor.
The jobs' built-in `GITHUB_TOKEN` remains read-only; the publisher retains its
existing Contents write and OIDC permissions.

GitHub puts PR runs created by `GITHUB_TOKEN` into an approval-required state.
Although `workflow_dispatch` starts runs, its job checks do not satisfy required
PR checks. Therefore neither is an unattended Release PR solution. Do not approve
runs automatically, post synthetic success checks, weaken protection or fall back
to `GITHUB_TOKEN` for release PR mutations.

The App creates normal PR events for the required Integration, Security and
Automation policy workflows. After synchronization the workflow verifies the
same-repository branch, expected head, base and release label, then enables
`gh pr merge --auto --squash --match-head-commit`. No admin override is used.
The App identity also ensures that the eventual merge triggers the push-to-main
publication workflow. Ordinary PR validation never receives the App private key.

### One-time provisioning

1. Register a GitHub App owned by SquadRules, with repository **Contents: Read and
   write**, **Pull requests: Read and write**, **Issues: Read and write**, **Checks: Read-only**, and **Commit statuses:
   Read-only**.
   No webhooks or user authorization are needed. Install only on `SquadRules/mcp`.
2. Add its numeric App ID as the Actions repository variable `RELEASE_APP_ID`.
3. Generate a private key and store it directly as the Actions repository secret
   `RELEASE_APP_PRIVATE_KEY`. Never paste it into a PR, chat or log.
4. Keep repository auto-merge and squash merging enabled. Keep all three required
   checks and strict branch protection enforced, including for the App.
5. npm Trusted Publishing and the `release` environment must already permit
   unattended publication. If organizational rules mandate release reviewers,
   this pipeline is not fully unattended; resolve that policy explicitly.

Missing or invalid App credentials fail visibly before Release Please mutates a
PR. There is no automatic fallback to the previously invalid `GH_PAT`.

## npm Trusted Publishing

The publish job uses GitHub OIDC:

- workflow: `.github/workflows/release.yml`;
- environment: `release`;
- `id-token: write`;
- no `NPM_TOKEN` or `NODE_AUTH_TOKEN`;
- npm provenance enabled.

Configure the npm trusted publisher and the GitHub `release` environment
outside the repository.

## Retry / partial failure

Release Please creates the GitHub Release before npm publication. If publication
or release-asset upload fails after that point, rerunning the original push would
not create the release again. Therefore `release.yml` has a manual retry path:

```bash
gh workflow run release.yml -f tag=vX.Y.Z
```

The retry:

- requires an existing non-draft, non-prerelease GitHub Release;
- checks out that tag;
- requires `package.json.version == X.Y.Z`;
- requires the tag to point at the checked-out source and that source to be
  reachable from `main`;
- rebuilds and validates the tarball;
- skips `npm publish` if that exact version already exists;
- re-uploads GitHub assets with `--clobber`;
- verifies npm after completion.

Never move an existing release tag or overwrite an npm version.

## Required repository settings

Keep `main` protected:

- changes through pull requests only;
- required checks: `Integration workflow passed`, `Security workflow passed`,
  `Automation policy passed`;
- no force pushes or deletion;
- no release-workflow bypass.

The release App needs no main-branch bypass or administration permission.
Configure the one-time App installation and credential above before merging this
workflow migration. CI on the migration PR verifies code and policy; a subsequent
App-authored Release PR and successful publication are the end-to-end acceptance
criteria. Passing PR CI alone does not prove the external App is configured.

## Files

- `release-please-config.json` — Release Please node strategy.
- `.release-please-manifest.json` — last released version.
- `.github/workflows/release.yml` — Release PR orchestration + publication.
- `scripts/build-sync-skill-versions.mjs` — synchronizes version-derived source.
- `scripts/ci-verify-release-version.mjs` — release-source invariant check.

There is no semantic-release configuration or direct-main release commit.
