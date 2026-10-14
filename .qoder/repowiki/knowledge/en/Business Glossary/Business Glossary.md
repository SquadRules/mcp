---
kind: business_term
name: Business Glossary
category: business_term
scope:
    - '**'
---

### MCP
- Definition：Model Context Protocol — the protocol surface exposed by the SquadRules server for AI agents to invoke tools, activate workflows, and exchange artifacts.
- Aliases：model context protocol

### activate → forward → reward
- Definition：The core agent workflow triad: `activate` initializes a run and resolves adapters, `forward` executes the adapter chain, and `reward` evaluates outcomes back into the vector store.
- Aliases：core workflow、workflow triad

### adapter slug
- Definition：The stable identifier for an adapter; renamed slugs keep redirect tombstones so deeply referenced adapters remain resolvable after rename.
- Aliases：slug

### proof splitting
- Definition：During the critic loop, proofs are partitioned by reversibility cost and batched together before being re-evaluated.
- Aliases：proof-batching

### boot injection
- Definition：A two-layer mechanism that injects pre-built adapter assets into the runtime at boot time; reuse is decided by semver, not content hash.
- Aliases：boot-injection reader

### CI integration lanes
- Definition：Exactly two parallel CI test lanes — cluster and single-node — both running the full suite and both acting as gates for merging.
- Aliases：integration lanes、two lanes

### SINGLE lane
- Definition：The single-node CI lane that runs the stdio integration test against a cached fastembed model to reduce CI duration.
- Aliases：single lane

### ADR
- Definition：Architecture Decision Record — a short, numbered record (one decision per file) capturing context, decision, consequences, and evidence; superseded by a new ADR rather than rewritten.
- Aliases：architecture decision record

### documentation-authority
- Definition：The team rule (stored under `.qoder/rules/documentation-authority.md`) that assigns each fact to exactly one home: code-derivable facts go to the generated Wiki, irreducible records stay in `docs/`.
- Aliases：doc authority、documentation governance
