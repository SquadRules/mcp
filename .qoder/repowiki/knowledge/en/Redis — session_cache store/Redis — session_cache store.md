---
kind: external_dependency
name: Redis — session/cache store
slug: redis
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### Redis
- Role: Session storage and cache backing for the HTTP server (OIDC state, sessions, general cache).
- Integration points: `src/services/redis.ts` (connection), `src/services/redis-cache.ts` (cache abstraction), OIDC state store under `src/services/oidc-state-store.ts`.
- Usage model: Redis is an optional runtime dependency — the server boots without it only when the relevant features are disabled; verify connection URI/env wiring against the Redis client docs.