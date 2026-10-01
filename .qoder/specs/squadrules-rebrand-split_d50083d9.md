# KAIROS → SquadRules Rebrand & Repository Split

## Scope and decisions

Implement issue #835 as the single migration plan. It supersedes #833 and naming
PR #737. Preserve protocol behavior and existing deployments while changing the
product and distribution identity. Internal TypeScript symbols and filenames
need not change for branding alone.

SquadRules is an agent-facing persistent protocol system that bridges generic
model competence and the user's actual local procedure. Even an agent that knows
Git must consult local rules before acting on “Create PR.” Preserve this product
understanding in documentation; MCP is an interface, not the entire identity.

| Artifact | Target | Source/publishing owner |
| --- | --- | --- |
| Application repository | `SquadRules/mcp` | Existing repository, transferred and renamed |
| npm package | `@squadrules/mcp` | Application repository |
| CLI | `squadrules` | npm package |
| Canonical container | `quay.io/squadrules/mcp` | Application repository |
| Container mirror | `docker.io/squadrules/mcp` | Same built image, no independent rebuild |
| Chart repository | `SquadRules/charts` | Extracted chart sources and workflows |
| Chart name | `mcp` | Chart repository |
| Chart distribution | `oci://ghcr.io/squadrules/charts/mcp` | Chart repository |

Application source, Dockerfiles, image tests/releases and application-oriented
Compose examples stay in `mcp`. Chart templates, validation, publication and
Kubernetes-specific examples belong in `charts`. Inventory infrastructure,
operators and prerequisite charts individually; record their destinations and
consumers before moving or deleting them. Do not create another repository merely
to resolve an unexamined directory.

## Sequence and gates

Use one coordinated rebrand release with compatibility included. Do not require
an earlier compatibility-only release. Select actual release versions from the
current release state; `5.0.0` is not a hardcoded prerequisite.

1. Inventory and prepare code, compatibility tests, chart extraction and workflows.
2. Verify namespaces and administrative access in parallel with preparation.
3. Prepare destination chart repository and transfer/rename the application repository.
4. Verify destination integrations and publishing credentials/trust.
5. Publish and verify the npm package, then the application image and mirror.
6. Publish and verify the chart consuming that released image.
7. Complete upgrade/rollback evidence and migration documentation.

Missing registry/admin access blocks only the affected transfer or publication.
It does not block local implementation, extraction rehearsals or validation.
Complete independent work and report precise remaining access requirements.
Do not pre-create `SquadRules/mcp`: an existing destination can obstruct transfer.

## Preparation and administrative requirements

- Confirm ownership/access for GitHub, npm scope, Quay and Docker Hub namespaces.
  GitHub organization ownership does not reserve names in other registries.
- Establish an explicit first-publication procedure for the new npm package.
  Do not publish an empty placeholder just to reserve the name. Bootstrap a tested
  package using an authorized publishing method if required, then configure npm
  trusted publishing for the exact destination repository/workflow/environment.
- Check current npm/Node and runner requirements for trusted publishing. A
  `npm publish --dry-run` checks packaging; it does not prove publish authorization.
  Record evidence from a real authorized release before declaring publishing done.
- Configure Quay/Docker credentials only in the application publishing context.
  Keep namespace configuration separate from secrets and match the workflows'
  actual `vars`/`secrets` references. Charts must not receive image push credentials.
- Publish charts to GHCR with the workflow's `GITHUB_TOKEN` and `packages: write`,
  verifying package linkage, visibility and organization policy. This is distinct
  from npm OIDC publishing and keyless cosign signing.
- Verify Codex App installation, branch protection/required checks, environments,
  Actions permissions and publishing trust after transfer. Update signing identity
  verification for the exact old/new workflow identities without a broad wildcard.
- Inspect tracked environment files for actual secrets without printing values.
  If credentials are found, report and rotate those credentials; do not presume
  every checked-in environment file contains secrets.
