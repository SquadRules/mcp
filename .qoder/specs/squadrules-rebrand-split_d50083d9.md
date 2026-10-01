# KAIROS → SquadRules Rebrand & Repository Split

## Summary

Rebrand the product from KAIROS to SquadRules and split into two repositories (`SquadRules/mcp` for application, `SquadRules/charts` for Helm), using a **compatibility-first** strategy: all wire-protocol identifiers, persistent data paths, and runtime defaults retain backward-compatible aliases so no existing deployment breaks on upgrade. The internal codebase keeps `kairos`-named TypeScript symbols unchanged (they are not user-facing); only distribution-layer identity, user-visible strings, and documentation are renamed.

---

## Decision Framework: MUST-CHANGE / CAN-REMAIN / NEEDS-ALIAS

### MUST-CHANGE (user-facing distribution identity)
- npm package name → `@squadrules/mcp`
- CLI bin entries → `squadrules` (primary), keep `kairos`/`kairos-mcp` as deprecated aliases
- Container images → `quay.io/squadrules/mcp`, `docker.io/squadrules/mcp`
- Helm chart name → `mcp` in `SquadRules/charts`
- Chart OCI target → `oci://ghcr.io/squadrules/charts/mcp`
- Repository URLs → `github.com/SquadRules/mcp`
- MCP server name → `SquadRules`
- `/.well-known` `resource_name` → `SquadRules MCP`
- README/docs prose, logo, branding copy
- ESLint plugin filenames (internal tooling, cosmetic but consistent)
- Agent skill directory names (`.agents/skills/squadrules/`, `.agents/skills/squadrules-dev/`)
- `.agents/mcp.json` server IDs

### CAN-REMAIN (internal, not part of external contract)
- TypeScript symbol names (`KairosError`, `KAIROS_TOOL_REGISTRY`, `parseKairosUri`, etc.)
- Source file names (`src/tools/kairos-uri.ts`, `src/utils/kairos-user-dirs.ts`, etc.) — rename in a follow-up cleanup PR if desired, not blocking
- Test file names and fixture identifiers
- MCP tool names (`activate`, `forward`, `train`, `reward`, `tune`, `delete`, `export`, `spaces`) — not kairos-branded
- HTTP API routes — not kairos-branded
- Container OS user `kairos` (uid 1001) — invisible to consumers (rename optional)
- Docker Compose network/project names — dev-only
- `KAIROS_NAMESPACE` UUID constant in `src/services/id-generator.ts:13` — **MUST NOT CHANGE** (all stored Qdrant point IDs derive from it)

### NEEDS-ALIAS (data-bearing or wire-visible — backward-compat required)
- URI scheme `kairos://` — accept `squadrules://` on input, continue emitting `kairos://` indefinitely
- Env var prefix `KAIROS_*` (~23 vars in `src/config.ts`) — add `SQUADRULES_*` aliases, new takes priority
- Redis key prefix default `kairos:` — keep as default; operators can override via `SQUADRULES_KEY_VALUE_PREFIX`
- Qdrant collection defaults `kairos`, `kairos_memories` — **DO NOT CHANGE** (data lives here)
- Prometheus metrics `kairos_*` — keep; optionally dual-register `squadrules_*` behind env flag
- Session cookie `kairos_session` — emit both old and new; read either
- Keyring service `kairos-cli` — dual-read fallback, migrate on first access
- Config dir `~/.config/kairos` — prefer `~/.config/squadrules` if exists, fall back to legacy
- Keycloak realm/client IDs — add new clients alongside old; do NOT rename realms
- Wire JSON field `kairos_local_artifact_dir` — emit both keys in responses
- MCP UI resource URIs `ui://kairos/*` — register both; keep legacy in `_meta` for one release
- `.well-known` field `kairos_cli_client_id` — emit both old and new key names
- Protected space IDs `space:kairos-app`, `space:kairos-system` — **DO NOT CHANGE** (stored in Qdrant payloads)
- Helm Deployment `spec.selector` `app.kubernetes.io/name: kairos-mcp` — **IMMUTABLE on existing Deployments**; preserve forever
- Release body marker `<!-- kairos-release:... -->` — parse both old and new markers

