---
kind: external_dependency
name: Qdrant — primary vector store
slug: qdrant
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### Qdrant
- Role: Primary vector store for the SquadRules MCP server; every CLI backend path (activate, forward, delete, tune, reward, export) is wired through a `QdrantService` instance.
- Integration point: `src/services/qdrant/` (service facade consumed by `src/cli/backend/local-backend.ts`, HTTP routes in `src/http/http-api-*.ts`, and skill-export zip builder).
- Usage model: Qdrant is the production vector index; it is injected into command handlers rather than accessed directly from route handlers.
- Verify exact client configuration against the Qdrant SDK / deployment docs.