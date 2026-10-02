# LanceDB default storage: implementation plan for issue 2

Status: planned; no runtime implementation in the initial draft PR.
Issue: [SquadRules/mcp#2](https://github.com/SquadRules/mcp/issues/2).
Source baseline: `47419dad4b73d16ac190703896e1d2ea330d9e9c` on `main`.
Recheck affected code when implementation starts; this is a future-change spec,
not a replacement for the generated architecture documentation.

## Outcome and scope

A new local user runs `npx -y @squadrules/mcp serve` without provisioning
Qdrant, Docker, Homebrew, Redis, or a vector database account. Adapters,
artifacts, searchable vectors, and execution traces persist across restarts.
Existing embedding-provider requirements still apply: embedded storage does
not make OpenAI embeddings free, offline, or credential-free.

Qdrant remains supported for existing and shared deployments. Preserve public
MCP contracts, identifiers, space authorization, adapter execution semantics,
and existing Qdrant data. Do not combine this work with further rebranding,
an embedding-provider rewrite, automatic Qdrant-to-LanceDB migration, or a
distributed LanceDB service. Keep the draft open through implementation;
merging the plan alone does not resolve the issue.

## Source map and traps to address

| Area | Inspect first | Required treatment |
| --- | --- | --- |
| Configuration | `src/config.ts`, `src/config/env-alias.ts` | `getQdrantUrl()` currently requires a URL. Resolve backend before backend-specific validation. |
| Startup and injection | `src/index.ts`, `src/server.ts`, `src/bootstrap.ts` | Replace unconditional Qdrant construction, waits, snapshots, diagnostics, and concrete tool dependency types. |
| Adapter storage | `src/services/memory/store.ts`, `store-adapter.ts`, `store-artifact.ts`, handlers and helpers in that directory | Share validation, IDs, code-block processing, and adapter construction; replace persistence boundaries. |
| Read/search implementation | `src/services/memory/store-methods.ts`, `store-title-similarity-search.ts` | Preserve primary, title, activation-pattern, lexical, and reward signals, filters, grouping, and tie ordering. |
| Second storage facade | `src/services/qdrant/service.ts` and sibling modules | Inventory every operation and caller; replacing only `MemoryQdrantStore` is insufficient. |
| Execution history | `src/services/execution-trace-store.ts` | Replace its separate eager Qdrant connection and persist traces with the selected backend. |
| Direct access | `src/resources/mem-resources-boot.ts`, `mem-uuid-mapper.ts`; tools `search.ts`, `spaces.ts`, `artifact-catalog.ts`, `skill-export/enumerate-space-adapters.ts` | Remove `getQdrantAccess()` from backend-neutral execution paths. |
| Other callers | `src/tools/`, `src/services/adapter-navigation.ts`, `reward-metrics.ts`, `stats/`, HTTP handlers | Find imports of `qdrantService`, `QdrantService`, and direct client access; migrate all reachable local paths. |
| Cache | `src/services/memory-store.ts`, `key-value-store-factory.ts` | This `MemoryStore` is the existing Redis substitute, not vector storage. Retain it. |
| Distribution | `package.json`, lockfile, `scripts/ci-test-tgz-install.mjs`, `.github/workflows/`, `Dockerfile*` | Test native dependencies in the actual tarball and supported runtime platforms. |

Repeat the inventory with `rg` at implementation time. Include health/readiness,
snapshot endpoints, statistics, boot resources, CLI commands, and shutdown.
No module import on the LanceDB path may construct a Qdrant connection or
require `QDRANT_URL`. Avoid casting LanceDB to `QdrantClient` or implementing
a pretend Qdrant REST API.

## Decisions the implementation must preserve

### Backend selection and compatibility

Introduce `SQUADRULES_VECTOR_STORE=lancedb|qdrant` and
`SQUADRULES_DATA_DIR` as optional configuration, using the existing config
parsing conventions. These are proposed new keys, not currently implemented.

| Configuration | Result |
| --- | --- |
| Explicit `qdrant` | Qdrant; validate its configuration and fail clearly on missing URL or connection failure. |
| Explicit `lancedb` | LanceDB; do not connect to Qdrant even if old Qdrant variables remain set. Report the selected backend without credentials. |
| No selector, nonempty explicitly configured `QDRANT_URL` | Qdrant, preserving existing installations. |
| No selector or Qdrant URL | LanceDB. |
| Unknown selector or partial Qdrant configuration without URL | Actionable configuration error; do not silently open a different database. |

Distinguish user-provided Qdrant settings from defaults inserted by scripts.
Audit templates and launchers so local startup does not synthesize a Qdrant
URL. Preserve explicit Qdrant selection in Compose and existing CI profiles.
An outage must never cause automatic fallback to an empty local store.
Document the upgrade case for users whose launcher previously supplied a
localhost URL implicitly: retain that URL or select Qdrant explicitly.

The default local directory is stable per OS user, independent of current
working directory and npm's cache: macOS `~/Library/Application Support/SquadRules`,
Linux `${XDG_DATA_HOME:-~/.local/share}/squadrules`, Windows
`%LOCALAPPDATA%/SquadRules`. Put database files in a `lancedb` child directory.
Resolve an explicit relative data directory against the caller's working
directory before `serve.ts` changes the child's working directory to the
package root. Use restrictive permissions where supported. Never put the
database in `node_modules`, a temporary folder, or the client artifact directory.

### Storage contract and consistency

Extract narrow typed interfaces for memory/adapter persistence, queries, and
trace persistence from the real call inventory. Keep one composition root
that injects a coherent backend into all services. Business logic owns
validation, authorization, IDs, embedding generation, adapter assembly,
proof-of-work, and reward calculation; backend adapters own database operations.
Use typed application filters instead of passing raw Qdrant filters or SQL
through tools. Keep backend-specific administration behind explicit capabilities.

Retain all payload fields, IDs, layer ordering, MIME metadata, timestamps,
quality/reward fields, and embedding model/dimension metadata. Use an explicit
Arrow schema that also works for an empty database. Store filterable fields
as typed columns; preserve additional payload fields without lossy conversion.
Use a separate trace table without fake vectors. Specify unique logical keys,
idempotent upsert, merge-versus-replace behavior, pagination, and delete scope.

For the first local release, use one process per data directory with a robust
process lock and actionable second-process error; separate directories remain
independent. Test stale lock recovery after forced termination. Do not rely on
an in-memory mutex for interprocess safety. Serialize overlapping logical
mutations inside the process and preserve existing trace mutation ordering.
Treat multi-table adapter writes as a consistency problem: choose and test
batch publication or a recoverable commit marker before implementing them.
Readers must not observe half-written chains; do not claim LanceDB provides
cross-table transactions without proving it for the chosen SDK.

Record a schema version and embedding identity. Reject incompatible schemas
or embedding dimensions without deleting data. Any later migration requires
an explicit, recoverable design. No silent recreation, overwrite-mode table
creation, or automatic re-embedding of an existing database at startup.
Await writes before returning success; integrate orderly close and lock
release with shutdown, including the existing one-second exit timer.

### Search quality and isolation

The current activation path uses multiple dense vectors, BM25, reciprocal-rank
fusion, text boosts, and `attest_boost`. A single nearest-vector query would
change behavior materially. Characterize the existing behavior first.

For LanceDB, explicitly select each vector column and cosine distance;
LanceDB defaults to L2. Convert distance to similarity only where the caller
expects cosine similarity (`1 - distance`); fused scores are a separate
contract. Preserve thresholds through characterization, not arbitrary scaling.
Use exhaustive dense search initially for small local tables; defer ANN tuning.
Implement lexical retrieval and shared fusion/reranking with equivalent intent,
including title/activation-pattern fields and reward signals. Verify SDK support
before selecting the lexical implementation. Do not silently drop a search leg
or relax relevance tests to get the new backend passing.

Apply allowed-space filters before candidate limits/ranking and all reads by
ID, listing, counting, export, updates, and deletion. Preserve the existing
distinction between search-visible application resources and writable user
spaces. Missing and unauthorized IDs retain existing behavior. Escape all
database filter literals centrally; test quotes and injection-shaped inputs.
Maintain deterministic tie ordering, exclusions, grouping, fresh reads, and
cache invalidation. Dense-only degradation, if retained from existing behavior,
must be explicit and tested rather than the ordinary LanceDB implementation.

## Ordered implementation packets

Complete packets in order, one coherent commit per packet where practical.
Record touched files, commands, results, and unresolved risks in the PR.
An unchecked gate is not permission to move on and hide the failure.

### Packet 1 — characterization and SDK feasibility

- [ ] Produce a complete caller/operation inventory from the source map.
- [ ] Add shared contract fixtures for real memory payloads, adapter chains,
  artifacts, traces, spaces, updates, pagination, and ranking behavior.
- [ ] Establish Qdrant baseline results using deterministic embeddings;
  include title-only, activation-pattern-only, lexical, and rewarded matches.
- [ ] Select and lock a supported `@lancedb/lancedb` version. Verify its Node 24
  native install, empty-table schema, upsert, filter, reopen, and search APIs
  in a small isolated test using a temporary directory.
- [ ] Record the schema, commit/recovery strategy, and supported OS/architecture
  matrix here before building the adapter. Do not invent SDK methods.

Gate: real Qdrant baseline and SDK feasibility pass. Escalate unsupported native
platforms, unavailable lexical search, or unresolved consistency semantics for
design review; do not replace the requested database without agreement.

### Packet 2 — isolate Qdrant without changing behavior

- [ ] Introduce the typed storage interfaces and composition root.
- [ ] Wrap existing Qdrant code; retain its collection names, aliases,
  migration logic, search behavior, and data layout.
- [ ] Move direct-access callers to the interfaces; extract shared business
  logic rather than duplicating adapter and artifact implementations.
- [ ] Route traces and module singletons through injection. Backend-specific
  imports/initializers must be lazy where they validate configuration.
- [ ] Keep Qdrant as the effective default during this packet.

Gate: the existing Qdrant integration suite and characterization fixtures pass.
Review interface coverage and space isolation before building the second adapter.

### Packet 3 — implement persistent LanceDB storage

- [ ] Implement directory resolution, locking, schema/version checks, and
  lifecycle; make LanceDB selectable explicitly without changing defaults yet.
- [ ] Implement CRUD, filters, counts, stable pagination, resource lookup,
  adapter chain publication, artifacts, quality updates, and trace persistence.
- [ ] Implement all search signals and reranking required above.
- [ ] Preserve cache invalidation and per-request space context.
- [ ] Run the same storage contract suite against both real backends.

Gate: both backends pass. Restart a separate process against the same directory
and verify stored content, traces, search, tune, and deletion; an in-process
reopen alone is insufficient evidence of persistence.

### Packet 4 — enable the local default end to end

- [ ] Implement the selection table, backend-specific validation, and startup
  diagnostics without exposing secrets.
- [ ] Boot built-in resources idempotently through the selected backend.
- [ ] Remove unconditional Qdrant waits and connection-dependent diagnostics
  on LanceDB; route readiness to the selected backend.
- [ ] Keep Qdrant snapshots supported. On LanceDB, expose a clear unsupported
  capability for Qdrant-only administration; never report a fake successful backup.
- [ ] Verify `train → activate → forward → reward`, tune, export, delete,
  spaces, and artifact access through the real stdio MCP transport.
- [ ] Verify single-process HTTP with LanceDB and authenticated Qdrant
  regression paths. Shared/multi-replica deployment remains a Qdrant use case.

Gate: a clean local environment starts with no Qdrant/Redis processes and no
database environment variables. Assert no Qdrant connections are attempted,
including import-time side effects. Embedding-service access is still allowed.

### Packet 5 — distribution, documentation, and merge evidence

- [ ] Update dependencies and lockfile without unrelated upgrades. Ensure a
  Qdrant-only user is not broken by eagerly loading LanceDB native bindings.
- [ ] Extend tarball installation tests to exercise the actual installed CLI
  and persistence outside the package directory. Do not test the old published
  version via ordinary `npx` and call it evidence for this branch.
- [ ] Add a service-free local CI lane on supported Node 24 platforms. Keep
  Qdrant service/snapshot integration lanes explicit and operational.
- [ ] Test native installation on advertised macOS, Windows, and Linux
  architectures and container libc variants actually shipped; report gaps.
- [ ] Update README, install prerequisites, environment templates, and shipped
  installation guidance with local defaults, embedding requirements, directory,
  backup-while-stopped instructions, and explicit Qdrant selection.
- [ ] Follow documentation governance; do not hand-edit generated RepoWiki.
  Coordinate any necessary chart changes in `SquadRules/charts` separately.
- [ ] Run required repository checks and obtain a final storage/security review.
  Change the draft to ready only after implementation and evidence are complete.

## Acceptance matrix

| Test | Required evidence |
| --- | --- |
| New user | Installed tarball, empty home/data/cache, embeddings configured, no database vars or services; stdio initializes and completes a real adapter workflow. |
| Persistence | New process and changed working directory see the same IDs, artifacts, vectors, traces, updates, and deletions. Package reinstall preserves data. |
| Compatibility | Existing `QDRANT_URL` selects Qdrant; contents/collections unchanged; failed Qdrant connection does not select LanceDB. |
| Configuration | Every selection-table row, blank/invalid values, explicit directory, and caller-relative path tested. |
| Authorization | Two user spaces plus application space: no cross-space reads, ranked hits, counts, exports, writes, or deletes. |
| Search | Handcrafted vector expectations and captured ranking fixtures pass for both backends; stable ties, exclusions, lexical/title/pattern matches, and reward effects. Numerical backend scores need not be identical. |
| Mutations | Idempotent retry, replacement/merge semantics, no duplicate rows, interrupted multi-record write recovery, cache refresh, and ordered trace updates. |
| Failures | Unwritable directory, disk/write error, incompatible schema/model/dimension, missing native binding, second process, and stale lock yield actionable errors without data reset. |
| Lifecycle | Graceful stop waits for acknowledged writes; forced termination preserves acknowledged content and recovers cleanly. |
| Distribution | Real package installation and smoke test on each supported platform; Qdrant container and existing CI lanes remain green. |

Use the repository's npm scripts. Install dependencies with `npm ci`; read
`CONTRIBUTING.md` and the maintainer build/test reference before running tests.
Deploy before the existing integration tests (`npm run dev:deploy`, then
`npm run dev:test -- <test-file>`); run the full suite and `npm run handoff`
before marking implementation ready. Add dedicated npm scripts for the new
service-free storage/stdio tests rather than routing that lane through scripts
which start Qdrant. Use fixed embeddings for contract tests and a separately
identified real-provider smoke test. Do not change production embeddings to
make tests pass. Missing credentials or infrastructure are reported as unrun,
not passing. The initial documentation-only PR needs documentation checks;
runtime acceptance remains unchecked until the implementation exists.

## Cost-conscious coding handoff

Recommendation: GPT-6 Luna with High reasoning for one packet at a time;
request Astra review after Packet 2 and before merge, and escalate blocked
schema, consistency, or search-quality decisions early. This is a workflow
recommendation, not a guarantee that different models produce identical code.
Keep the same tests and review criteria regardless of the implementing model.
After two unsuccessful attempts at the same failure, hand off the minimal
reproduction and observed results instead of spending indefinitely on retries.

[OpenAI Docs describes GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
as efficient for focused workloads. Model availability and billing depend on
the execution environment; no fixed project cost or savings is promised.

Suggested instruction to the coding model:

> Continue this draft PR on its existing branch. Read this spec and current
> repository instructions. Implement the next incomplete packet only, preserving
> all listed compatibility and authorization invariants. Run its focused checks,
> commit the coherent result, and report evidence and the next packet. Do not
> weaken tests, invent SDK APIs, switch databases after an error, mark unrun
> checks as passed, or mark the draft ready before all acceptance gates pass.
> If the current source invalidates a decision here, explain the conflict and
> propose the smallest plan correction before proceeding with dependent work.

## Implementation references

- [LanceDB documentation](https://docs.lancedb.com/): choose the current Node SDK
  and check its version-specific APIs during Packet 1.
- [Vector search and distance semantics](https://docs.lancedb.com/search/vector-search):
  explicitly select cosine and the correct vector column; exact search can
  avoid approximate-index tuning in the initial local backend.
- [Issue 2](https://github.com/SquadRules/mcp/issues/2): product acceptance scope.

## Execution record

All packets are pending. Fill this section with the selected SDK version,
schema/locking decisions, commit links, supported platform results, and exact
validation commands as implementation proceeds. No runtime test results are
claimed by this planning document.
