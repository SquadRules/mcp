# Helm chart installation

<!-- kairos-lint-allow-protocol-synonyms -->

Deploy SquadRules on Kubernetes using the `kairos-mcp` Helm chart (in-repo at
`helm/kairos-mcp`, published to `oci://ghcr.io/squadrules/charts/mcp`). This
guide covers prerequisites, operator installation, chart installation, and
post-install verification.

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **Kubernetes** 1.28+ | Any conformant cluster (k3d, EKS, GKE, AKS, on-prem) |
| **Helm** v3.14+ | Package manager for Kubernetes |
| **kubectl** | Configured context targeting the destination cluster |
| **Node.js 25+** + **[SquadRules CLI](../CLI.md)** | Required for auth, bulk management, and verification |
| **Gateway API CRDs** | Required when `gateway.enabled: true`; often bundled by the ingress operator |

### Operators

The chart can create Custom Resources for Qdrant, Redis, PostgreSQL, and
Keycloak. Each CR requires its operator pre-installed. Use the idempotent
OLM-native manifests live under `helm/operators/` and `helm/infrastructure/`.

```sh
# 1) Install OLM (official guide):
# https://olm.operatorframework.io/docs/getting-started/
#
# 2) Install operators and infrastructure (idempotent):
kubectl apply -k helm/operators
kubectl apply -k helm/infrastructure
```

---

## Chart installation

### 1. Add Helm repositories

```sh
helm repo add qdrant https://qdrant.github.io/qdrant-helm
helm repo add valkey https://valkey.io/valkey-helm/
helm repo update
```

### 2. Build chart dependencies

```sh
helm dependency build helm/kairos-mcp
```

### 3. Create a values file

Start from one of the examples:

| File | Description |
|------|-------------|
| `helm/values.dev.yaml` | k3d local development (Ollama embeddings, ngrok gateway) |
| `helm/values.prod.yaml` | Production template (OpenAI embeddings, cert-manager TLS) |

Copy and customise. At minimum, set:

- `app.qdrantUrl` — Qdrant endpoint
- `app.keycloakUrl` — public Keycloak URL (if auth enabled)
- `gateway.hostname` — public hostname for HTTPRoute
- Embedding backend (Ollama via `ollama.enabled` or OpenAI via
  `app.embedding.openai.existingSecret`)

### 4. Install or upgrade

```sh
helm upgrade --install kairos helm/kairos-mcp \
  -n kairos --create-namespace \
  -f my-values.yaml \
  --wait --timeout 15m
```

### 5. Verify

```sh
kubectl get pods -n kairos
kubectl get gateway,httproute -n kairos
curl -sS "https://<your-hostname>/health"
```

---

## Embedding backends

The chart supports three embedding backends. Choose one.

### Ollama (default in dev)

Set `ollama.enabled: true` in values. The chart deploys an Ollama StatefulSet
with `nomic-embed-text`. The app connects via `http://ollama:11434`.

```yaml
ollama:
  enabled: true

app:
  embedding:
    openai:
      model: nomic-embed-text
  extraEnv:
    - name: OPENAI_API_URL
      value: http://ollama:11434
    - name: OPENAI_API_KEY
      value: "ollama"
```

### OpenAI

Create a secret with your API key, then reference it:

```sh
kubectl create secret generic kairos-mcp-embedding -n kairos \
  --from-literal=OPENAI_API_KEY=sk-...
```

```yaml
app:
  embedding:
    openai:
      existingSecret: kairos-mcp-embedding
      secretKey: OPENAI_API_KEY
      model: text-embedding-3-small
```

### TEI (Text Embeddings Inference)

Point to your TEI endpoint via `extraEnv`:

```yaml
app:
  extraEnv:
    - name: TEI_BASE_URL
      value: http://your-tei:8080
```

---

## Optional components

| Component | Enabled by | Requires |
|-----------|-----------|----------|
| Qdrant cluster | `qdrant.enabled: true` | Qdrant Helm chart (subchart) |
| Redis HA (Spotahome) | `redisCluster.enabled: true` | Redis Operator |
| Valkey standalone | `valkey.enabled: true` | Valkey Helm chart (subchart) |
| PostgreSQL (Percona) | `postgresCluster.enabled: true` | Percona PG Operator |
| Keycloak instance | `keycloakInstance.enabled: true` | Keycloak Operator |
| Keycloak realm import | `keycloakRealmImport.enabled: true` | Keycloak Operator + instance |
| Ollama StatefulSet | `ollama.enabled: true` | — |
| Gateway + HTTPRoutes | `gateway.enabled: true` | Gateway API CRDs + controller |

Enterprise users who manage their own Keycloak or identity provider can leave
`keycloakInstance.enabled: false` and `keycloakRealmImport.enabled: false`
(both are disabled by default).

---

## Authentication

When `app.auth.enabled: true`, the chart configures OIDC via Keycloak. The
realm import (if enabled) creates a `kairos-mcp` client with appropriate
redirect URIs derived from `gateway.hostname`.

SMTP for email verification is **not** managed by the chart. Configure it in
the Keycloak Admin UI or via the Realm API after deployment.

---

## Versioning policy

Chart release identity derives from the repository's **single release version**, computed once by semantic-release. See the [release runbook](../../.agents/skills/squadrules-dev/references/release-semver.md):

| Lane | What | Updated by |
|------|------|------------|
| **Chart release identity** | `Chart.yaml` `version` + `appVersion` + default `app.image.tag` in `values.yaml` | Release preparation: `scripts/helm-set-release-version.mjs` sets all three to the exact version before validation and publication to `oci://ghcr.io/squadrules/charts/mcp` |
| **In-repo baseline** | Committed `Chart.yaml` / `values.yaml` values | `npm run version:sync` (stable releases only); the committed values are the last synced baseline, not the next version |
| **Dependencies** | `Chart.yaml` `dependencies[].version`, third-party image tags (Percona, Ollama, etc.) | Tests-gated Renovate `fix(deps):` PRs |

Published chart versions are immutable. Recovery accepts an existing version only
when its configuration and payload checksums match the original release manifest.
Images (`quay.io/squadrules/mcp`) and charts (`ghcr.io/squadrules/charts/mcp`)
use separate repositories to avoid tag collisions. Chart PRs
pass Integration's `verify-helm` job (lint, unittest, chart-testing, kubeconform).
Override `app.image.tag` in your values to pin a release independently of the chart default.

---

## Upgrading

```sh
helm repo update
helm dependency build helm/kairos-mcp
helm upgrade kairos helm/kairos-mcp -n kairos -f my-values.yaml --wait
```

The chart `appVersion` in `Chart.yaml` tracks the latest stable release. Override
with `app.image.tag` in your values to pin a specific release.

---

## Uninstall

```sh
helm uninstall kairos -n kairos
```

This removes chart-managed resources. PVCs for stateful components (Qdrant,
Postgres, Ollama) are retained by default; delete them manually if needed.

---

## Developer workflow (k3d)

For local development with k3d, use the all-in-one bootstrap script:

```sh
./helm/.dev/k3b.sh
```

This creates a multi-node k3d cluster, installs all operators, and deploys the
full chart using `helm/values.dev.yaml`. See `helm/.dev/README.md` for profiles
and advanced usage.

---

## Reference

- Chart defaults: `helm/kairos-mcp/values.yaml`
- Published chart: `oci://ghcr.io/squadrules/charts/mcp`
- Operator scripts: `helm/prerequisites/`
- Dev profiles: `helm/.dev/`
- Architecture: [project Wiki](https://github.com/SquadRules/mcp/wiki)
