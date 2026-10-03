# Handover — complete SquadRules rebrand delivery

Purpose: hand this work to a coding agent and have it finish the KAIROS → SquadRules rebrand end-to-end, including source, filenames, docs, generated docs, runtime identity, prerelease artifacts, and Helm validation.

Remote state is authoritative over this file. Refresh branch/PR/check state before changing anything.

## 1. Active repositories and branch

### Application

- Repository: `SquadRules/mcp`
- Branch: `chore/purge-kairos-branding`
- PR: https://github.com/SquadRules/mcp/pull/6
- Observed head when this handover was updated: `de45e0988110f8b3458b00badda75927a2cdff9c`
- Do not merge PR #6 until explicitly instructed.

### Helm charts

- Repository: `SquadRules/charts`
- Main observed at `465c2c90a29e14a580328f1dbffc82bc29938538`
- This repository is part of the rebrand acceptance scope.

## 2. Final product invariant

The rebrand is complete only when **SquadRules is the sole current identity** across source, filenames, directories, configuration, docs, UI, skills, package metadata, tests, deployment config, and Helm charts.

The **only permitted KAIROS compatibility** is:

> SquadRules MCP silently accepts inbound legacy `kairos://...` URIs.

Everything newly emitted/stored/exported must use canonical `squadrules://...` URIs.

No other compatibility aliases are part of the final target.

## 3. URI compatibility contract

Canonical:

```text
squadrules://adapter/...
squadrules://layer/...
squadrules://artifact/...
```

Legacy input only:

```text
kairos://adapter/...
kairos://layer/...
kairos://artifact/...
```

Required behavior:

1. Accept legacy `kairos://` wherever the equivalent `squadrules://` URI is accepted.
2. Normalize immediately to the SquadRules representation.
3. Emit/store/export only `squadrules://`.
4. Do not warn or expose deprecation messages; acceptance is silent.
5. Dedicated tests must prove old input works and canonical output is SquadRules.

The current implementation in `src/tools/kairos-uri.ts` is wrong for the final state because it currently treats `kairos://` as canonical and `squadrules://` as an alias. Reverse that behavior and rename the file.

## 4. Current state vs target

The existing PR is a transitional rebrand, not the final rebrand.

Verified current leftovers include:

- old skill trees:
  - `.agents/skills/kairos/`
  - `.agents/skills/kairos-dev/`
- KAIROS-named source files such as:
  - `src/tools/kairos-uri.ts`
  - `src/tools/kairos-challenge-display.ts`
  - `src/tools/kairos-genesis-proof-hash.ts`
  - `src/mcp-apps/kairos-ui-constants.ts`
  - `src/mcp-apps/kairos-logo-embedded.ts`
  - `src/mcp-apps/kairos-server-ui-capability.ts`
  - `src/utils/kairos-user-dirs.ts`
  - `src/utils/kairos-local-artifact-dirs.ts`
  - `src/ui/pages/KairosPage.tsx`
- KAIROS-named lint plugins
- KAIROS-named logo
- KAIROS-named Keycloak realm files
- KAIROS-named test files and fixtures
- broad runtime aliases such as `KAIROS_*`, old cookie/config/keyring/Redis/Qdrant/Keycloak defaults
- old CLI aliases `kairos` / `kairos-mcp`
- `ui://kairos/*`
- generated RepoWiki paths/content containing KAIROS

A tree audit found hundreds of tracked paths containing `kairos`; most are generated RepoWiki, but dozens are normal source/docs/test paths.

The old `squadrules-compat-surface` marker strategy is temporary scaffolding and must not be the final mechanism. It currently makes it too easy to preserve retired branding by tagging files.

## 5. Rename every path

No tracked filename or directory may contain `kairos` when complete.

Examples that must be renamed or removed:

```text
.agents/skills/kairos*
docs/migration-from-kairos.md
eslint/plugins/kairos-*.cjs
logo/kairos-mcp.svg
scripts/kairos-db-init/
scripts/keycloak/import/kairos-*-realm.json
src/mcp-apps/kairos-*.ts
src/tools/kairos-*.ts
src/ui/pages/KairosPage.tsx
src/ui/pages/kairos-page-sections.tsx
src/utils/kairos-*.ts
tests/**/kairos-*
tests/**/v4-kairos-*
tests/test-data/kairos-*
```

