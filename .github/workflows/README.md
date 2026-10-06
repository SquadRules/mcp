# GitHub Actions

## Validation and release

Pull requests and merge groups run Integration, Security and Automation policy.
Every push to `main` runs Release, which calls those same three workflows at
`${{ github.sha }}` and publishes only after all succeed. There is no polling of
other workflow runs, scheduled release reconciliation, or PR publication.

| Workflow | Responsibility |
|----------|----------------|
| [Integration](integration.yml) | npm ci, lint, typecheck, Knip, UI/spec checks, build and consumer-package tests on Node 24 and 26; cluster-mode and single-mode integration tests on Node 24 |
| [Security](security.yml) | Read-only production npm audit, CodeQL, and dependency review on PRs |
| [Automation policy](automation-policy.yml) | Conventional PR titles, automation regression tests, workflow and Renovate validation |
| [Release](release.yml) | Standard semantic-release npm/GitHub plugins; npm OIDC/provenance; stable main only |
| [Renovate](renovate.yml) | Dependency PR producer every six hours |
| [npm audit fix](npm-audit-fix.yml) | Hourly dependency remediation through a PR, separate from validation |
| [Automation health](automation-health.yml) | Monitor producers and latest main release outcome |
| [Wiki sync](sync-qoder-repowiki-to-github-wiki.yml) | Sync generated repository wiki |
| [Verify OpenAI key](verify-openai-key.yml) | Manual test-credential verification |

## Required checks and runtime support

Protect main with `Integration workflow passed`, `Security workflow passed`, and
`Automation policy passed`. Both Node 24 (release/LTS runtime) and Node 26
(Current) build/static/package lanes are blocking. The package retains Node
`>=24.0.0`; Node 22 and older are not supported. Review the matrix as Node releases
move through support; new majors are not implicitly a tested compatibility claim.

All PRs run validation, including documentation changes. Checkout uses the exact
event revision and does not persist Git credentials. PR checks never push fixes.
Publishing permissions exist only in the guarded Release job; CodeQL has its own
security-events permission for uploading analysis.

## Project-specific integration coverage

Service tests run in exactly two lanes, both gated and both executing the full
`tests/integration/` directory — see
[`docs/adr/0006`](../../docs/adr/0006-two-integration-lanes.md). Each installs the same
Node 24 tarball.

- **cluster mode** (`verify-integration-cluster`, AUTH on) starts Qdrant, Valkey, Postgres
  and Keycloak in Docker, runs the `tests/unit` suites that need real services, then the
  full integration suite over HTTP.
- **single mode** (`verify-integration-single`, AUTH off) runs with no services and no
  Docker: `QDRANT_URL` is blanked so the server, the Jest worker and every stdio child the
  tests spawn resolve the embedded LanceDB store. One job, two passes — HTTP first, then
  the stdio suite after the HTTP server process is stopped so no second writer holds the
  table. It asserts `/health` reports `embedded-lancedb` before testing.

Some tests under `tests/unit` require real services, so they run only in cluster mode,
after deployment.

Both lanes blank `OPENAI_API_KEY` and pin key-free local fastembed embeddings
(`EMBEDDING_PROVIDER=fastembed`, model weights cached per runner), so neither boot
injection nor test writes consume OpenAI quota — see
[`docs/adr/0004`](../../docs/adr/0004-fastembed-default-for-testing.md). No lane can
acquire a key by accident: the reusable-workflow contract no longer declares an
`OPENAI_API_KEY` secret. `verify-openai-key.yml` (manual dispatch) is the only OpenAI
surface in CI. Fork PRs require maintainer review and validation from a trusted branch
because GitHub does not expose secrets to forks.
UI tests use jsdom and do not require a browser download; the auth browser tests
retain Playwright. No production image/Helm build or downstream dispatch belongs
in this npm-only repository.

The tarball is created outside `dist/`, preventing old tarballs from being packed
into subsequent packages. `prepack` always cleans/rebuilds output, including UI,
CLI and versioned embedded documentation. The isolated consumer smoke test checks
installed metadata, CLI version and help. Generated resources stay in the build
workspace and are never committed by CI.

## Release and migration settings

See the [release runbook](../../.agents/skills/squadrules-dev/references/release-semver.md)
for npm Trusted Publishing, branch/environment/tag protection, squash conventions,
legacy draft/tag migration, preview limitations and partial-publish recovery.
Manual release dispatch defaults to dry-run; only main is eligible. There are no
prerelease channels or custom recovery manifests. Standard semantic-release
produces the version, notes, tag, npm publish and GitHub Release with tarball/SBOM.
