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
   pushes with the repository automation PAT.
6. That PR runs the same required checks as every other change. Branch
   protection remains authoritative; there is no release bypass for `main`.
7. Merge the Release PR when the release is wanted.
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

The release workflow uses only the repository-scoped `GITHUB_TOKEN` for GitHub
mutations. Release Please creates/updates the Release PR and the synchronization
job commits only to that non-protected Release PR branch.

GitHub intentionally suppresses most workflow recursion caused by
`GITHUB_TOKEN`. The release workflow therefore does not rely on the Release PR
event or synchronization push to start required CI. After synchronization it
explicitly dispatches `integration.yml`, `security.yml`, and
`automation-policy.yml` on the Release PR branch. `workflow_dispatch` is an
allowed recursive-event exception, so these runs attach to the Release PR head
without a long-lived GitHub PAT.

Protected `main` remains PR-only; the release workflow never receives or uses a
main-branch bypass credential.

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

Repository Actions settings must allow `GITHUB_TOKEN` to create pull requests.
The Release job grants write permission only to the jobs that create/update the
Release Please branch/PR, and grants `actions: write` only to the job that
dispatches the three required validation workflows. No personal access token is
required for releases.

## Files

- `release-please-config.json` — Release Please node strategy.
- `.release-please-manifest.json` — last released version.
- `.github/workflows/release.yml` — Release PR orchestration + publication.
- `scripts/build-sync-skill-versions.mjs` — synchronizes version-derived source.
- `scripts/ci-verify-release-version.mjs` — release-source invariant check.

There is no semantic-release configuration or direct-main release commit.