---

## Phase 0: Prerequisites (No Code Changes)

**Owner**: Repository admin (human action required)

1. Verify `SquadRules` GitHub org exists and has admin access
2. Reserve `@squadrules` npm scope; publish placeholder `@squadrules/mcp@0.0.0`
3. Register npm Trusted Publisher against `SquadRules/mcp` + workflow filename `release.yml` **before** any publish (avoids known ENEEDAUTH pitfall)
4. Reserve `quay.io/squadrules` namespace; create `mcp` repository
5. Reserve `docker.io/squadrules` org; create `mcp` repository
6. Verify `ghcr.io/squadrules/charts` package can be created (GHCR uses org path automatically)
7. Provision GitHub Secrets in both destination repos: `QUAY_NAMESPACE`, `QUAY_USERNAME`/`QUAY_PASSWORD`, `DOCKER_USERNAME`/`DOCKER_PASSWORD`, cosign keys
8. Verify Codex GitHub App installation on `SquadRules` org
9. Document cosign certificate identity change (`GITHUB_WORKFLOW_REF` will differ post-transfer)
10. **Security**: Rotate any committed secrets in `.env.prod`/`.env.dev_stdio` before transfer makes them discoverable under new org

**Blocking**: All subsequent phases depend on Phase 0 completion.

---

## Phase 1: Compatibility Layer (ship as minor release from current repo)

All changes are **additive** — no existing identifier is removed or renamed. This phase can ship independently.

### 1A. Env-var alias infrastructure

**File**: `src/config.ts`

- Add helper function:
  ```typescript
  function getEnvAliased(newKey: string, legacyKey: string, defaultValue: string): string {
    return process.env[newKey] || process.env[legacyKey] || defaultValue;
  }
  ```
  (Plus `getEnvIntAliased`, `getEnvBooleanAliased`, `getEnvFloatAliased` variants)
- Apply to all 23 `KAIROS_*` variables: `SQUADRULES_*` takes priority, `KAIROS_*` remains functional
- Log deprecation warning (once at startup) when only legacy names are set
- **DO NOT change defaults** for: `KAIROS_REDIS_PREFIX` (stays `kairos:`), `QDRANT_COLLECTION` (stays `kairos`), `KAIROS_APP_SPACE_ID` (stays `space:kairos-app`)

### 1B. URI scheme dual-accept

**File**: `src/tools/kairos-uri.ts`

- Update regexes to accept both `kairos://` and `squadrules://` as input
- All `build*Uri()` functions continue emitting `kairos://` (canonical stored form)
- Add comment block explaining this is a permanent compatibility decision (stored data uses `kairos://`)
- Update error message to mention both schemes

### 1C. Session cookie dual-emit

**File**: `src/http/http-auth-middleware.ts`

- Set both `kairos_session` and `squadrules_session` cookies on write
- Read from either on inbound (prefer new)
- After one major release, drop legacy write

### 1D. Keyring migration

**File**: `src/cli/keyring.ts`

- On `getToken` miss under `squadrules-cli`, retry under `kairos-cli`
- If found under legacy, re-write under new service and delete old entry
- Same pattern for `getRefreshToken`

### 1E. Config dir migration

**File**: `src/utils/kairos-user-dirs.ts`

- Prefer `~/.config/squadrules` if it exists
- Fall back to `~/.config/kairos`
- On first write to new dir, copy config and leave `MIGRATED_FROM` marker

### 1F. Wire field dual-emit

**Files**: `src/tools/local-artifact-dir-contract.ts`, activate/forward/next schemas

- Emit both `kairos_local_artifact_dir` and `squadrules_local_artifact_dir` in responses
- Accept either on input

### 1G. MCP UI resource dual-registration

**File**: `src/mcp-apps/kairos-ui-constants.ts`

- Register both `ui://kairos/*` and `ui://squadrules/*` resources
- Keep `ui://kairos/*` in `tools/list` `_meta.ui.resourceUri` for this release

### 1H. `.well-known` metadata

**File**: `src/http/http-well-known.ts`

