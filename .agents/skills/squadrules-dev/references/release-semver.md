---
name: sqd-dev-release-semver
description: >-
  npm-only semantic releases from validated main, trusted publishing,
  migration and failure recovery. Conventional Commits determine the version.
---

# npm releases

[release.yml](https://github.com/SquadRules/mcp/blob/main/.github/workflows/release.yml)
is the only publisher. A push to `main` runs Integration, Security and Automation
policy as reusable workflows at the event SHA. Only after all succeed does
semantic-release publish `@squadrules/mcp` and its GitHub Release.
This repository does not build or publish production containers or Helm charts,
and does not dispatch notifications to other repositories.

## Version and package lifecycle

- `fix:` and `perf:` produce patches; `feat:` produces a minor release;
  `!` or a `BREAKING CHANGE:` footer produces a major release.
- Historical `chore(deps):`, `chore(deps-dev):` and `deps:` commits still
  produce patches. Other housekeeping commits do not release on their own.
- Use Conventional Commit PR titles and squash merges with the PR title as
  the commit subject. Review breaking changes before merging.
- The standard npm plugin sets the workspace version; `prepack` cleans and
  builds the package, synchronizing embedded documentation and skills first.
  The generated version is never committed back to `main`.
- A clean consumer installation checks the tarball before publication. The
  GitHub Release includes the npm tarball and a production CycloneDX SBOM.
- Only `main` is a release branch, publishing to `latest`. Arbitrary branch
  prereleases, channel promotion, release manifests and custom git-note
  manipulation have been removed. Add a reviewed, explicit semantic-release
  prerelease branch configuration only if a concrete need arises.

## Required repository and npm settings

Configure these **before merging** because a releasable main push publishes:

1. Protect `main`: require PRs and the GitHub Actions checks
   `Integration workflow passed`, `Security workflow passed`, and
   `Automation policy passed`. Require up-to-date branches (or merge queue),
   prevent force pushes/deletion, and apply protection to administrators.
   Choose human review requirements according to repository policy.
2. Enable squash merges and use the PR title as the default squash subject.
   Configure a merge queue to preserve Conventional Commit subjects if used.
3. On npm, open `@squadrules/mcp` → Settings → Trusted publishing. Configure
   GitHub owner `SquadRules`, repository `mcp`, workflow `release.yml`,
   environment `release`. Confirm the package exists and is public.
4. Create/restrict the GitHub `release` environment to `main`. Optional
   required reviewers pause publication if the maintainers want approval.
   Allow `GITHUB_TOKEN` to create tags, semantic-release notes and GitHub
   Releases; tag rules must permit this. No branch protection bypass is needed.
5. Remove legacy `NPM_TOKEN`/`NODE_AUTH_TOKEN` release configuration. npm
   Trusted Publishing uses short-lived OIDC and automatically supplies
   provenance. The manifest also explicitly requests provenance. The release
   runner uses Node 24; the lockfile includes the npm 11 CLI used by the npm
   plugin (above npm's required 11.5.1 and Node 22.14 minimums).
6. Retain the restricted `OPENAI_API_KEY` for the existing real embedding tests.
   Fork PRs do not receive secrets: review the change, then test a trusted
   same-repository branch. Do not introduce `pull_request_target` execution
   of untrusted code or bypass the required integration gate.
7. Reconcile old draft releases, tags, npm versions and semantic-release notes
   before enabling the new publisher. Confirm the last stable tag is reachable
   from `main` and matches npm. Do not move/delete published tags to force a
   version. The existing `v5.0.0-beta.1` tag is not a stable baseline;
   accumulated breaking changes since `v4.8.6` may produce `5.0.0`.

The dependency producers retain their existing `AUTOMATION_ENABLED`, `GH_PAT`
and `AUTOMATION_USER_ID` configuration. These are unrelated to publication;
`AUTOMATION_ENABLED=false` does not disable Release. Disable the Release workflow
in Actions to pause automatic publishing. No registry credentials for containers
or charts are required by this repository's release path.

## Preview and validation

After the workflow is available on main, preview with all validation enabled:

```bash
gh workflow run release.yml --ref main -f dry-run=true
```

Manual dispatch defaults to preview and rejects other branches via job guards.
A semantic-release dry run verifies configuration and calculates notes/version,
but skips prepare/publish: it does not prove npm publishing authorization or
validate the final release-version tarball. The preceding CI jobs build and test
the baseline package. A real release builds and tests again after versioning.
Use `dry-run=false` only when intentionally retrying or releasing validated main.
No release was published as part of this migration PR.

Local checks: `npm ci`, `npm run lint`, `npm run typecheck`,
`npm run test:automation`, `npm run test:ui`, `npm run test:package-local`,
`npm run lint:workflows`, and `npm run lint:renovate`.
For service-dependent unit/integration tests, deploy first per
[build-test.md](build-test.md), then use `npm run dev:test -- tests/unit`
and `npm run dev:test`.

## Failures and verification

npm publication, git tags and GitHub Releases are not an atomic transaction.
Before retrying a failed publisher, inspect its logs and all three remote states:

```bash
gh run list --workflow=release.yml --limit 3
gh release view v<version>
npm view @squadrules/mcp@<version> version gitHead dist.integrity dist.attestations
npm dist-tag ls @squadrules/mcp
```

If no tag or package was published, fix the cause and rerun. If publication was
partial, repair the missing GitHub Release/assets or resolve the tag/npm mismatch
at the original source as a maintainer before running another release. An existing
tag can make semantic-release consider that version released; rerunning is not
an automatic rollback or recovery. Never overwrite an immutable npm version or
relabel newer source as an old version. Keep Actions logs/artifacts during repair.
A publisher that stops right after `prepare` with `husky - pre-push script failed`
and "Do not push release tags manually" was blocked by this repository's own
pre-push hook inside the runner, because `npm ci` executes `prepare: husky`. The
guard never fired before semantic-release took over tagging, because the previous
publisher created tags through the GitHub REST API, which has no client hooks.
Override `core.hooksPath` from the release step's environment
(`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`), asserted by
`npm run lint:workflows`. A `git config core.hooksPath` step after `npm ci` does not
work: `@semantic-release/npm` runs `npm pack`, which executes `prepare: husky` again and
rewrites that file before the push. Nor may you set `HUSKY=0`: husky's install then writes
`HUSKY=0 skip install` to stdout, `@semantic-release/npm` parses `npm pack` stdout as the
tarball name, and the run aborts on that bogus path. All of these stop before the tag
push, so they leave no tag, npm version or GitHub Release behind and a plain rerun is safe.
Health monitoring reports the latest release failure without expecting hourly
releases or custom recovery drafts.

## References

- [semantic-release GitHub Actions recipe](https://semantic-release.gitbook.io/semantic-release/recipes/ci-configurations/github-actions)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [semantic-release npm plugin](https://github.com/semantic-release/npm)