Update every import/reference/config/script/workflow path after renaming.

Do not keep forwarding shim files with old filenames.

Final path gate:

```sh
git ls-files | grep -i kairos
```

must return no output in `SquadRules/mcp`.

Apply the equivalent gate in `SquadRules/charts`.

## 6. Remove obsolete compatibility aliases

The final code must not preserve KAIROS-era aliases/defaults except inbound `kairos://` URI parsing.

Examples to remove/rename:

```text
KAIROS_* env aliases
kairos_session
kairos_local_artifact_dir
ui://kairos/*
kairos Redis/key-value prefix defaults
kairos Qdrant default collection names
space:kairos-app
kairos-cli keyring/config dir fallbacks
docker compose project kairos-mcp
kairos / kairos-mcp CLI aliases
KAIROS Keycloak realm/client/scope defaults
```

Stable opaque values may remain stable where technically required, but their source symbol names and public identity must be SquadRules.

Generic configuration may still let a user explicitly point SquadRules at externally existing resources with arbitrary names. The application itself must not hardcode the retired brand.

## 7. Skills

Keep only:

```text
.agents/skills/squadrules/
.agents/skills/squadrules-dev/
```

Remove:

```text
.agents/skills/kairos/
.agents/skills/kairos-dev/
```

Do not retain deprecated KAIROS skill aliases.

Ensure frontmatter, descriptions, metadata, references, install docs, and examples all use SquadRules.

## 8. UI and MCP Apps

Fully rebrand `src/ui/**` and `src/mcp-apps/**`:

- filenames
- React component names
- exported constants
- DOM IDs
- CSS selectors
- visible strings
- embedded logo module names
- MCP App resource URIs

`ui://kairos/*` is **not** an allowed compatibility surface.

## 9. Lint/rebrand enforcement

Replace the broad exemption model with a narrow invariant:

1. case-insensitive `kairos` is forbidden by default;
2. only explicit legacy-URI parser/tests may contain it;
3. those occurrences must exist solely to accept/verify `kairos://`;
4. no marker may exempt arbitrary branding.

Rename ESLint plugin/rule filenames and IDs to SquadRules-neutral/SquadRules names.

Add a CI repository scan so both path and content regressions fail.

Final content gate:

```sh
git grep -ni kairos
```

may return only the narrow legacy `kairos://` input parser/tests. Review each remaining line manually.

## 10. Documentation and generated RepoWiki

Rebrand all current docs:

- README
- AGENTS
- CONTRIBUTING
- CLI/install docs
- embedded tool docs
- skill docs
- examples
- image links

The final docs should describe SquadRules, not narrate the rename. Remove or rename obsolete migration docs where appropriate.

`.qoder/repowiki/**` is generated. Do not hand-edit it, but do not exclude it from the final acceptance state.

After source/docs renames:

1. regenerate RepoWiki using the repository's documented process;
2. replace the old generated tree;
3. verify paths and content contain no retired branding.

## 11. SquadRules/charts scope

The full rebrand includes `SquadRules/charts`.

Verified current leftovers include:

```text
charts/mcp/files/kairos-realm.json
```

and old defaults in `charts/mcp/values.yaml`, including KAIROS-era:

- global name
- example hostname
- app name
- Keycloak realm/client
- Gateway name
- Redis cluster name

Rebrand the bundled Keycloak realm JSON completely:

- realm/id
- client IDs
- display names
- scopes
- mapper names
- placeholders
- default roles
- redirect placeholders

Rename the file.

Also fix stale charts documentation: current `SquadRules/charts/README.md` references operator/bootstrap manifests under `SquadRules/mcp/helm/`, but that directory no longer exists.

Rendered Helm manifests must contain no retired branding.

## 12. Tests

Rename all KAIROS-named test files and fixtures.

Retain dedicated URI compatibility tests, but name them around SquadRules legacy-URI compatibility rather than KAIROS branding.

Minimum compatibility proof:

```text
kairos://adapter/...  accepted -> canonical/output squadrules://adapter/...
kairos://layer/...    accepted -> canonical/output squadrules://layer/...
kairos://artifact/... accepted -> canonical/output squadrules://artifact/...
```