- Emit both `kairos_cli_client_id` and `squadrules_cli_client_id` fields
- Update `resource_name` to `'SquadRules MCP'` (cosmetic, safe)

### 1I. Keycloak additional clients

**Files**: `scripts/keycloak/import/*.json`, Helm values

- Add `squadrules-mcp` and `squadrules-cli` as **additional** OIDC clients with identical redirect URIs
- Add both to `AUTH_ALLOWED_AUDIENCES` default list
- Do NOT rename existing realms or clients

### 1J. Release-state marker compat

**File**: `scripts/ci-release-state.mjs`

- Parse both `<!-- kairos-release:... -->` and `<!-- squadrules-release:... -->` markers in existing GitHub releases

**Phase 1 exit criteria**: All existing tests pass unchanged; new alias tests added; no breaking changes; existing deployments upgrade seamlessly.

---

## Phase 2: Distribution Identity Rename (ship as 5.0.0 from SquadRules/mcp)

### 2A. Package identity

**File**: `package.json`

- `name`: `@squadrules/mcp`
- `bin`: `{ "squadrules": "dist/cli/index.js", "squadrules-mcp": "dist/cli/index.js", "kairos": "dist/cli/index.js", "kairos-mcp": "dist/cli/index.js" }` (legacy bins kept one major)
- `repository.url`: `https://github.com/SquadRules/mcp.git`
- `bugs.url`: `https://github.com/SquadRules/mcp/issues`
- `homepage`: `https://github.com/SquadRules/mcp#readme`
- Update all scripts referencing old package name

### 2B. Legacy npm stub

- Publish `@jakub-plichcinski/kairos-mcp@5.0.0` as a stub with `preinstall` warning + dependency on `@squadrules/mcp@^5`
- Then `npm deprecate @jakub-plichcinski/kairos-mcp "Renamed to @squadrules/mcp"`

### 2C. CLI program name

**File**: `src/cli/program.ts:34`

- `program.name('squadrules')` (Commander uses `argv[0]` for help text; legacy bins still work)

### 2D. MCP server identity

**Files**: `src/server.ts:47`, `src/http/http-health-routes.ts`, `src/http/http-server.ts`

- Server name: `'SquadRules'`
- Health endpoint service name: `'squadrules-mcp'`
- Startup log: `'SquadRules MCP server'`

### 2E. Dockerfiles

**Files**: `Dockerfile`, `Dockerfile.dev`, `Dockerfile.stdio`

- Update package install path to `@squadrules/mcp`
- Update CMD/ENTRYPOINT paths
- Container user rename `kairos` → `squadrules` (optional, cosmetic; uid stays 1001)
- Update `QDRANT_COLLECTION` env defaults in Dockerfile — **KEEP AS `kairos_memories`** (data compat)

### 2F. Container registry targets

**File**: `scripts/ci-registry.mjs`

```javascript
return [
  { image: 'docker.io/squadrules/mcp', host: 'registry-1.docker.io', path: 'squadrules/mcp', ... },
  { image: `quay.io/${namespace}/mcp`, host: 'quay.io', path: `${namespace}/mcp`, ... },
];
```

### 2G. Release script

**File**: `scripts/ci-release.mjs`

- `packageName = '@squadrules/mcp'`
- Update tgz filename pattern
- **Remove** chart packaging (`preparePackage` lines 104-111) and `publishChart` (line 260+) — chart moves to separate repo
- Update cosign identity documentation

### 2H. Docker Compose

**File**: `compose.yaml`

- Image reference: `quay.io/squadrules/mcp:v5.0.0`
- Network name: `squadrules-network` (dev-only, safe)
- RedisInsight alias: `squadrulesKeyValue`

### 2I. CI workflows (SquadRules/mcp)

**File**: `.github/workflows/integration.yml`

- Remove `verify-helm` job entirely (chart lives elsewhere now)
- Remove `helm/kairos-mcp/**` from path filters
- Update artifact names to `squadrules-mcp-${VERSION}.tgz`
- Update `integration-pass` needs list

**File**: `.github/workflows/release.yml`

- Remove Helm packaging/publishing stages
- Update env var references
- Add Buildx layer cache (`actions/cache` keyed on `Dockerfile` + `package-lock.json`)
- Add `repository_dispatch` event emission after image publish (triggers chart repo)