- Existing `squadrules` Cloud project and verified `squadrules.com` are assets to
  reuse. This migration does not require recreating production infrastructure.

## Compatibility inventory and implementation

Validate each item against the current source and deployed configuration before
editing. Record old/new names, defaults, precedence and tests in the migration guide.

| Surface | Required behavior |
| --- | --- |
| Deterministic IDs and stored space IDs | Preserve UUID namespace and protected IDs exactly. |
| Qdrant collections and Redis prefixes | Preserve existing defaults and configured values across each deployment mode. |
| URI scheme | Accept `squadrules://` and `kairos://`; preserve legacy canonical emission for this migration. Test normalization and round trips. |
| Environment variables | Add corresponding `SQUADRULES_*` aliases; retain old names and parsing semantics. Explicitly define empty-string handling and precedence instead of using an unconditional `new || old || default`. |
| Session cookies | Prefer retaining the current cookie for this migration. If dual names are needed, specify matching security attributes, precedence, refresh and clearing both on logout. |
| Keyring | Read new service then legacy fallback; copy only after a successful read/write. Retain old entries during the rollback window. Test access/refresh tokens and failed writes. |
| User config directories | Respect platform/XDG paths. Define behavior when neither, one or both directories exist. Never overwrite newer configuration or select an empty new directory over valid legacy settings. Use recoverable copying and preserve the legacy directory. |
| JSON fields and UI resource URIs | Retain existing fields/resources; add new aliases only after checking schemas and consumers tolerate them. Test old/new clients and cached resource references. |
| Metrics | Keep existing names and dashboards; no automatic dual-registration or metric migration needed for branding. |
| OIDC realms/clients | Preserve existing realm, clients, audiences and redirects. Add new clients only when required, with validated redirect/audience settings; do not expand trust merely for cosmetic consistency. |
| Helm resources | Preserve existing names, selectors, Service targets, Secrets and PVC bindings during upgrade. Selector preservation alone is insufficient. |
| Release markers | Read legacy and new markers; prevent duplicate releases on retry. |
| Agent skills/MCP configuration | Update branding and paths while preserving documented legacy installation paths. Avoid loading duplicate routing skills unintentionally. |

Keep internal names such as `KairosError` and source filenames unless a functional
change requires editing them. Cosmetic ESLint plugin renames and base-image/cache
optimizations are outside this migration's required scope.

Do not schedule automatic removal of aliases “one major later.” Removal is a
separate breaking-change decision requiring consumer evidence, a migration path
and rollback coverage. Avoid unnecessary forever guarantees about implementation
names; preserve identity/data where changing them would change stored meaning.

## Application and npm changes

- Update package name, lockfile metadata, repository/homepage/bugs links, CLI help,
  MCP display identity, health/log branding, documentation, logos and examples.
- Preserve protocol/data-bearing names according to the inventory above. Retain
  old CLI entry points during migration; verify packaged executable permissions.
- Test the packed artifact in a clean environment, including explicit
  `npm exec --package=@squadrules/mcp -- squadrules` and the documented `npx` form.
  Multiple differently named bin entries require testing command resolution.
- Keep the existing npm package usable. Do not replace it with a dependency-only
  stub and assume CLI forwarding works. Default to documented migration and
  deprecation only after the replacement is verified. Any forwarding package
  requires explicit executable wrappers and old CLI/`npx` tests.
- Ensure core package build/tests/publication do not require Docker or Helm.
  Container/deployment integration checks stay separate.

## Chart extraction and transfer

Rehearse extraction in a disposable clone, never in the only working checkout.
Pin the extraction source commit and inventory chart dependencies, scripts,
fixtures and files outside the chart directory. A suitable path-preserving filter
for the chart itself is:

```sh
git filter-repo --path helm/kairos-mcp/ --path-rename helm/kairos-mcp/:charts/mcp/
```

