<!-- squadrules-compat-surface: references the docker-compose project/service name kairos-mcp retained for backward compatibility -->
# Docker Compose — full stack (advanced)

The repository includes an optional `fullstack` Compose profile that adds
supporting services alongside the SquadRules application and Qdrant. Use it when
you need a broader local environment or want to model a production-like
topology without Kubernetes.

For Kubernetes production deployments, use the **[Helm chart](helm.md)**
instead.

---

## When to use this profile

Choose this profile only when the default
[simple stack](docker-compose-simple.md) is no longer enough.

Typical reasons:

- Validating a broader service topology locally
- Running additional stateful services (Redis, Postgres) alongside the app
- Testing a self-managed authentication architecture (Keycloak)

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **Docker Engine** + **Docker Compose v2** | Same as simple stack |
| **`.env`** file | Embedding variables + any additional service secrets |
| **[Embedding backend](prerequisites.md#embedding-backend)** | Same selection as simple stack |

---

## Environment file

Create `.env` next to `compose.yaml`. The required variables depend on which
services you enable and how you wire authentication, storage, and networking.

At minimum, keep the embedding variables aligned with your chosen
[embedding backend](prerequisites.md#embedding-backend). For the rest of the
profile, use the repository `compose.yaml`, your secret management approach,
and your infrastructure requirements as the source of truth.

---

## Start

```sh
docker compose -p kairos-mcp --profile fullstack up -d
```

After the stack is running, confirm the application health endpoint:

```sh
curl -sS "http://localhost:${PORT:-3000}/health"
```

---

## Access

Use the [CLI](../CLI.md) as the primary interface after the application is
healthy. Add MCP only for hosts that require a streamable HTTP endpoint.

---

## Services (fullstack profile)

| Service | Purpose |
|---------|---------|
| `app-prod` | SquadRules application |
| `qdrant` | Vector database |
| `redis` | State / caching (optional) |
| `keycloak` | Identity provider (optional) |
| `postgres` | Keycloak backing store (optional) |

---

## Related

| Resource | Use for |
|----------|---------|
| [Install index](README.md) | Overview of all installation paths |
| [Simple stack](docker-compose-simple.md) | Recommended local path (app + Qdrant only) |
| [Helm chart](helm.md) | Kubernetes production deployment |
| [CLI](../CLI.md) | Primary interface for operations |
| [`compose.yaml`](https://github.com/SquadRules/mcp/blob/main/compose.yaml) | Source Compose file |