**File**: `.github/workflows/security.yml`

- Update image tag references

**File**: `renovate.json`

- Update `matchPackageNames` for new image paths
- Remove `helm/kairos-mcp/Chart.yaml` path references

### 2J. ESLint plugins (cosmetic rename)

- `eslint/plugins/kairos-forbidden-text.cjs` → `squadrules-forbidden-text.cjs`
- `eslint/plugins/kairos-codeql-line-comments.cjs` → `squadrules-codeql-line-comments.cjs`
- `eslint/plugins/kairos-mcp-widget.cjs` → `squadrules-mcp-widget.cjs`
- Update `eslint/flat-config.cjs` imports

### 2K. Agent skills and MCP config

- Copy `.agents/skills/kairos/` → `.agents/skills/squadrules/` (keep legacy for one release)
- Copy `.agents/skills/kairos-dev/` → `.agents/skills/squadrules-dev/` (keep legacy)
- Update `.agents/mcp.json` server IDs to `SQUADRULES-DEVELOPMENT` / `SQUADRULES-HELM-INTEGRATION`
- Update `AGENTS.md` to reference new skill paths

### 2L. Documentation and prose

- Update `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`
- Update all `docs/**` prose references
- Update `logo/kairos-mcp.svg` filename and embedded copy
- Keep historical references in changelogs/release notes intact

### 2M. Environment files

- `.env.dev_simple`, `.env.dev_stdio`, `.env.prod`: use `SQUADRULES_*` var names (legacy still works via Phase 1 aliases)

---

## Phase 3: Repository Split

### 3A. Extract chart history

```bash
# From a clone of the repo (post-transfer):
git filter-repo --subdirectory-filter helm/kairos-mcp --path-rename helm/kairos-mcp/:mcp/
# Push result to SquadRules/charts
```

### 3B. SquadRules/charts structure

```
SquadRules/charts/
├── mcp/
│   ├── Chart.yaml          # name: mcp
│   ├── values.yaml
│   ├── values.schema.json
│   ├── templates/
│   ├── files/
│   └── tests/
├── .github/workflows/
│   ├── integration.yml     # lint + unittest + kubeconform + ct (parallel)
│   └── release.yml         # package + OCI push (on repository_dispatch or tag)
├── ct.yaml
└── README.md
```

### 3C. Chart identity updates

**File**: `mcp/Chart.yaml`
- `name: mcp`
- `appVersion: "5.0.0"` (tracks npm release)
- `version: 1.0.0` (independent chart semver)
- Update icon URL, maintainer, keywords, repository links

**File**: `mcp/values.yaml`
- `app.image.repository: "quay.io/squadrules/mcp"`
- Auth defaults: keep `kairos-dev` realm and `kairos-mcp` clientId (existing deployments)
- **Preserve** `app.name: "kairos-mcp"` as default (Helm selector immutability!)
- Add documentation comment explaining why `app.name` retains the legacy value

**File**: `mcp/templates/_helpers.tpl`
- Rename template helpers from `kairos.*` to `mcp.*` (internal to chart, not selector-bound)
- Preserve the `credentialsLegacySecretName` fallback pattern

**Template files**: Rename `kairos-mcp-deployment.yaml` → `mcp-deployment.yaml`, etc.
- **CRITICAL**: Keep `app.kubernetes.io/name: {{ .Values.app.name | default "kairos-mcp" }}` in `spec.selector.matchLabels` — this is **immutable** on existing Deployments

### 3D. Chart CI pipeline (new)

```yaml
# .github/workflows/integration.yml
jobs (all parallel):
  lint:       helm lint --strict
  unittest:   helm-unittest
  template:   helm template | kubeconform
  ct:         chart-testing lint

# .github/workflows/release.yml (triggered by repository_dispatch from SquadRules/mcp)
jobs:
  package:    helm package (needs lint+unittest+template pass)
  publish:    oras push oci://ghcr.io/squadrules/charts/mcp:${CHART_VERSION}
```

### 3E. Remove chart from SquadRules/mcp

