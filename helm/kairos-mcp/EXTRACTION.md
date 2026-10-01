# Chart extraction plan — `helm/kairos-mcp/` → `SquadRules/charts` (`mcp`)

> **Temporary document.** Delete this file once the chart has been extracted to
> the `SquadRules/charts` repository. It records the mechanics of the move and
> the supporting files that must be ported separately (they live outside the
> chart directory and are therefore NOT carried by `git filter-repo`).

## Target

| Property | Value |
|---|---|
| Destination repo | `SquadRules/charts` |
| Chart name | `mcp` |
| Chart path in new repo | `charts/mcp/` (recommended; matches `ct.yaml` `chart-dirs: [charts]`) |
| Image reference | `quay.io/squadrules/mcp` (already set in `values.yaml`) |

## CRITICAL — backward-compatibility invariants

These values are **immutable on live clusters** and MUST NOT change during or
after extraction. Selector preservation alone is insufficient — resource names,
Service targets, Secret names and PVC bindings must all survive `helm upgrade`.

| Invariant | Where | Value that must stay |
|---|---|---|
| Deployment `spec.selector.matchLabels` | `templates/mcp-deployment.yaml` | `app.kubernetes.io/name: kairos-mcp` (from `.Values.app.name \| default "kairos-mcp"`) |
| `app.name` default | `values.yaml` | `"kairos-mcp"` |
| App Service name + selector | `templates/mcp-service.yaml` | `.Values.app.name \| default "kairos-mcp"` |
| HTTPRoute backendRef Service | `templates/httproute-mcp.yaml` | `.Values.app.name \| default "kairos-mcp"` |
| HPA/VPA scaleTargetRef | `templates/app-hpa.yaml`, `app-vpa.yaml` | `.Values.app.name \| default "kairos-mcp"` |
| ServiceMonitor selector | `templates/app-servicemonitor.yaml` | `.Values.app.name \| default "kairos-mcp"` |
| Legacy credentials Secret | `templates/_helpers.tpl` (`mcp.credentialsLegacySecretName`) | literal `kairos-mcp-credentials` |
| Auth realm / clientId defaults | `values.yaml` | `kairos` / `kairos-mcp` (match deployed Keycloak + bundled realm) |
| Bundled realm file | `files/kairos-realm.json` | realm `kairos`, clients `kairos-mcp` / `kairos-cli` |
| Prometheus alert + metric names | `templates/prometheusrule.yaml` | `KAIROSAppDown`, `kairos_http_requests_total`, … (emitted by the app; changing breaks alerting) |

What **is** allowed to change (metadata not used in any selector):

- `app.kubernetes.io/part-of` label — renders `.Chart.Name`, so it moves
  `kairos-mcp` → `mcp`. No selector references `part-of`.
- Chart `name`, `description`, `icon`, `keywords`, `maintainers` in `Chart.yaml`.
- Template **filenames** (`kairos-mcp-deployment.yaml` → `mcp-deployment.yaml`);
  filenames never appear in rendered output.
- Internal helper names (`kairos.*` → `mcp.*` in `_helpers.tpl`); helper names
  never appear in rendered output. The literal Secret name returned by
  `mcp.credentialsLegacySecretName` is unchanged.

## 1. git filter-repo command

Run from a **fresh clone** of this repository (filter-repo rewrites history and
removes the `origin` remote by design).

```bash
# Fresh clone so history rewriting never touches the working repo.
git clone git@github.com:jakub-plichcinski/kairos-mcp.git kairos-mcp-extract
cd kairos-mcp-extract

# Pin the extraction to the commit that contains the rebrand metadata changes
# (see "Source commit" below). Replace <PINNED_SHA> before running.
git checkout <PINNED_SHA>

# Extract only the chart directory and move it to charts/mcp/ in the new repo.
git filter-repo \
  --path helm/kairos-mcp/ \
  --path-rename helm/kairos-mcp/:charts/mcp/

# Wire up the destination and push.
git remote add origin git@github.com:SquadRules/charts.git
git push -u origin main
```

Notes:

- `--path-rename helm/kairos-mcp/:charts/mcp/` places the chart at `charts/mcp/`
  so the new repo can host additional charts later. If a single-chart root layout
  is preferred instead, use `--path-rename helm/kairos-mcp/:` (chart at repo root)
  and set `ct.yaml` `chart-dirs: ["."]` accordingly.
- `Chart.lock` and `charts/*.tgz` are git-ignored build artifacts (see
  `.gitignore`); run `helm dependency update` in the new repo to regenerate.
- After the push, add `SquadRules/charts` as the source for the chart in any
  OCI registry / Artifact Hub publishing pipeline.

## 2. Source commit to pin

Pin the extraction to the commit that merges this rebrand preparation work
(branch `feat/squadrules-rebrand-835`). At the time of writing the working HEAD
is:

```
7a8100f5300639e1ae31b395665bd83a1d6dd5c6  (feat/squadrules-rebrand-835, pre-merge)
```

