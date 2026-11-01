# Memory System Architecture

<cite>
**Referenced Files in This Document**
- [memory.ts](file://src/types/memory.ts)
- [store.ts](file://src/services/memory/store.ts)
- [store-methods.ts](file://src/services/memory/store-methods.ts)
- [store-adapter.ts](file://src/services/memory/store-adapter.ts)
- [service.ts](file://src/services/qdrant/service.ts)
- [memory-store.ts](file://src/services/qdrant/memory-store.ts)
- [memory-retrieval.ts](file://src/services/qdrant/memory-retrieval.ts)
- [memory-updates.ts](file://src/services/qdrant/memory-updates.ts)
- [types.ts](file://src/services/vector-store/types.ts)
- [tenant-context.ts](file://src/utils/tenant-context.ts)
- [space-filter.ts](file://src/utils/space-filter.ts)
- [resolve-space-param.ts](file://src/utils/resolve-space-param.ts)
- [mem-boot.ts](file://src/config/mem-boot.ts)
- [store-init.ts](file://src/services/memory/store-init.ts)
</cite>

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

## Introduction
This document explains the memory system architecture in SquadRules MCP. Memories are persistent knowledge units that can be created, updated, searched, and archived. The system supports semantic search over adapters and artifacts using vector databases (Qdrant as primary, LanceDB as embedded fallback), enforces space-based multi-tenancy to isolate teams or projects, and provides a clear lifecycle from creation through updates to archival. It also documents how human and agent interactions share the same integrity and security boundaries.

## Project Structure
The memory system is implemented across several layers:
- Domain types define memories, adapters, execution traces, and rewards.
- A Qdrant-backed store exposes high-level operations for adapter storage, artifact storage, retrieval, and hybrid search.
- A service layer composes connection, initialization, retrieval, updates, search, and protocol helpers.
- Vector-store abstraction types keep backend-neutral contracts between ports and adapters.
- Tenant context and space filters enforce isolation by user, group, and application spaces.
- Boot configuration controls injection of built-in app-space adapters.

```mermaid
graph TB
Types["Domain Types<br/>Memory, AdapterInfo, ExecutionTrace"] --> StoreAdapter["Store Adapter<br/>storeAdapter(), storeArtifact()"]
StoreAdapter --> StoreMethods["Store Methods<br/>searchMemories(), getMemory()"]
StoreMethods --> QdrantClient["Qdrant Client"]
Service["QdrantService<br/>compose operations"] --> StoreMethods
Service --> Retrieval["Retrieval Helpers<br/>retrieveById(), findFirstStepMemoryUuidBySlug()"]
Service --> Updates["Update/Delete Helpers<br/>updateMemory(), deleteMemory()"]
Tenant["Tenant Context<br/>SpaceContext, getSearchSpaceIds()"] --> StoreMethods
Tenant --> Retrieval
SpaceFilter["Space Filter<br/>buildSpaceFilter()"] --> StoreMethods
SpaceFilter --> Retrieval
Boot["Boot Config<br/>MEM_BOOT_FORCE_INJECT"] --> StoreInit["Store Init<br/>initializeQdrantStore()"]
StoreInit --> QdrantClient
```

**Diagram sources**
- [memory.ts:87-108](file://src/types/memory.ts#L87-L108)
- [store-adapter.ts:43-147](file://src/services/memory/store-adapter.ts#L43-L147)
- [store-methods.ts:94-268](file://src/services/memory/store-methods.ts#L94-L268)
- [service.ts:17-151](file://src/services/qdrant/service.ts#L17-L151)
- [memory-retrieval.ts:25-339](file://src/services/qdrant/memory-retrieval.ts#L25-L339)
- [memory-updates.ts:15-235](file://src/services/qdrant/memory-updates.ts#L15-L235)
- [tenant-context.ts:23-42](file://src/utils/tenant-context.ts#L23-L42)
- [space-filter.ts:14-47](file://src/utils/space-filter.ts#L14-L47)
- [mem-boot.ts:1-21](file://src/config/mem-boot.ts#L1-L21)
- [store-init.ts:172-350](file://src/services/memory/store-init.ts#L172-L350)

**Section sources**
- [memory.ts:87-108](file://src/types/memory.ts#L87-L108)
- [store.ts:29-62](file://src/services/memory/store.ts#L29-L62)
- [service.ts:17-151](file://src/services/qdrant/service.ts#L17-L151)
- [tenant-context.ts:23-42](file://src/utils/tenant-context.ts#L23-L42)
- [space-filter.ts:14-47](file://src/utils/space-filter.ts#L14-L47)
- [mem-boot.ts:1-21](file://src/config/mem-boot.ts#L1-L21)

## Core Components
- Memory domain model: defines the shape of stored knowledge including identifiers, labels, text, tags, content type, optional artifact references, adapter metadata, and inference contracts.
- Qdrant-backed memory store: orchestrates adapter and artifact persistence, retrieval, and hybrid search with caching and tenant scoping.
- Qdrant service: composes connection, initialization, retrieval, updates, search, and protocol helpers; acts as the backend-selected singleton.
- Vector-store types: provide backend-neutral contracts for records, search results, and training-related structures.
- Tenant context and space filter: derive allowed spaces from authentication and enforce read/write isolation.
- Store initialization: ensures collection schema, vector dimensions, BM25 sparse vectors, full-text indexes, and activation search backfill.

Key responsibilities:
- Create and update memories and adapters with semantic embeddings.
- Search memories using dense vectors, title vectors, activation pattern vectors, and BM25.
- Enforce space-based multi-tenancy on reads and writes.
- Provide boot-time repair and injection for built-in app-space adapters.

**Section sources**
- [memory.ts:87-108](file://src/types/memory.ts#L87-L108)
- [store.ts:29-62](file://src/services/memory/store.ts#L29-L62)
- [service.ts:17-151](file://src/services/qdrant/service.ts#L17-L151)
- [types.ts:14-40](file://src/services/vector-store/types.ts#L14-L40)
- [tenant-context.ts:23-42](file://src/utils/tenant-context.ts#L23-L42)
- [space-filter.ts:14-47](file://src/utils/space-filter.ts#L14-L47)
- [store-init.ts:172-350](file://src/services/memory/store-init.ts#L172-L350)

## Architecture Overview
The memory system uses a layered design:
- Application tools and HTTP APIs call into services and stores.
- Services compose connection, retrieval, updates, and search logic.
- Stores implement domain-specific operations such as adapter storage and hybrid search.
- Tenant context and space filters ensure data isolation per team or project.
- Vector database operations are abstracted behind client calls and helper modules.

```mermaid
sequenceDiagram
participant Caller as "Caller"
participant Service as "QdrantService"
participant Store as "MemoryQdrantStore"
participant Methods as "MemoryQdrantStoreMethods"
participant Qdrant as "Qdrant Client"
Caller->>Service : searchMemory(query, limit, domain)
Service->>Store : searchMemories(query, limit, collapse)
Store->>Methods : searchMemories(query, limit, collapse)
Methods->>Methods : generateEmbedding(query)
Methods->>Qdrant : query(collection, prefetch + fusion)
Qdrant-->>Methods : points with scores
Methods-->>Store : {memories, scores}
Store-->>Service : {memories, scores}
Service-->>Caller : {memories, scores}
```

**Diagram sources**
- [service.ts:120-122](file://src/services/qdrant/service.ts#L120-L122)
- [store.ts:151-153](file://src/services/memory/store.ts#L151-L153)
- [store-methods.ts:94-104](file://src/services/memory/store-methods.ts#L94-L104)
- [store-methods.ts:121-260](file://src/services/memory/store-methods.ts#L121-L260)

## Detailed Component Analysis

### Memory Model and Data Structures
Memories encapsulate:
- Stable identifiers and optional space scoping.
- Human-readable label, slug, tags, and text.
- LLM model association and timestamps.
- Optional artifact reference and adapter metadata.
- Optional inference contract definition for deterministic task execution.

Complexity considerations:
- Payload size impacts embedding generation and indexing costs.
- Adapter metadata enables hierarchical traversal and chain resolution.
- Artifact references support skill export layouts and relative paths.

```mermaid
classDiagram
class Memory {
+string memory_uuid
+string space_id
+string label
+string slug
+string[] tags
+string text
+string llm_model_id
+string created_at
+string content_type
+Artifact artifact
+AdapterInfo adapter
+InferenceContractDefinition inference_contract
}
class AdapterInfo {
+string id
+string name
+number layer_index
+number layer_count
+string protocol_version
+string[] activation_patterns
+string reward_signal
+string chain_root
}
class InferenceContractDefinition {
+string type
+boolean required
+Shell shell
+Forward forward
+UserInput user_input
+Comment comment
+Subagent subagent
}
Memory --> AdapterInfo : "has"
Memory --> InferenceContractDefinition : "has"
```

**Diagram sources**
- [memory.ts:3-13](file://src/types/memory.ts#L3-L13)
- [memory.ts:17-46](file://src/types/memory.ts#L17-L46)
- [memory.ts:87-108](file://src/types/memory.ts#L87-L108)

**Section sources**
- [memory.ts:87-108](file://src/types/memory.ts#L87-L108)

### Qdrant Service Composition
The Qdrant service composes:
- Connection management and aliasing.
- Collection initialization and migration.
- Memory storage, retrieval, updates, and deletion.
- Quality metrics and reward propagation.
- Protocol step discovery and listing utilities.
- Search operations delegating to specialized modules.

```mermaid
classDiagram
class QdrantService {
-QdrantConnection conn
+initialize() void
+storeMemory(...) any
+retrieveById(uuid) any
+getMemoryByUUID(uuid) any
+getAdapterLayers(adapterId, extraSpaceIds) any
+findFirstStepMemoryUuidBySlug(slug) any
+findArtifactMemoryUuidBySlug(slug) any
+updateMemoryByUUID(uuid, updates) any
+updateMemory(id, updates) any
+deleteMemory(id) any
+searchMemory(query, limit, domain) any
+createOrUpdateAlias(aliasName) any
+getCollections() any
+dropCollection(name) any
}
```

**Diagram sources**
- [service.ts:17-151](file://src/services/qdrant/service.ts#L17-L151)

**Section sources**
- [service.ts:17-151](file://src/services/qdrant/service.ts#L17-L151)

### Memory Store and Adapter Storage
The memory store coordinates:
- Adapter normalization and parsing.
- Header-based vs default adapter handling.
- Similarity checks to avoid duplicate adapters.
- Artifact attachment to adapters.
- Metrics timing and tenant tagging.

```mermaid
flowchart TD
Start(["storeAdapter(docs, llmModelId, options)"]) --> Normalize["Normalize markdown docs"]
Normalize --> SingleDoc{"Single doc?"}
SingleDoc --> |Yes| ParseFrontmatter["Parse frontmatter and header"]
ParseFrontmatter --> HeaderPath{"Header-based adapter?"}
HeaderPath --> |Yes| BuildHeader["Build header memories"]
BuildHeader --> SlugCandidate["Resolve protocol slug candidate"]
SlugCandidate --> SimilarCheck["Check similar adapter by title"]
SimilarCheck --> StoreHeader["Store header-based adapter"]
HeaderPath --> |No| DefaultPath["Fallback to default path"]
SingleDoc --> |No| DefaultPath
DefaultPath --> ParseStructure["Parse markdown structure"]
ParseStructure --> SimilarCheckDefault["Check similar adapter by title"]
SimilarCheckDefault --> StoreDefault["Store default adapter"]
StoreHeader --> End(["Return Memory[]"])
StoreDefault --> End
```

**Diagram sources**
- [store-adapter.ts:43-147](file://src/services/memory/store-adapter.ts#L43-L147)

**Section sources**
- [store-adapter.ts:43-147](file://src/services/memory/store-adapter.ts#L43-L147)

### Hybrid Semantic Search Pipeline
Hybrid search combines:
- Dense vector similarity on primary, title, and activation pattern vectors.
- BM25 sparse vector scoring via Query API.
- RRF fusion and formula-based boosting for title, activation patterns, label, and tags.
- Space filtering and exclusion of builtin search footer protocols.
- Caching of search results.

```mermaid
flowchart TD
SStart(["searchMemories(query, limit, collapse)"]) --> CacheCheck["Cache result if available"]
CacheCheck --> Embed["Generate embedding for query"]
Embed --> Names["Resolve vector names by dimension"]
Names --> BM25["Tokenize query for BM25"]
BM25 --> Prefetch["Prefetch dense legs + BM25 legs"]
Prefetch --> Fusion["RRF fusion + formula boost"]
Fusion --> Points["Collect points with scores"]
Points --> Filter["Filter zero-score and builtin footer"]
Filter --> Sort["Sort by score then UUID"]
Sort --> Slice["Slice to limit"]
Slice --> Fallback{"Any results?"}
Fallback --> |No| SoftFallback["Use scored entries with neutral score"]
Fallback --> |Yes| Return["Return {memories, scores}"]
SoftFallback --> Return
```

**Diagram sources**
- [store-methods.ts:94-104](file://src/services/memory/store-methods.ts#L94-L104)
- [store-methods.ts:121-260](file://src/services/memory/store-methods.ts#L121-L260)

**Section sources**
- [store-methods.ts:94-104](file://src/services/memory/store-methods.ts#L94-L104)
- [store-methods.ts:121-260](file://src/services/memory/store-methods.ts#L121-L260)

### Space-Based Multi-Tenancy
Multi-tenancy is enforced via:
- SpaceContext derived from JWT claims (user, groups, realm, issuer).
- Allowed space IDs for reads and default write space for writes.
- Search scope narrowing for activate/search parameters.
- Space filter construction to constrain Qdrant queries.
- Resolution helpers for human-oriented space inputs.

```mermaid
flowchart TD
Auth["Auth Claims<br/>sub, groups, realm, iss"] --> Derive["Derive personal and group space IDs"]
Derive --> Context["SpaceContext<br/>allowedSpaceIds, defaultWriteSpaceId"]
Context --> SearchScope["getSearchSpaceIds()<br/>merge app space when needed"]
Context --> WriteScope["defaultWriteSpaceId<br/>for writes"]
SearchScope --> Filter["buildSpaceFilter(allowedSpaceIds)"]
WriteScope --> Filter
Filter --> QdrantQuery["Qdrant must conditions"]
```

**Diagram sources**
- [tenant-context.ts:23-42](file://src/utils/tenant-context.ts#L23-L42)
- [tenant-context.ts:141-150](file://src/utils/tenant-context.ts#L141-L150)
- [space-filter.ts:14-47](file://src/utils/space-filter.ts#L14-L47)
- [resolve-space-param.ts:26-103](file://src/utils/resolve-space-param.ts#L26-L103)

**Section sources**
- [tenant-context.ts:23-42](file://src/utils/tenant-context.ts#L23-L42)
- [tenant-context.ts:141-150](file://src/utils/tenant-context.ts#L141-L150)
- [space-filter.ts:14-47](file://src/utils/space-filter.ts#L14-L47)
- [resolve-space-param.ts:26-103](file://src/utils/resolve-space-param.ts#L26-L103)

### Memory Lifecycle: Creation, Update, Archival
Lifecycle stages:
- Creation: storeAdapter or storeArtifact persists normalized content, computes embeddings, and attaches metadata.
- Update: updateMemory or updateMemoryByUUID merges fields, recomputes embeddings when text changes, and invalidates caches.
- Archival: deleteMemory removes points and invalidates caches; adapter siblings and artifacts remain scoped by space.

```mermaid
sequenceDiagram
participant Caller as "Caller"
participant Service as "QdrantService"
participant Updates as "Update/Delete Helpers"
participant Qdrant as "Qdrant Client"
Caller->>Service : updateMemoryByUUID(uuid, updates)
Service->>Updates : updateMemoryByUUID(conn, uuid, updates)
Updates->>Qdrant : retrieveAccessiblePointById(uuid)
Qdrant-->>Updates : point with payload and vector
Updates->>Updates : merge payload, recompute embedding if text changed
Updates->>Qdrant : sanitizeAndUpsert(point)
Qdrant-->>Updates : success
Updates-->>Service : void
Service-->>Caller : void
Caller->>Service : deleteMemory(id)
Service->>Updates : deleteMemory(conn, id)
Updates->>Qdrant : retrieveById(id)
Qdrant-->>Updates : point
Updates->>Qdrant : delete(points=[id])
Qdrant-->>Updates : success
Updates-->>Service : void
Service-->>Caller : void
```

**Diagram sources**
- [memory-updates.ts:15-96](file://src/services/qdrant/memory-updates.ts#L15-L96)
- [memory-updates.ts:199-235](file://src/services/qdrant/memory-updates.ts#L199-L235)
- [memory-retrieval.ts:72-102](file://src/services/qdrant/memory-retrieval.ts#L72-L102)

**Section sources**
- [memory-updates.ts:15-96](file://src/services/qdrant/memory-updates.ts#L15-L96)
- [memory-updates.ts:199-235](file://src/services/qdrant/memory-updates.ts#L199-L235)

### Relationship Between Memories, Adapters, and Vector Database Layer
- Memories represent individual knowledge points, often grouped as adapter layers.
- Adapters encapsulate structured workflows with metadata, activation patterns, and optional inference contracts.
- Artifacts attach binary or skill resources to adapters.
- The vector database layer stores dense vectors, BM25 sparse vectors, and full-text indexes for hybrid search.
- Initialization ensures correct vector schemas, BM25 configuration, and activation search backfill.

```mermaid
graph TB
Adapter["Adapter Layers<br/>Memory[]"] --> Vectors["Dense Vectors<br/>Primary, Title, Activation Patterns"]
Adapter --> Sparse["BM25 Sparse Vectors"]
Adapter --> TextIndex["Full-Text Indexes<br/>adapter_name_text, label_text, activation_patterns_text, tags_text"]
Artifact["Artifacts<br/>attached to adapter"] --> Vectors
Artifact --> Sparse
```

**Diagram sources**
- [store-init.ts:151-170](file://src/services/memory/store-init.ts#L151-L170)
- [store-init.ts:338-341](file://src/services/memory/store-init.ts#L338-L341)
- [store-methods.ts:121-260](file://src/services/memory/store-methods.ts#L121-L260)

**Section sources**
- [store-init.ts:151-170](file://src/services/memory/store-init.ts#L151-L170)
- [store-init.ts:338-341](file://src/services/memory/store-init.ts#L338-L341)
- [store-methods.ts:121-260](file://src/services/memory/store-methods.ts#L121-L260)

### Human and Agent Interactions with Integrity and Security Boundaries
- Authentication-derived SpaceContext ensures only allowed spaces are readable/writable.
- Reads validate space membership before returning payloads.
- Writes use defaultWriteSpaceId to maintain isolation.
- Cache invalidation prevents stale reads after updates/deletes.
- Boot injection allows operators to repair or retrain built-in app-space adapters safely.

```mermaid
flowchart TD
Request["HTTP/API Request"] --> Auth["Extract auth claims"]
Auth --> Context["Build SpaceContext"]
Context --> Read["Read Path<br/>validate space membership"]
Context --> Write["Write Path<br/>use defaultWriteSpaceId"]
Read --> Cache["Redis cache read/write"]
Write --> Cache
Cache --> DB["Vector DB operations"]
DB --> Response["Response with scoped data"]
```

**Diagram sources**
- [tenant-context.ts:256-303](file://src/utils/tenant-context.ts#L256-L303)
- [memory-retrieval.ts:25-61](file://src/services/qdrant/memory-retrieval.ts#L25-L61)
- [memory-store.ts:56-97](file://src/services/qdrant/memory-store.ts#L56-L97)
- [mem-boot.ts:1-21](file://src/config/mem-boot.ts#L1-L21)

**Section sources**
- [tenant-context.ts:256-303](file://src/utils/tenant-context.ts#L256-L303)
- [memory-retrieval.ts:25-61](file://src/services/qdrant/memory-retrieval.ts#L25-L61)
- [memory-store.ts:56-97](file://src/services/qdrant/memory-store.ts#L56-L97)
- [mem-boot.ts:1-21](file://src/config/mem-boot.ts#L1-L21)

## Dependency Analysis
Component dependencies:
- QdrantService depends on connection, initialization, retrieval, updates, quality, resources, search, protocol, listing, and reward propagation modules.
- MemoryQdrantStore depends on QdrantClient, code block processing, store methods, and store adapter.
- Store methods depend on embedding service, BM25 tokenizer, Redis cache, and tenant context.
- Tenant context depends on config constants and space parameter resolution.
- Space filter is used by both store methods and retrieval helpers.

```mermaid
graph TB
Service["QdrantService"] --> Conn["QdrantConnection"]
Service --> Init["Initialization"]
Service --> Ret["Retrieval"]
Service --> Upd["Updates"]
Service --> Qry["Search"]
Store["MemoryQdrantStore"] --> Methods["MemoryQdrantStoreMethods"]
Store --> Adapter["MemoryQdrantStoreAdapter"]
Methods --> Embed["EmbeddingService"]
Methods --> BM25["BM25Tokenizer"]
Methods --> Cache["RedisCacheService"]
Methods --> Tenant["TenantContext"]
Ret --> Tenant
Ret --> SpaceFilter["SpaceFilter"]
Methods --> SpaceFilter
```

**Diagram sources**
- [service.ts:1-151](file://src/services/qdrant/service.ts#L1-L151)
- [store.ts:29-62](file://src/services/memory/store.ts#L29-L62)
- [store-methods.ts:25-36](file://src/services/memory/store-methods.ts#L25-L36)
- [tenant-context.ts:23-42](file://src/utils/tenant-context.ts#L23-L42)
- [space-filter.ts:14-47](file://src/utils/space-filter.ts#L14-L47)

**Section sources**
- [service.ts:1-151](file://src/services/qdrant/service.ts#L1-L151)
- [store.ts:29-62](file://src/services/memory/store.ts#L29-L62)
- [store-methods.ts:25-36](file://src/services/memory/store-methods.ts#L25-L36)
- [tenant-context.ts:23-42](file://src/utils/tenant-context.ts#L23-L42)
- [space-filter.ts:14-47](file://src/utils/space-filter.ts#L14-L47)

## Performance Considerations
- Hybrid search leverages pre-fetching multiple dense legs and BM25 legs, then fuses results with RRF to reduce latency while improving recall.
- Formula-based boosting prioritizes title and activation pattern matches without moving ranking off Qdrant.
- Vector dimension naming avoids repeated lookups and aligns with embedding service outputs.
- Cache usage reduces redundant retrievals and search computations.
- Initialization migrates vector schemas and adds BM25 configuration efficiently, falling back to recreation when server capabilities are limited.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Health check failures: verify Qdrant URL, API key, and collection alias resolution.
- BM25 migration errors: check server version support for sparse_vectors; review temp collection status if recreation path was used.
- Full-text index creation failures: confirm field names and tokenizers; retry idempotently.
- Space access denied: ensure SpaceContext includes the target space_id; validate allowlist and personal/group derivation.
- Stale cache after updates: confirm cache invalidation calls executed; inspect Redis connectivity.

Operational tips:
- Use MEM_BOOT_FORCE_INJECT to force delete-and-retrain of shipped adapters during boot for structural repair.
- Prefer explicit adapter URIs when slug ambiguity is logged to avoid non-deterministic selection.

**Section sources**
- [store.ts:68-130](file://src/services/memory/store.ts#L68-L130)
- [store-init.ts:36-125](file://src/services/memory/store-init.ts#L36-L125)
- [store-init.ts:158-170](file://src/services/memory/store-init.ts#L158-L170)
- [memory-retrieval.ts:228-300](file://src/services/qdrant/memory-retrieval.ts#L228-L300)
- [mem-boot.ts:1-21](file://src/config/mem-boot.ts#L1-L21)

## Conclusion
SquadRules MCP’s memory system models persistent knowledge as memories and adapters, backed by vector databases for semantic search. Space-based multi-tenancy isolates teams and projects, while robust initialization and migration ensure reliable indexing. The lifecycle from creation through updates to archival is supported by clear service abstractions and strict cache invalidation. Human and agent interactions share consistent integrity and security boundaries, enabling safe, scalable operation across diverse workloads.

[No sources needed since this section summarizes without analyzing specific files]