Also prove new values never emit the old scheme.

Do not accept "pre-existing failure" as final completion. The final PR head must have the required CI green.

## 13. Final delivery goal

This task is not complete when source grep/tests are green.

It is complete only after all three real distribution outcomes exist.

### 13.1 Published npm prerelease

Publish a real prerelease of:

```text
@squadrules/mcp
```

Expected shape:

```text
5.0.0-beta.N
```

or whatever prerelease version the existing semantic-release configuration correctly determines.

Requirements:

- real npm publication succeeds;
- use a prerelease dist-tag such as `beta`;
- stable `latest` remains untouched;
- install the published package from npm and consumer-test it;
- published package contents contain no retired branding except the narrow legacy URI parser;
- `npx` / CLI works from the published package;
- canonical runtime output is `squadrules://`.

### 13.2 Published Docker prerelease

Publish the Docker/OCI prerelease **from the published npm prerelease**.

Required dependency direction:

```text
published @squadrules/mcp prerelease
        ↓
container build
        ↓
published SquadRules MCP prerelease image
```

Requirements:

- publish to the project's configured registry/registries;
- image tag corresponds to the npm prerelease;
- record the immutable image digest;
- container starts;
- health checks pass;
- MCP smoke/integration tests pass against the published image;
- runtime identity is SquadRules;
- no KAIROS identity leaks except silent inbound `kairos://` acceptance.

### 13.3 Charts pass validation/tests

Use the published prerelease container in `SquadRules/charts`.

The chart does not need to be published unless separately requested.

Requirements:

- chart fully rebranded;
- dependency build passes;
- `helm lint --strict` passes;
- `helm template` passes;
- chart tests/validation workflows pass;
- rendered manifests contain no retired branding;
- any available cluster/integration validation passes against the prerelease image.

## 14. Required execution order

Treat this as one continuous delivery task:

```text
1. Finish complete source/docs/filename rebrand
        ↓
2. Make SquadRules/mcp CI green
        ↓
3. Publish @squadrules/mcp prerelease
        ↓
4. Consumer-test the published npm package
        ↓
5. Build container from that published prerelease
        ↓
6. Publish Docker prerelease
        ↓
7. Smoke/integration-test the published container
        ↓
8. Rebrand/update SquadRules/charts to the prerelease image
        ↓
9. Run complete Helm validation/tests
        ↓
10. Record artifact versions, digests, SHAs, and evidence
```

Do not stop after an intermediate stage just because source tests are green.

## 15. Release safeguards

This task explicitly **does require prerelease publication**.

It does **not** authorize a stable release.

Must preserve:

- npm `latest` on the current stable version;
- no stable `5.0.0` publication;
- no merge of PR #6 unless explicitly instructed.

If the release workflow is frozen/disabled, re-enable only as needed to perform the requested prerelease flow, then leave stable publication protected.

Use the existing prerelease strategy rather than inventing manual version/tagging shortcuts.

## 16. Current CI note

At the time of the audit, current-head runs reported:

```text
Integration        action_required
Security           action_required
Automation policy  action_required
```

Do not report CI as green until current-head required checks actually pass. Investigate the cause rather than relying on the old handover claim.

## 17. Definition of Done

Final handover/report must include concrete evidence:

```text
npm:
  @squadrules/mcp@<prerelease>
  dist-tag: <prerelease-tag>
  install/consumer test: PASS

Docker:
  <registry>/squadrules/mcp:<same-prerelease>
  digest: sha256:<digest>
  startup/health/integration: PASS

Charts:
  SquadRules/charts @ <commit>
  helm dependency build: PASS
  helm lint --strict: PASS
  helm template: PASS
  chart/integration validation: PASS
```

Also report:

- final `SquadRules/mcp` commit SHA;
- final `SquadRules/charts` commit SHA;
- PR links;
- exact remaining case-insensitive occurrences of `kairos`;
- justification proving each remaining occurrence exists only for inbound legacy `kairos://` compatibility;
- evidence that npm `latest` and stable releases were not changed.

A green PR without published prerelease artifacts is not completion.

A published npm prerelease without a verified Docker prerelease is not completion.

A verified Docker prerelease without passing rebranded Helm charts is not completion.