**Do not pin this pre-merge SHA.** After the PR merges, resolve the merge commit
on `main` and use that as `<PINNED_SHA>`:

```bash
git rev-parse origin/main   # run after the rebrand PR is merged
```

Pinning the merge commit guarantees the extracted history ends with the chart
named `mcp`, image `quay.io/squadrules/mcp`, and all backward-compatibility
invariants intact.

## 3. Supporting files to port separately

`git filter-repo --path helm/kairos-mcp/` carries **only** the chart directory.
The following chart-supporting files live outside it and must be recreated or
adapted in `SquadRules/charts` by hand. They are inventoried here; none are
modified by this task.

| File / dir (this repo) | Purpose | Depends on it | Destination |
|---|---|---|---|
| `ct.yaml` | chart-testing config (`chart-dirs: [helm]`, qdrant repo, schema/yaml/maintainer validation, `check-version-increment: false`) | `verify-helm` CI job (`ct lint --config ct.yaml --all`) | **Port to charts repo** — change `chart-dirs` to `[charts]` (or `[.]` for root layout); keep `chart-repos: qdrant=…` and add `valkey=…` |
| `scripts/helm-bump-version.mjs` | Idempotent `Chart.yaml` `version` bump (minor/patch) vs `origin/main` base; `CHART_VERSION_BASE` env override | Release/automation that bumps chart version independently | **Port to charts repo** — update hardcoded path `helm/kairos-mcp/Chart.yaml` → `charts/mcp/Chart.yaml` (and the `git show origin/main:helm/kairos-mcp/Chart.yaml` ref) |
| `scripts/helm-set-release-version.mjs` | Sets `Chart.yaml` `version`+`appVersion` and `values.yaml` `app.image.tag` to an exact semantic-release version | Release workflow `publish-helm` job (chart identity from single release version) | **Port to charts repo** — update both hardcoded paths; only needed if the charts repo keeps release-driven versioning |
| `scripts/helm-sync-app-version.mjs` | Syncs `Chart.yaml` `appVersion` + `values.yaml` `app.image.tag` from `package.json` (stable only); `--check` CI mode | Baseline maintenance + CI drift check | **Port to charts repo** — update paths; the new repo needs its own version source (no `package.json` unless added). Consider syncing from the published npm/image version instead |
| `scripts/test-helm.sh` | Local runner: tool checks (ct, kubeconform, helm-unittest), `helm repo add qdrant`, dependency build, `helm lint --strict`, `helm unittest`, `ct lint`, kubeconform on `helm template kairos helm/kairos-mcp -f helm/values.dev.yaml` | Developer local testing | **Port to charts repo** — update chart path, add `helm repo add valkey`, and replace `-f helm/values.dev.yaml` (dev overlay stays in the app repo; see below) |
| `helm/.dev/` | Local dev profiles + `helm-deploy.sh` / `k3b.sh` / `helm-update.sh` and `values-{http,tls,tls-redis,full}.yaml` overlays for k3d/k3s | Repo-local k3d flow (`k3b.sh`), dev testing | **Stays in app repo (mcp)** — these are app-repo dev tooling tied to the local cluster/ngrok setup, not part of the published chart. Reference the published chart via `helm upgrade --install … oci://…/mcp` or a local path override |
| `helm/infrastructure/` | Kustomize: ngrok `GatewayClass` + ngrok operator via OLM (`CatalogSource`, `Subscription`, `OperatorGroup`, namespace) | Cluster bootstrap before chart install | **Stays in app repo (mcp)** — cluster infra bootstrap, not chart content. Document as a prerequisite in the charts repo README |
| `helm/operators/` | Kustomize: OLM `OperatorGroup` + `Subscription`s for Keycloak, Percona Postgres, Redis (Spotahome) operators | Chart-created clusters (`keycloakInstance`/`postgresCluster`/`redisCluster` enabled) | **Stays in app repo (mcp)** — operator bootstrap prerequisite, not chart content |
| `helm/prerequisites/` | Shell installers: `install-{keycloak,ngrok,pg,redis}-operator.sh` | Manual operator setup | **Stays in app repo (mcp)** — convenience scripts, not chart content |
| `helm/values.dev.yaml` | Dev overlay (k3d/ngrok, Ollama embeddings, auth enabled, realm import) used by `test-helm.sh` kubeconform + `k3b.sh` | Local dev + chart-testing render | **Stays in app repo (mcp)** — environment-specific overlay; the charts repo should ship a neutral `charts/mcp/ci/test-values.yaml` for ct instead |
| `helm/values.prod.yaml` | Production overlay example (HPA, resources, ngrok, realm import) | Documentation/example for operators | **Stays in app repo (mcp)** as an example; optionally copy a sanitized version into the charts repo docs |
| `helm/README.md` | Layout overview of `helm/` (operators, infrastructure, chart) | Human navigation of app-repo `helm/` | **Stays in app repo (mcp)** — describes the app-repo `helm/` tree; the charts repo gets its own root README |

### Chart-internal files carried by filter-repo (no separate porting)