This command alone does not collect supporting files outside that path. Add the
required paths or port those files explicitly, and verify history, layout and a
clean-clone build. Do not combine a subdirectory-root filter with an incompatible
original-path rename. Publish the verified chart repository before removing the
old chart and its jobs/scripts from the application repository.

Use `charts/mcp/` with standard chart files and independent chart CI. Update chart
metadata and internal helper names only after comparing rendered resources.
Transfer/rename the application with history/issues/PRs preserved, verify redirects
and destination integration access, then enable release publication there.

## Release workflows and retries

- npm publication produces an exact version. Image production installs that exact
  released version; no floating dependency or unpublished source substitution.
- Build an image once and copy the resulting image/index to both registries.
  Verify matching release digests and required signatures/provenance at each target.
- Support an independently runnable image workflow taking an existing npm version.
  Base-image rebuilds use a distinct immutable image revision; never overwrite a
  released immutable tag. Document application version versus image revision.
- Persist release state so failed mirror publication can retry without rebuilding,
  republishing npm or creating a duplicate release. npm remains usable if image
  publication fails. A chart update requiring a new image waits for that image.
- Charts can release independently against an existing verified image. A failed
  new npm release must not block unrelated chart-only work.
- Prefer a chart update PR carrying application version, immutable image reference
  and source release metadata. Validate and approve/version the chart through its
  own workflow; do not blindly bump and publish on every dispatch.
- If using `repository_dispatch`, define a narrowly scoped GitHub App/token for
  the destination, payload validation, an idempotency key, ordering/concurrency
  behavior and retry handling. The source repository's default `GITHUB_TOKEN`
  must not be assumed to grant cross-repository dispatch access. Dispatch failure
  must not fail or undo already published npm/image artifacts.
- Run chart validation in the chart release workflow itself (or a reusable workflow)
  against the exact packaged commit; jobs cannot `needs` jobs in another workflow.
- Publish with the Helm OCI command after authenticating to GHCR:

```sh
helm package charts/mcp --destination dist
helm push "dist/mcp-${CHART_VERSION}.tgz" oci://ghcr.io/squadrules/charts
```

The chart basename/version determine the final artifact path/tag. Verify pulling
and installing that exact artifact and public access if public distribution is intended.

## Validation and completion evidence

1. **Compatibility:** legacy-only/new-only/mixed env settings, empty/false/zero
   parsing, URI round trips, keyring/config copy failure and coexistence, cookie
   logout/refresh, old/new clients and wire schema compatibility.
2. **Package:** clean clone build/test without Helm/Docker; packed installation,
   CLI/`npx` smoke tests and actual new-package publication verification.
3. **Images:** exact npm version installed, standalone startup/MCP smoke tests,
   matching mirror artifacts, signatures/provenance, image-only rebuild and retry
   after partial registry failure.
4. **Charts:** lint/unit/render/schema validation and installation from the published
   OCI artifact. Chart-only changes do not require npm/image releases.
5. **Upgrade and rollback:** install the current released chart with representative
   persisted data, credentials and configuration; upgrade using the same release
   identity. Compare all rendered resource names/selectors, Services, Secrets and
   PVCs. Verify stored data and authentication, then roll back and verify again.
   Do not use uninstall/reinstall as a default workaround for immutable selectors.
6. **Extraction/admin:** clean-clone chart tests, recorded source commit, preserved
   application history/issues/PRs and verified destination publishing/integrations.
7. **Documentation:** old-to-new install/reference map, compatibility and rollback
   instructions, intentional legacy-name inventory and precise remaining blockers.

Do not claim seamless upgrade, zero risk or complete migration from unchanged
unit tests or dry-run publishing alone. No speculative time/performance estimates
are acceptance criteria. Preserving collection names avoids unnecessary migration;
it does not imply that moving existing vectors would require re-embedding.

## References

- [Implementation issue #835](https://github.com/jakub-plichcinski/kairos-mcp/issues/835)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [Helm OCI registries](https://helm.sh/docs/topics/registries/)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