- Delete `helm/kairos-mcp/`, `ct.yaml`, `scripts/helm-*.mjs`, `scripts/test-helm.sh`
- Remove `verify-helm` job from `integration.yml`
- Remove `helm:sync-app-version` from version sync scripts
- Decide fate of `helm/infrastructure`, `helm/operators`, `helm/prerequisites`, `helm/.dev` (recommend: keep in `mcp` as dev-cluster scaffolding, or move to a separate `dev-infra` location)

### 3F. Repository transfer

- Transfer `jakub-plichcinski/kairos-mcp` → `SquadRules/mcp` via GitHub org transfer (preserves issues, PRs, stars, watches, sets up HTTP redirects)
- Re-register npm Trusted Publisher against new repo path
- Verify with `npm publish --dry-run` from a `workflow_dispatch` run
- Update all branch protection rules, required checks, GitHub App installations

### 3G. Release flow post-split

```
SquadRules/mcp (on push to main):
  1. semantic-release → npm publish @squadrules/mcp
  2. Docker buildx (from exact published npm version) → push to Quay + Docker Hub
  3. repository_dispatch → SquadRules/charts

SquadRules/charts (on repository_dispatch):
  1. Pin appVersion to just-published npm version
  2. Bump chart version (independent semver)
  3. helm lint + unittest + kubeconform + ct
  4. helm package + oras push to oci://ghcr.io/squadrules/charts/mcp
```

Independent failure boundaries: npm failure does not block chart; chart failure does not block npm; image failure blocks chart (by design — chart needs a published image).

---

## Phase 4: Post-Split Cleanup (one major version later)

- Remove `KAIROS_*` env-var aliases (after deprecation period)
- Remove `kairos_session` cookie write
- Remove `kairos-cli` keyring fallback
- Remove `~/.config/kairos` directory fallback
- Remove `kairos_local_artifact_dir` response field
- Remove `ui://kairos/*` resource registrations
- Remove legacy `kairos`/`kairos-mcp` npm bin entries
- Deprecate `@jakub-plichcinski/kairos-mcp` stub
- Optionally migrate Prometheus metrics with dual-registration window
- Optionally rename Keycloak realms (provide export/import migration script)
- **NEVER** change: `KAIROS_NAMESPACE` UUID, Qdrant collection defaults, `kairos://` URI emission, Helm selector label, protected space IDs

---

## Dependency Graph

```
Phase 0 (admin prereqs) ─────────────────────────────┐
                                                      │
Phase 1 (compat layer, current repo) ────────────────┤
  1A-1J all independent, can be parallel             │
                                                      ▼
Phase 2 (distribution rename) ← requires Phase 0 + Phase 1 shipped
  2A (package.json) ← blocks 2B, 2E, 2F, 2G
  2C, 2D, 2H, 2I, 2J, 2K, 2L, 2M ← independent of each other
                                                      │
Phase 3 (repo split) ← requires Phase 2 complete     │
  3A (filter-repo) → 3B, 3C, 3D (charts setup)      │
  3E (remove chart from mcp)                         │
  3F (GitHub transfer) ← requires Phase 0 registries │
  3G (release flow) ← requires 3D + 3E + 3F         │
                                                      ▼
Phase 4 (cleanup) ← requires one full major release cycle in the field
```

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Qdrant collection rename strands all vector data | Critical | Never change defaults. `KAIROS_NAMESPACE` UUID is immutable. |
| Helm `spec.selector` immutability breaks `helm upgrade` | Critical | Preserve `app.kubernetes.io/name: kairos-mcp` in selector forever. Document that operators wanting new selector must uninstall+reinstall (preserving PVCs). |
| URI scheme rename invalidates stored adapters | Critical | Keep `kairos://` as canonical emitted scheme permanently. Accept `squadrules://` input only. |
| npm Trusted Publisher misconfigured after transfer → ENEEDAUTH | High | Register against `SquadRules/mcp` + `release.yml` BEFORE first publish. Verify with dry-run. |
| Keycloak realm/client rename invalidates live JWTs | High | Add new clients alongside old; never rename realms. Extend `AUTH_ALLOWED_AUDIENCES`. |
| CLI users lose keyring tokens silently | High | Dual-read fallback with auto-migration (Phase 1D). |
| Redis prefix change logs everyone out | High | Keep `kairos:` as default. New prefix only via explicit env var. |
| Cosign signature verification breaks for pre-transfer images | Medium | Document identity change; pin `--certificate-identity-regexp` to match both during transition. |
| Prometheus dashboards go blank on metric rename | Medium | Keep `kairos_*` names. Dual-register only behind opt-in flag. |
| Chart version skew (image published, chart not yet) | Medium | Chart triggers automatically on image publish via `repository_dispatch`. Alert on skew > 15min. |
| MCP hosts cache `tools/list` resourceUri and break widgets | Medium | Register both URI sets; keep legacy in `_meta` for one release. |
| `.agents/skills/kairos` rename orphans existing agent installs | Medium | Ship both directories for one release cycle. |
| Buildx cache miss after repo transfer (slow first releases) | Low | Pre-warm with `workflow_dispatch` dry-run immediately after transfer. |