These move with the chart but need follow-up edits **after** extraction (they are
documentation, outside this task's modify scope):

- `charts/mcp/README.md` — still says "KAIROS MCP Helm chart (`helm/kairos-mcp`)"
  and references `helm/.dev/k3b.sh`, `helm/values.dev.yaml`. Rewrite for the
  charts-repo layout and SquadRules branding.
- `charts/mcp/docs/OPERATORS.md` — references `cd helm/kairos-mcp` and
  `helm/operators` / `helm/infrastructure` paths. Update install instructions to
  the new repo layout and link the app repo for operator bootstrap.

## 4. Chart CI pipeline structure for the new repo

The app repo currently validates the chart inside `.github/workflows/integration.yml`
(job `verify-helm`, gated on `changes.outputs.helm == 'true'` for paths
`helm/kairos-mcp/**` and `ct.yaml`). Publication historically lived in the
Release workflow but has already been removed from `scripts/ci-release.mjs`
("Chart publication moved to the SquadRules/charts repository").

Recreate the following in `SquadRules/charts`:

### 4.1 Validation workflow (PR + push to main)

Mirror the `verify-helm` job, repointed at `charts/mcp`:

1. `actions/checkout` (fetch-depth 0 for ct).
2. `azure/setup-helm@v5` (version `v4.0.5` to match the app repo).
3. Add dependency repos:
   ```bash
   helm repo add qdrant https://qdrant.github.io/qdrant-helm
   helm repo add valkey https://valkey.io/valkey-helm/
   ```
4. `helm dependency build charts/mcp`
5. `helm lint charts/mcp --strict`
6. Install `helm-unittest` plugin (`v1.0.3`) → `helm unittest charts/mcp`
7. `helm/chart-testing-action@v2.8.0` (`v3.14.0`) → `ct lint --config ct.yaml --all`
8. kubeconform (`v0.6.7`) on rendered manifests:
   ```bash
   helm template mcp charts/mcp | kubeconform -strict -kubernetes-version 1.30.0 -ignore-missing-schemas -summary
   ```
   (The app repo used release name `kairos-mcp`; any release name works for
   kubeconform. Use a neutral ct values file instead of `helm/values.dev.yaml`,
   which stays in the app repo.)

Path filter for the `changes` job: `charts/mcp/**` and `ct.yaml`.

### 4.2 Release / publish workflow

The charts repo owns chart publication now. Recommended: chart-releaser or
`helm push` to an OCI registry on a `Chart.yaml` `version` change.

- Trigger on push to `main` when `charts/mcp/Chart.yaml` version changes.
- `helm package charts/mcp` → push to `oci://quay.io/squadrules/charts` (or the
  registry chosen for SquadRules).
- Keep `check-version-increment: false` in `ct.yaml` only if version bumps are
  enforced elsewhere; otherwise let ct enforce increments.
- The chart `appVersion` / `app.image.tag` must track the published
  `squadrules/mcp` image version. In the app repo this came from
  `helm-sync-app-version.mjs` (package.json) and `helm-set-release-version.mjs`
  (semantic-release). The charts repo needs an equivalent source of truth —
  either a scheduled sync from the published npm/image version, or a manual
  bump PR per release. Port the two scripts (section 3) and repoint their paths.

### 4.3 ct.yaml for the new repo

```yaml
remote: origin
target-branch: main
chart-dirs:
  - charts            # or "." for a root-level single-chart layout
chart-repos:
  - qdrant=https://qdrant.github.io/qdrant-helm
  - valkey=https://valkey.io/valkey-helm/
validate-chart-schema: true
validate-yaml: true
validate-maintainers: true
check-version-increment: false   # revisit once release automation is in place
```

## 5. Post-extraction verification checklist

In the new `SquadRules/charts` repo, confirm the backward-compatibility
invariants survived the move:

```bash
helm dependency build charts/mcp
helm template kairos charts/mcp -n kairos \
  --set app.enabled=true --set qdrant.enabled=true \
  --set keycloakInstance.enabled=true --set keycloakRealmImport.enabled=true \
  --set keycloakRealmImport.publicBaseUrl=http://example.com \
  --set postgresCluster.enabled=true --set redisCluster.enabled=true \
  --set gateway.enabled=true --set gateway.createGateway=true \
  --set gateway.gatewayClassName=ngrok --set gateway.hostname=example.com \
  > rendered.yaml

# These MUST be present and unchanged:
grep -E "name: kairos-mcp$" rendered.yaml          # Deployment/Service/HPA/VPA/ServiceMonitor
grep "kairos-mcp-credentials" rendered.yaml        # legacy Secret fallback name
grep "app.kubernetes.io/name: kairos-mcp" rendered.yaml  # selector label
grep "rfr-kairos-redis" rendered.yaml              # Redis master Service target
```

Only `app.kubernetes.io/part-of` should read `mcp` (was `kairos-mcp`); every
selector, Service target, Secret name and PVC binding must be byte-identical to
the pre-extraction render.
