# GitHub Actions

## Validation and release

Every pull request and merge group runs Automation policy and the CI gate. Integration and Security
run on the pull requests whose changed paths match their filters; the CI gate decides from those
same paths which evidence a revision owes.
Every push to `main` runs Release Please. Normal changes accumulate in a bot-managed
Release PR; that PR is gated by the same protected-branch checks as every other PR.
Only after the Release PR is merged does Release Please create the tag/GitHub Release
and the publisher ships that exact tagged commit to npm. Release never pushes to
protected `main` directly.

| Workflow | Responsibility |
|----------|----------------|
| [Integration](integration.yml) | npm ci, lint, typecheck, Knip, UI/spec checks, build and consumer-package tests on Node 24 and 26; service tests on Node 24 |
| [Security](security.yml) | Read-only production npm audit, CodeQL, and dependency review on PRs |
| [Automation policy](automation-policy.yml) | Conventional PR titles, automation regression tests, and workflow validation |
| [CI gate](ci-gate.yml) | Always-on aggregate required check: classifies the revision's changed paths, runs the documentation lane itself for documentation-only changes, and otherwise waits for successful Integration and Security runs on the same head commit |
| [Docs wiki](docs.yml) | Regenerate the Qoder repository wiki on `main` pushes that touch the scope declared in `.qoder/repowiki/wiki_plan.yaml` (`src/**`, `docs/**`, `.agents/**`, or the plan file itself) |
| [Release](release.yml) | Release Please Release PRs; protected-main version commits; GitHub Release + npm OIDC/provenance publication |
| [npm audit fix](npm-audit-fix.yml) | Hourly dependency remediation through a PR, separate from validation |
| [Automation health](automation-health.yml) | Monitor producers and latest main release outcome |
| [Wiki sync](sync-qoder-repowiki-to-github-wiki.yml) | Sync generated repository wiki |
| [Verify OpenAI key](verify-openai-key.yml) | Manual test-credential verification |

## Required checks and runtime support

`main` is protected by the `main merge gate` ruleset. It requires `Automation policy passed` and
`CI gate passed` from GitHub Actions, requires pull requests to be tested against the latest
`main`, and defines no bypass actors. `Integration workflow passed` and `Security workflow passed`
report on pull requests that match their path filters but are not required to merge; the CI gate
enforces them transitively, so an application-class pull request cannot satisfy `CI gate passed`
unless both ran to completion successfully for its head commit. A required check cannot come from
a path-filtered workflow: a filtered-out workflow produces no check run at all, so the required
context would sit at "Expected" forever. Both Node 24 and Node 26
build/static/package lanes are blocking. The publisher runs Node 26. The package retains Node `>=24.0.0`; Node 22 and older are
not supported. Review the matrix as Node releases
move through support; new majors are not implicitly a tested compatibility claim.

All pull requests run the Automation policy and CI gate checks. Integration and Security run only when
the pull request's changed paths match their filters, so documentation outside those
lists (for example `docs/**`) runs neither lane and is validated by the CI gate's documentation
lane instead. Checkout uses the exact
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
installed metadata, CLI version and help. Release Please updates `package.json`, `package-lock.json` and `CHANGELOG.md`
on its Release PR. The release workflow then synchronizes skills/docs and generated
embedded resources on that same PR branch. Normal PR checks validate the complete
versioned source before branch protection allows it into `main`. The resulting tag,
source tree, GitHub Release and npm package therefore carry the same version.

## Release and migration settings

Release Please, version synchronization and auto-merge use a
short-lived repository-scoped GitHub App installation token. Normal `pull_request`
events run the required checks without a human approval step. After synchronization,
the workflow enables protected auto-merge on the exact Release PR head. GitHub waits
for the required checks and merges; the App-authored merge triggers publication.
`workflow_dispatch` checks do not satisfy required PR checks and are not used as a
substitute. Configure `AUTO_APP_ID` and `AUTO_APP_PRIVATE_KEY` once, following
the runbook; absent credentials fail early instead of falling back to approvals.
npm publication uses Trusted
Publishing/OIDC and never needs a long-lived npm token. A manual `release.yml`
dispatch takes an existing `vX.Y.Z` tag and is only a retry path for a partial
publication; it does not calculate a new version or bypass the Release PR.

