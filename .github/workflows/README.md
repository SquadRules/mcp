# GitHub Actions

## Validation and release

Pull requests and merge groups run Integration, Security and Automation policy.
Every push to `main` runs Release, which calls those same three workflows at
`${{ github.sha }}` and publishes only after all succeed. There is no polling of
other workflow runs, scheduled release reconciliation, or PR publication.

| Workflow | Responsibility |
|----------|----------------|
| [Integration](integration.yml) | npm ci, lint, typecheck, Knip, UI/spec checks, build and consumer-package tests on Node 24 and 26; service tests on Node 24 |
| [Security](security.yml) | Read-only production npm audit, CodeQL, and dependency review on PRs |
| [Automation policy](automation-policy.yml) | Conventional PR titles, automation regression tests, workflow and Renovate validation |
| [Release](release.yml) | Continuous semantic-release; commits synchronized versioned source, then tags/publishes with npm OIDC/provenance |
| [Renovate](renovate.yml) | Dependency PR producer every six hours |
| [npm audit fix](npm-audit-fix.yml) | Hourly dependency remediation through a PR, separate from validation |
| [Automation health](automation-health.yml) | Monitor producers and latest main release outcome |
| [Wiki sync](sync-qoder-repowiki-to-github-wiki.yml) | Sync generated repository wiki |
| [Verify OpenAI key](verify-openai-key.yml) | Manual test-credential verification |

## Required checks and runtime support

Protect main with `Integration workflow passed`, `Security workflow passed`, and
`Automation policy passed`. Both Node 24 and Node 26 build/static/package lanes
are blocking. The publisher runs Node 26 so current semantic-release plugins meet
their engine floor. The package retains Node `>=24.0.0`; Node 22 and older are
not supported. Review the matrix as Node releases
move through support; new majors are not implicitly a tested compatibility claim.

All PRs run validation, including documentation changes. Checkout uses the exact
event revision and does not persist Git credentials. PR checks never push fixes.
Publishing permissions exist only in the guarded Release job; CodeQL has its own
security-events permission for uploading analysis.

## Project-specific integration coverage

The authenticated service job installs the Node 24 tarball, starts Qdrant, Valkey,
Postgres and Keycloak, then runs unit and integration tests. Some tests under
`tests/unit` require real services, so they run after deployment. HTTP without
auth and stdio transport smoke jobs install that same artifact. The full suite
uses a restricted OpenAI embedding key; fork PRs require maintainer review and
validation from a trusted branch because GitHub does not expose secrets to forks.
UI tests use jsdom and do not require a browser download; the auth browser tests
retain Playwright. No production image/Helm build or downstream dispatch belongs
in this npm-only repository.

One advisory lane proves the zero-infrastructure default: it installs the same Node 24
tarball with `QDRANT_URL` blanked and `EMBEDDING_PROVIDER=fastembed`, so the server runs
the embedded LanceDB store and local key-free embeddings without Qdrant, Redis, Keycloak
or Docker, asserts `/health` reports `embedded-lancedb`, and runs one real
`train`→`activate` flow. It is `continue-on-error` and excluded from the merge gate until
it proves stable.

The tarball is created outside `dist/`, preventing old tarballs from being packed
into subsequent packages. `prepack` always cleans/rebuilds output, including UI,
CLI and versioned embedded documentation. The isolated consumer smoke test checks
installed metadata, CLI version and help. On a real release, semantic-release
commits `package.json`, `package-lock.json`, synchronized skills/docs, generated
embedded resources and version-derived compose metadata back to `main` before
creating the release tag. The tag, source tree, GitHub Release and npm package must
therefore carry the same version.

## Release and migration settings

See the [release runbook](../../.agents/skills/squadrules-dev/references/release-semver.md)
for npm Trusted Publishing, branch/environment/tag protection, squash conventions,
legacy draft/tag migration, preview limitations and partial-publish recovery.
Manual release dispatch defaults to dry-run; only main is eligible. There are no
prerelease channels or custom recovery manifests. A releasable main push computes
the next version, prepares and verifies the package, creates a `[skip ci]` release
commit with the synchronized versioned source, then tags that commit and publishes
the npm/GitHub release with tarball/SBOM. The workflow finally verifies remote
`main`, the tag, GitHub Release and npm all agree.