---

## Rejected Alternatives

### 1. Global find-replace of all "kairos" strings
**Rejected because**: 506+ files contain the string in fundamentally different contexts (wire protocol vs cosmetics vs stored data). A blind replace would break Qdrant point ID generation, invalidate all stored URIs, corrupt Helm selectors, and strand existing data.

### 2. Full TypeScript symbol rename (`KairosError` → `SquadRulesError`, etc.)
**Rejected because**: These are internal identifiers with zero user visibility. Renaming them adds ~200 files of diff noise, increases merge-conflict risk with in-flight PRs, and provides no functional benefit. Can be done later as optional cleanup.

### 3. Two separate releases (4.9.0 compat, then 5.0.0 rename)
**Rejected in favor of**: Shipping the compat layer as part of 5.0.0 itself. The user base is small enough that a single coordinated release with built-in backward compatibility is simpler than managing two release cycles. The compat layer still ships — just in the same version as the rename.

### 4. Qdrant collection migration script
**Rejected because**: Qdrant does not support collection rename. A migration would require re-embedding all vectors (expensive, lossy, time-consuming). The collection name is an internal implementation detail; keeping `kairos`/`kairos_memories` as defaults costs nothing.

### 5. URI scheme full migration (rewrite stored `kairos://` to `squadrules://`)
**Rejected because**: URIs are embedded in Qdrant point payloads, export bundles, adapter markdown, and client caches. Rewriting them requires a full data migration with no rollback path. The URI scheme is a protocol identifier, not a brand statement — accepting both on input while emitting the legacy form is the zero-risk approach.

### 6. Chart published to Quay (same registry as images)
**Rejected in favor of GHCR**: The issue specifies `oci://ghcr.io/squadrules/charts/mcp`. GHCR integrates natively with GitHub Actions OIDC (no stored credentials), has GitHub CDN for fast pulls, and keeps chart publication within the same platform as the source repo.

---

## Performance Optimizations (from Plan B)

These are incorporated into Phase 2I and 3D:

| Optimization | Expected Gain |
|---|---|
| Buildx layer cache in release workflow | −5min per release build |
| Remove `verify-helm` from integration workflow | −3min PR feedback |
| Pre-patched Node base image (extract npm patching layer) | −30s per Docker build |
| Parallel chart validation (4 independent jobs) | −2min chart CI |
| `repository_dispatch` chart trigger (no polling) | Instant chart pipeline start |
| Dual-registry parallel image push | −1min publish stage |

---

## Implementation Ownership

| Phase | Who | Estimated Effort |
|---|---|---|
| Phase 0 | Human admin (registry/org access required) | 1-2 hours |
| Phase 1 | Coding agent (multiple parallel tasks) | 1 day |
| Phase 2 | Coding agent (sequential with some parallelism) | 2-3 days |
| Phase 3A-3E | Coding agent + human (git filter-repo, repo creation) | 1 day |
| Phase 3F | Human admin (GitHub transfer) | 30 min |
| Phase 3G | Coding agent (workflow wiring) | Half day |
| Phase 4 | Future (deferred by one major version) | N/A |
