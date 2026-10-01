# Docker Compose Development Environment

<cite>
**Referenced Files in This Document**
- [compose.yaml](file://compose.yaml)
- [Dockerfile.dev](file://Dockerfile.dev)
- [scripts/env/create-env.sh](file://scripts/env/create-env.sh)
- [scripts/deploy-run-env.sh](file://scripts/deploy-run-env.sh)
- [scripts/ci-wait-for-infra.sh](file://scripts/ci-wait-for-infra.sh)
- [scripts/qdrant-binary.sh](file://scripts/qdrant-binary.sh)
- [scripts/keycloak/import/kairos-dev-realm.json](file://scripts/keycloak/import/kairos-dev-realm.json)
- [helm/kairos-mcp/files/kairos-realm.json](file://helm/kairos-mcp/files/kairos-realm.json)
- [src/config.ts](file://src/config.ts)
- [src/http/http-server-config.ts](file://src/http/http-server-config.ts)
- [src/services/redis.ts](file://src/services/redis.ts)
- [src/services/qdrant/connection.ts](file://src/services/qdrant/connection.ts)
- [tests/scripts/compose.test.mjs](file://tests/scripts/compose.test.mjs)
</cite>

## Update Summary
**Changes Made**
- Updated PostgreSQL configuration to version 18.3 with Alpine 3.22 base image
- Modified PostgreSQL volume mount path from `/var/lib/postgresql/data` to `/var/lib/postgresql` for PostgreSQL 18 compatibility
- Added validation test for PostgreSQL 18 parent-directory volume mount pattern
- Updated troubleshooting section with PostgreSQL 18-specific migration guidance

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document explains how to run the Kairos MCP development environment using Docker Compose. It covers the full service stack (PostgreSQL, Redis, Qdrant vector database, and Keycloak), environment configuration via .env files, database initialization, Keycloak realm setup with default users and roles, container networking, volume management, port mappings, development-specific features (hot reload, debugging ports, dev dependencies), and common issues such as port conflicts, memory limits, and network connectivity problems. It also provides commands for starting, stopping, and managing the environment.

**Updated** The development environment now uses PostgreSQL 18.3 with updated volume mount paths for compatibility. The PostgreSQL data directory structure has changed to support major-version-specific subdirectories, requiring a parent-directory volume mount approach.

## Project Structure
The repository includes:
- A top-level Docker Compose file that defines the local development services.
- Scripts to generate a .env file and bootstrap runtime configuration.
- Keycloak realm import JSONs for development and production.
- Application code that reads environment variables to configure services at runtime.
- Validation tests for infrastructure configuration including PostgreSQL 18 compatibility.

```mermaid
graph TB
subgraph "Compose Services"
APP["Kairos App"]
PG["PostgreSQL 18.3"]
REDIS["Redis"]
QDRANT["Qdrant"]
KC["Keycloak"]
end
subgraph "Volumes"
VPG["pg_data (/var/lib/postgresql)"]
VQ["qdrant_data"]
VKC["keycloak_data"]
end
subgraph "Networking"
NET["kairos_dev_net"]
end
APP --> PG
APP --> REDIS
APP --> QDRANT
APP --> KC
PG --- VPG
QDRANT --- VQ
KC --- VKC
APP -.-> NET
PG -.-> NET
REDIS -.-> NET
QDRANT -.-> NET
KC -.-> NET
```

[No sources needed since this diagram shows conceptual workflow, not actual code structure]

## Core Components
- PostgreSQL 18.3: Relational store for application data with updated data directory structure.
- Redis: Cache and pub/sub backend.
- Qdrant: Vector database for embeddings and semantic search.
- Keycloak: Identity provider for OIDC-based authentication.
- Kairos App: The main application container built from the development image.

Environment-driven configuration is central:
- Database URLs and credentials are provided via environment variables.
- Redis connection URL is configured via environment variables.
- Qdrant host and port are configured via environment variables.
- Keycloak endpoints and client settings are configured via environment variables.

Development images include hot reload and debugging support.

**Section sources**
- [compose.yaml:83-106](file://compose.yaml#L83-L106)
- [Dockerfile.dev:1-200](file://Dockerfile.dev#L1-L200)
- [src/config.ts:1-200](file://src/config.ts#L1-L200)
- [src/http/http-server-config.ts:1-200](file://src/http/http-server-config.ts#L1-L200)
- [src/services/redis.ts:1-200](file://src/services/redis.ts#L1-L200)
- [src/services/qdrant/connection.ts:1-200](file://src/services/qdrant/connection.ts#L1-L200)

## Architecture Overview
The development stack runs locally inside Docker Compose. The app connects to PostgreSQL 18.3, Redis, Qdrant, and Keycloak over an internal Docker network. Persistent volumes keep data across restarts with updated PostgreSQL 18-compatible volume mounts. Port mappings expose UI and API endpoints on localhost.

```mermaid
graph TB
Client["Browser / CLI"]
APP["Kairos App<br/>HTTP + MCP"]
PG["PostgreSQL 18.3<br/>/var/lib/postgresql"]
REDIS["Redis"]
QDRANT["Qdrant"]
KC["Keycloak"]
Client --> APP
APP --> PG
APP --> REDIS
APP --> QDRANT
APP --> KC
```

[No sources needed since this diagram shows conceptual workflow, not actual code structure]

## Detailed Component Analysis

### Service Stack and Networking
- Services:
  - PostgreSQL 18.3: Exposed internally; persistent volume mounted to parent directory `/var/lib/postgresql`.
  - Redis: Exposed internally; persistent volume mounted.
  - Qdrant: Exposed internally; persistent volume mounted.
  - Keycloak: Exposed internally; persistent volume mounted.
  - Kairos App: Exposes HTTP ports to localhost for development.
- Networking:
  - All services share a custom bridge network for stable DNS names.
  - The app uses service names (e.g., postgres, redis, qdrant, keycloak) to connect.
- Ports:
  - App HTTP port mapped to localhost for browser access.
  - Optional debug ports exposed for Node.js debugging.

```mermaid
sequenceDiagram
participant Dev as "Developer"
participant Compose as "Docker Compose"
participant App as "Kairos App"
participant PG as "PostgreSQL 18.3"
participant R as "Redis"
participant Q as "Qdrant"
participant K as "Keycloak"
Dev->>Compose : docker compose up
Compose-->>Dev : Services started
App->>PG : Connect using DB_URL
App->>R : Connect using REDIS_URL
App->>Q : Connect using QDRANT_HOST/QDRANT_PORT
App->>K : Initialize OIDC client using KEYCLOAK_*
Dev->>App : Open http : //localhost : <APP_HTTP_PORT>
```

**Diagram sources**
- [compose.yaml:83-106](file://compose.yaml#L83-L106)
- [src/config.ts:1-200](file://src/config.ts#L1-L200)
- [src/http/http-server-config.ts:1-200](file://src/http/http-server-config.ts#L1-L200)
- [src/services/redis.ts:1-200](file://src/services/redis.ts#L1-L200)
- [src/services/qdrant/connection.ts:1-200](file://src/services/qdrant/connection.ts#L1-L200)

### Environment Variables and .env Configuration
- Use the provided script to scaffold a .env file with defaults and comments.
- Required variables include:
  - Database URL or DSN components for PostgreSQL.
  - Redis URL for cache and pub/sub.
  - Qdrant host and port for vector operations.
  - Keycloak realm, client ID, client secret, issuer URL, and redirect URI.
  - Application HTTP port and base URL.
- Runtime configuration loader reads these variables at startup.

Steps:
1. Generate a .env file using the helper script.
2. Review and adjust values for your local setup.
3. Start services; the app will read .env automatically if configured by Compose.

**Section sources**
- [scripts/env/create-env.sh:1-200](file://scripts/env/create-env.sh#L1-L200)
- [scripts/deploy-run-env.sh:1-200](file://scripts/deploy-run-env.sh#L1-L200)
- [src/config.ts:1-200](file://src/config.ts#L1-L200)
- [src/http/http-server-config.ts:1-200](file://src/http/http-server-config.ts#L1-L200)

### Database Initialization
- PostgreSQL 18.3 initialization uses updated data directory structure.
- Ensure the database user and schema exist before starting the app.
- For local development, you may seed initial data after first boot.

**Updated** PostgreSQL 18+ requires mounting to the parent directory `/var/lib/postgresql` instead of the specific data subdirectory. The container automatically manages version-specific subdirectories within this parent path.

Recommendations:
- Create a dedicated database and user matching your .env configuration.
- Run migrations or seed scripts once after the first successful start.
- When upgrading from older PostgreSQL versions, ensure proper data migration to the new directory structure.

**Section sources**
- [compose.yaml:83-106](file://compose.yaml#L83-L106)
- [scripts/deploy-run-env.sh:1-200](file://scripts/deploy-run-env.sh#L1-L200)

### Keycloak Realm Setup and Default Users/Roles
- Import a development realm JSON into Keycloak during first boot.
- The realm JSON contains clients, roles, and example users suitable for development.
- Configure the app's OIDC settings to match the imported realm and client.

Steps:
1. Mount the realm JSON into Keycloak and enable auto-import on startup.
2. Verify the realm exists and the client is configured.
3. Update .env with the correct realm, client ID, client secret, and issuer URL.
4. Test login flow through the app's OIDC redirect.

```mermaid
flowchart TD
Start(["Start Keycloak"]) --> ImportRealm["Import kairos-dev-realm.json"]
ImportRealm --> CreateClient["Create OIDC Client"]
CreateClient --> CreateUsers["Create Demo Users"]
CreateUsers --> CreateRoles["Create Roles"]
CreateRoles --> Ready(["Keycloak Ready"])
```

**Diagram sources**
- [scripts/keycloak/import/kairos-dev-realm.json:1-200](file://scripts/keycloak/import/kairos-dev-realm.json#L1-L200)
- [helm/kairos-mcp/files/kairos-realm.json:1-200](file://helm/kairos-mcp/files/kairos-realm.json#L1-L200)
- [compose.yaml:108-138](file://compose.yaml#L108-L138)

### Container Networking and Volume Management
- Networking:
  - Custom bridge network ensures stable service discovery by name.
  - Avoid host networking unless required for specific tooling.
- Volumes:
  - PostgreSQL 18.3 data persisted under named volume mounted to `/var/lib/postgresql`.
  - Qdrant data persisted under a named volume.
  - Keycloak data persisted under a named volume.
  - Redis data optionally persisted under a named volume.
- Port Mappings:
  - Map the app HTTP port to localhost for development.
  - Optionally map debug ports for remote debugging.

**Updated** PostgreSQL 18+ uses a parent-directory volume mount pattern where the container manages version-specific subdirectories internally. This change improves data organization and supports multiple PostgreSQL major versions coexisting.

Best practices:
- Keep internal ports consistent between Compose and environment variables.
- Use named volumes to avoid accidental data loss.
- For PostgreSQL 18+, always mount to the parent directory `/var/lib/postgresql`, not the data subdirectory.

### Development-Specific Configurations
- Hot Reload:
  - The development image mounts source directories and triggers rebuilds on changes.
  - Use the dev server mode to watch for file changes.
- Debugging:
  - Expose Node.js inspector port for IDE debugging.
  - Attach debugger to the running container.
- Dev Dependencies:
  - The development image installs dev-only packages.
  - Useful for running tests and linting inside the container.

Tips:
- Leverage the simplified development workflow without complex DevContainer configurations.
- Use the provided scripts to validate environment readiness.
- Run PostgreSQL 18 compatibility tests to ensure proper configuration.

**Section sources**
- [Dockerfile.dev:1-200](file://Dockerfile.dev#L1-L200)

### Application Integration Points
- PostgreSQL 18.3:
  - Connection string configured via environment variable.
  - Used for relational data storage with updated data directory structure.
- Redis:
  - Connection URL configured via environment variable.
  - Used for caching and pub/sub.
- Qdrant:
  - Host and port configured via environment variables.
  - Used for vector similarity search.
- Keycloak:
  - OIDC issuer, client ID, client secret, and redirect URI configured via environment variables.
  - Used for authentication and authorization.

```mermaid
classDiagram
class AppConfig {
+dbUrl
+redisUrl
+qdrantHost
+qdrantPort
+keycloakIssuer
+keycloakClientId
+keycloakClientSecret
+httpPort
}
class RedisService {
+connect(url)
+get(key)
+set(key, value)
}
class QdrantConnection {
+connect(host, port)
+search(query)
}
class HttpServerConfig {
+port
+baseUrl
+oidcSettings
}
AppConfig --> RedisService : "uses"
AppConfig --> QdrantConnection : "uses"
HttpServerConfig --> AppConfig : "reads"
```

**Diagram sources**
- [src/config.ts:1-200](file://src/config.ts#L1-L200)
- [src/services/redis.ts:1-200](file://src/services/redis.ts#L1-L200)
- [src/services/qdrant/connection.ts:1-200](file://src/services/qdrant/connection.ts#L1-L200)
- [src/http/http-server-config.ts:1-200](file://src/http/http-server-config.ts#L1-L200)

**Section sources**
- [src/config.ts:1-200](file://src/config.ts#L1-L200)
- [src/services/redis.ts:1-200](file://src/services/redis.ts#L1-L200)
- [src/services/qdrant/connection.ts:1-200](file://src/services/qdrant/connection.ts#L1-L200)
- [src/http/http-server-config.ts:1-200](file://src/http/http-server-config.ts#L1-L200)

## Dependency Analysis
The application depends on external services defined in Compose. The following diagram maps runtime dependencies and their configuration points.

```mermaid
graph LR
APP["Kairos App"]
PG["PostgreSQL 18.3"]
REDIS["Redis"]
QDRANT["Qdrant"]
KC["Keycloak"]
APP --> |DB_URL| PG
APP --> |REDIS_URL| REDIS
APP --> |QDRANT_HOST/QDRANT_PORT| QDRANT
APP --> |KEYCLOAK_*| KC
```

**Diagram sources**
- [compose.yaml:83-106](file://compose.yaml#L83-L106)
- [src/config.ts:1-200](file://src/config.ts#L1-L200)
- [src/services/redis.ts:1-200](file://src/services/redis.ts#L1-L200)
- [src/services/qdrant/connection.ts:1-200](file://src/services/qdrant/connection.ts#L1-L200)

**Section sources**
- [compose.yaml:83-106](file://compose.yaml#L83-L106)
- [src/config.ts:1-200](file://src/config.ts#L1-L200)

## Performance Considerations
- Memory Limits:
  - Set appropriate memory limits for containers to prevent OOM kills.
  - Tune Qdrant heap size if performing large vector operations.
- CPU Limits:
  - Allocate sufficient CPU shares for concurrent workloads.
- Network Latency:
  - Keep services on the same Docker network to minimize latency.
- Caching:
  - Enable Redis-backed caches where applicable to reduce database load.
- Persistence:
  - Use SSD-backed volumes for databases to improve I/O performance.
- PostgreSQL 18 Optimizations:
  - The new parent-directory volume mount pattern improves data organization and allows better version management.
  - Monitor disk usage as PostgreSQL 18 may create additional version-specific subdirectories.

## Troubleshooting Guide
Common issues and resolutions:
- Port Conflicts:
  - If the app HTTP port is already in use, change the mapping in Compose or set a different port in .env.
  - Check for other processes listening on the same port.
- Memory Limits:
  - Increase container memory limits if services crash due to insufficient memory.
  - Monitor logs for out-of-memory errors.
- Network Connectivity:
  - Ensure all services are on the same network and reachable by service name.
  - Validate environment variables for correct hostnames and ports.
- Keycloak Login Failures:
  - Confirm realm and client configuration matches .env settings.
  - Verify redirect URIs and CORS settings in Keycloak.
- Database Initialization:
  - Ensure the database exists and credentials are correct.
  - Run migrations or seed scripts if the app fails to find expected tables.
- **PostgreSQL 18 Migration Issues**:
  - If upgrading from older PostgreSQL versions, ensure data is properly migrated to the new directory structure.
  - The volume must be mounted to `/var/lib/postgresql` (parent directory), not `/var/lib/postgresql/data`.
  - Clear existing PostgreSQL data volumes when migrating to ensure clean initialization with PostgreSQL 18.

Useful commands:
- Start the environment: docker compose up
- Stop the environment: docker compose down
- View logs: docker compose logs -f <service>
- Rebuild dev image: docker compose build --no-cache
- Execute a one-off command: docker compose run --rm app <command>
- **Validate PostgreSQL 18 configuration**: npm test tests/scripts/compose.test.mjs

**Section sources**
- [scripts/ci-wait-for-infra.sh:1-200](file://scripts/ci-wait-for-infra.sh#L1-L200)
- [scripts/qdrant-binary.sh:1-200](file://scripts/qdrant-binary.sh#L1-L200)
- [compose.yaml:83-106](file://compose.yaml#L83-L106)
- [tests/scripts/compose.test.mjs:6-13](file://tests/scripts/compose.test.mjs#L6-L13)

## Conclusion
The Docker Compose development environment provides a complete, reproducible stack for Kairos MCP with PostgreSQL 18.3 compatibility. By configuring environment variables, initializing the database with the updated volume mount structure, importing the Keycloak realm, and leveraging development features like hot reload and debugging, you can efficiently develop and test the application locally. The PostgreSQL 18 upgrade brings improved data organization with parent-directory volume mounts while maintaining essential Docker Compose functionality for infrastructure services. Follow the troubleshooting guide to resolve common issues and ensure smooth operation with the updated PostgreSQL configuration.

## Appendices

### Quick Start Commands
- Generate .env: run the environment creation script.
- Start services: docker compose up
- Access UI: open http://localhost:<APP_HTTP_PORT>
- Stop services: docker compose down
- **Validate PostgreSQL 18 setup**: npm test tests/scripts/compose.test.mjs

**Section sources**
- [scripts/env/create-env.sh:1-200](file://scripts/env/create-env.sh#L1-L200)
- [compose.yaml:83-106](file://compose.yaml#L83-L106)
- [tests/scripts/compose.test.mjs:6-13](file://tests/scripts/compose.test.mjs#L6-L13)

### PostgreSQL 18 Migration Notes
**Critical Changes**:
- Image updated to `postgres:18.3-alpine3.22`
- Volume mount changed from `/var/lib/postgresql/data` to `/var/lib/postgresql`
- Container now manages version-specific subdirectories internally

**Migration Steps**:
1. Backup existing PostgreSQL data if needed
2. Remove or rename existing PostgreSQL data volume
3. Start fresh with PostgreSQL 18.3
4. Run database migrations to initialize the new schema

**Validation**:
- The test suite validates PostgreSQL 18 compatibility
- Parent-directory volume mount pattern is enforced
- Version-specific subdirectories are managed automatically

**Section sources**
- [compose.yaml:87-96](file://compose.yaml#L87-L96)
- [tests/scripts/compose.test.mjs:6-13](file://tests/scripts/compose.test.mjs#L6-L13)