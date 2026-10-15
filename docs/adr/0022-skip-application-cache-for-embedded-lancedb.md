# ADR 0022: Skip Application-Level Cache for Embedded LanceDB

## Status

Proposed

## Context

SquadRules MCP supports two deployment modes:

- **CLUSTER**: Qdrant + Redis, multiple HTTP instances
- **SINGLE**: Embedded LanceDB, no Redis, multiple processes on one laptop

The application-level cache (`RedisCacheService`) was designed for Qdrant's network latency. In SINGLE mode with LanceDB:

- LanceDB uses memory-mapped files with fast local reads (no network hop)
- Each process maintains its own in-memory cache via `MemoryStore`
- Cross-process cache invalidation requires Redis pub/sub (absent in SINGLE mode)
- Writes in one process cause stale reads in others until restart

This was documented in the TODO at `src/services/memory-store.ts:7-10`:
> "when several MCP processes share one embedded LanceDB directory without Redis, each keeps its own cache and publish() is a no-op, so a tune/update/delete in one process is not seen by another until it restarts"

## Decision

Skip search result and memory resource caching when `!isRedisConfigured` (i.e., when using embedded LanceDB). Every process reads directly from LanceDB with strong consistency (`readConsistencyInterval: 0`).

Nonce and proof-of-work values continue to use the key-value store (Redis or in-memory) for transient adapter flow state.

## Rationale

1. **Performance**: LanceDB reads are fast enough for laptop-scale workloads (~10-50ms vs ~5ms cache hit)
2. **Consistency**: Direct reads provide strong consistency across processes
3. **Simplicity**: Eliminates cache invalidation complexity
4. **Memory**: Reduces footprint by ~50-200MB

## Implementation

Added a `shouldCache` getter to `RedisCacheService` that returns `isRedisConfigured`. All cache methods (`getSearchResult`, `setSearchResult`, `getMemoryResource`, `setMemoryResource`, `invalidateAfterUpdate`, etc.) return early when `!shouldCache`.

This means:

- In SINGLE mode (no Redis): cache methods are no-ops, all reads go directly to LanceDB
- In CLUSTER mode (Redis available): cache methods work as before, providing performance optimization for network-based Qdrant

## Consequences

### Positive

- Eliminates cross-process staleness in SINGLE mode
- Reduces memory footprint (~50-200MB)
- Simplifies architecture (no cache invalidation coordination needed)
- Strong consistency across processes via LanceDB's `readConsistencyInterval: 0`

### Negative

- Slightly higher latency for repeated queries (~10-50ms vs ~5ms cache hit)
- Acceptable trade-off for consistency in laptop-scale workloads

## Related

- Issue: [#95](https://github.com/SquadRules/mcp/issues/95)
- Spec: `mcp/.local/specs/embedded-vector-store-multi-process-concurrency.md`
- Spec: `mcp/.local/specs/lancedb-default-issue-2.md` (memory cache coherence section)
- ADR 0021: Embedding provider auto-resolution and store width binding
