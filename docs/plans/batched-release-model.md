# Batched npm release model

Status: implementation plan for PR #10 branch `ci/standard-npm-release`.

## Goal

Replace the current continuous model ("every releasable merge to `main` may publish")
with a standard batched model:

```text
feature/fix PRs -> merge to main -> Release Please maintains one Release PR
                                      |
                                      +-> keep accumulating changes
                                      |
                                      +-> merge Release PR when ready
                                            -> tag
                                            -> GitHub Release
                                            -> npm publish
```

Normal PR merges must never publish npm packages directly.

## Tooling decision

Use **Release Please** for this single-package repository.

Why:

- It is designed around Conventional Commits and a continuously updated Release PR.
- Several normal PRs can accumulate into one version/changelog before publication.
- The Release PR is the explicit human/automation gate for a stable release.
- It owns the committed package version and changelog, avoiding semantic-release's
  publish-on-main-push model.
- It adds less per-PR ceremony than Changesets for this repository.

Changesets is a valid alternative and is stronger when every contributing PR should
carry an explicit version-impact file or when managing many packages. For this
single npm package, requiring a changeset file for normal development is unnecessary
overhead.

## Stable developer flow

1. Developers open normal PRs.
2. PR titles remain Conventional Commit compatible:
   - `fix:` -> patch
   - `feat:` -> minor
   - `!:` / `BREAKING CHANGE:` -> major
   - preserve the repository's dependency-update patch rules if Release Please
     needs explicit changelog/version handling for those commit forms.
3. Existing Integration, Security and Automation Policy checks remain blocking.
4. Merge normal PRs to `main`.
5. A push to `main` runs Release Please.
6. Release Please creates or updates **one Release PR**.
7. Further PR merges update that same Release PR instead of publishing.
8. When the batch is ready, merge the Release PR.
9. Only that merge creates the version tag/GitHub Release and enables npm publish.

Example:

```text
main at 4.8.6
  merge feat A
  merge fix B
  merge fix C

Release PR:
  version: 4.9.0
  changelog: A + B + C

merge Release PR
  -> v4.9.0
  -> GitHub Release
  -> @squadrules/mcp@4.9.0
  -> npm dist-tag latest
```

## Version and changelog ownership

After migration:

- Release Please is the single authority for the next stable SemVer.
- `package.json` version is changed in the Release PR and committed to `main`.
- `CHANGELOG.md` is maintained by Release Please.
- Git tag and GitHub Release use the same version.
- npm publishes the exact version already committed by the Release PR.
- Remove semantic-release as a second version authority.
- Do not create separate manual version-bump PRs.

Use manifest mode even for the single package so version state is explicit:

- `release-please-config.json`
- `.release-please-manifest.json`

Bootstrap the manifest from the real last stable release/version, not from an
assumed default.

## GitHub Actions design

Keep one trusted publishing workflow filename, preferably `.github/workflows/release.yml`.

### On push to main

Run Release Please to create/update the Release PR.

If Release Please reports that a release was created because a Release PR was just
merged, continue in the same workflow to the publish job.

The publish job must run only when Release Please reports a newly created release;
a normal feature/fix push to `main` must not reach `npm publish`.

### Publish job

Before publishing:

- checkout the exact released commit/tag;
- use a GitHub-hosted runner;
- use Node 24 and an npm CLI new enough for Trusted Publishing;
- `npm ci`;
- rerun the package build/consumer validation needed to prove the released package;
- generate the SBOM/release assets currently required by PR #10;
- verify package version equals the Release Please version/tag.

Then:

```bash
npm publish --tag latest
```

Use npm Trusted Publishing/OIDC:

- `id-token: write` only on the publishing job;
- no long-lived `NPM_TOKEN`;
- keep provenance enabled;
- keep the GitHub `release` environment restriction.

Because GitHub events created with `GITHUB_TOKEN` do not reliably start another
workflow, do not depend on a separate `release: published` workflow for npm
publication. Publish from the same Release Please workflow when its
`release_created` output is true.

## Prerelease / beta track

Prereleases are supported, but they must not require a permanent `dev` or `next`
branch.

Use an **optional short-lived prerelease branch** only when a beta cycle is needed,
for example:

```text
release/5.0-beta
```

Cut it from the selected validated `main` SHA.

The same `release.yml` workflow is used so npm Trusted Publishing remains bound to
one workflow filename. A beta invocation targets the prerelease branch and uses a
beta Release Please configuration:

- `prerelease: true`
- `versioning: prerelease`
- `prerelease-type: beta`
- GitHub Release marked prerelease
- npm publish with `--tag beta`

Expected versions:

```text
5.0.0-beta.1
5.0.0-beta.2
5.0.0-beta.3
...
```

Beta releases must never move `latest`.

Do not maintain a permanent `next` development branch. The prerelease branch is
a release-testing lane and is deleted when the cycle ends.

### Beta fixes

Prefer fixing on `main` first and then applying the fix to the prerelease branch
when the beta cycle still needs it. Avoid allowing release-only fixes to live only
on the beta branch.

### Graduation to stable

Graduation is intentionally simple:

1. ensure all beta fixes are present on `main`;
2. stop/delete the short-lived prerelease branch;
3. let the normal stable Release PR on `main` represent the accumulated stable
   release;
4. merge the stable Release PR;
5. publish the final version to `latest`.

Do not "promote" a beta by moving the `latest` dist-tag to the beta version. A
stable release is a new immutable version without the prerelease suffix.

Example:

```text
5.0.0-beta.1   beta
5.0.0-beta.2   beta
5.0.0-beta.3   beta
5.0.0          latest
```

## Migration from PR #10

Keep the CI improvements from PR #10. Replace only the release/versioning model.

Expected changes:

- remove `release.config.mjs`;
- remove `semantic-release` and its release plugins from `package.json` /
  lockfile when no longer used;
- replace `npm run release` with Release Please orchestration;
- add `release-please-config.json`;
- add `.release-please-manifest.json`;
- add/update `CHANGELOG.md`;
- refactor `.github/workflows/release.yml`;
- update release workflow validation tests;
- update `.agents/skills/squadrules-dev/references/release-semver.md`;
- update `.github/workflows/README.md` and contributor/release documentation;
- retain npm OIDC/provenance, tarball consumer validation, SBOM generation and
  release asset upload from PR #10 where still applicable.

The migration must explicitly reconcile the existing release history:

- npm stable currently used as the stable baseline;
- existing prerelease tags such as `v5.0.0-beta.1`;
- GitHub tags/releases;
- `package.json` version;
- Release Please manifest bootstrap version.

Do not delete or rewrite already published npm versions/tags to simplify bootstrap.

## Validation

Add automated tests/policy checks proving:

- normal `fix:` / `feat:` merge to `main` updates a Release PR but does not
  execute npm publication;
- multiple commits are represented in one Release PR;
- computed stable SemVer follows Conventional Commits;
- merging the Release PR is the only stable publish path;
- stable publish uses `latest`;
- beta publish uses `beta`;
- beta publish never changes `latest`;
- package version, git tag, GitHub Release and npm version agree;
- OIDC publisher has minimal permissions;
- release builds use the exact released source;
- retrying after a partial failure cannot overwrite an existing npm version.

Before merge, exercise Release Please in a dry-run/test branch and inspect the
generated Release PR.

## Failure handling

npm versions and git tags are immutable release state.

For a failed publish:

- inspect npm, git tag and GitHub Release state before retrying;
- if npm did not publish, repair the workflow and retry the same release;
- if npm published but GitHub asset/release work failed, repair only the missing
  GitHub side;
- never overwrite an npm version;
- never move an existing release tag to newer source;
- publish a new patch version if the released package itself is defective.

Keep release concurrency serialized.

## Non-goals

This refactor does not:

- change application code;
- redesign Integration/Security/Automation Policy CI that PR #10 already improved;
- add Docker/Quay/Helm publication to this npm repository;
- introduce a permanent `dev`/`next` branch;
- publish every merge to `main`;
- implement automatic prereleases when no beta cycle is requested;
- add custom release-state machinery where Release Please/npm/GitHub already
  provide the required state.

## Target end state

```text
Normal work:
PR -> required CI -> main
                   |
                   +-> Release Please updates one Release PR
                                      |
                         more PRs ----+
                                      |
                              merge when ready
                                      |
                         tag + GitHub Release
                                      |
                         npm publish --tag latest

Optional beta cycle:
selected main SHA -> short-lived release/<version>-beta
                    -> prerelease Release PR(s)
                    -> npm publish --tag beta
                    -> repeat beta.N as needed
                    -> fixes return to main
                    -> delete beta branch
                    -> stable Release PR on main
                    -> npm publish --tag latest
```
