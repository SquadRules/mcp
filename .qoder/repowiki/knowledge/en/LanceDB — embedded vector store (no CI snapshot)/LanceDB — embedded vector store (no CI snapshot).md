---
kind: external_dependency
name: LanceDB — embedded vector store (no CI snapshot)
slug: lancedb
category: external_dependency
category_hints:
    - migration_status
scope:
    - '**'
---

### LanceDB
- Role: Embedded vector store used alongside Qdrant; explicitly excluded from CI snapshot/export per ADR 0003 (`0003-no-lancedb-store-snapshot`).
- Integration point: `src/embed-docs/mem/` (embedded memory layer); not part of the CLI backend paths that go through `QdrantService`.
- Migration status: retained as embedded fallback but deliberately not snapshotted in CI — treat any change to its persistence format as requiring a new ADR before enabling snapshots.