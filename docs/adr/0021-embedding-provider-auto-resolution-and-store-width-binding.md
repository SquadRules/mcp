# ADR 0021: embedding provider `auto` resolution, and the store vector width it binds

## Status

Proposed — records the intended contract and two open questions. The `auto` preference and the
Qdrant-side migration already exist in code; what is missing is the embedded-store half
([#94](https://github.com/SquadRules/mcp/issues/94)) and the parts flagged TBD.

## Context

### The decision as taken: `EMBEDDING_PROVIDER=auto` is the default, and `auto` means autodetection

| Provider | Selected when | Status |
| --- | --- | --- |
| fastembed | nothing external is configured — the built-in fallback, no key, no service | Default |
| OpenAI / Ollama-compatible | `OPENAI_API_KEY` and/or `OPENAI_API_URL` is defined (an override, not the baked default) | Supported |
| TEI | `TEI_BASE_URL` + `TEI_MODEL` | Deprecated ([#11](https://github.com/SquadRules/mcp/issues/11)) |

So the resolution rule is deliberately simple: `(OPENAI_API_KEY || OPENAI_API_URL) ? openai : fastembed`.
`auto` is not an accident to be removed — a local install must work with zero configuration (fastembed)
and must use a better model the moment an endpoint is configured, without the operator naming a
provider. [ADR 0004](0004-fastembed-default-for-testing.md) is the CI expression of the same rule
(lanes blank the key, so they land on fastembed).

Two deviations from that rule are present in code today:

- **`OPENAI_API_URL` does not select OpenAI.** The auto branch tests
  `if (OPENAI_API_KEY && OPENAI_EMBEDDING_MODEL)`
  ([`src/services/embedding/providers.ts`](../../src/services/embedding/providers.ts)), and
  `OPENAI_EMBEDDING_MODEL` has a non-empty default (`text-embedding-3-small`), so the test collapses
  to "is there a key". An operator pointing at an OpenAI-compatible endpoint (Ollama, vLLM, a proxy)
  with only `OPENAI_API_URL` set silently stays on fastembed. Note that the intended rule cannot be
  read as "the variable has a value" — `OPENAI_API_URL` always has one — it must mean *explicitly
  overridden*, which the config layer currently cannot distinguish.
- **The logs report the preference, not the resolution.** `embedding: ${EMBEDDING_PROVIDER}` prints
  `auto` ([`src/runtime/boot-local-runtime.ts`](../../src/runtime/boot-local-runtime.ts)), and the stdio
  banner prints `local model ${FASTEMBED_MODEL}`
  unconditionally ([`src/stdio/stdio-banner.ts`](../../src/stdio/stdio-banner.ts)). A process that
  resolved to OpenAI therefore advertises the local model. This is what made
  [#94](https://github.com/SquadRules/mcp/issues/94) self-diagnose incorrectly: the operator read the
  banner, believed fastembed, and the real resolution was only recoverable from the error string.

### Why the resolution result is load-bearing: it names the stored columns

The embedded LanceDB store names its vector columns by width — `vs{dim}`, `adapter_title_vs{dim}`,
`activation_pattern_vs{dim}` (`src/utils/qdrant-vector-types.ts`). Every name on the write path comes
from `getEmbeddingDimension()`, which is set only from the length of the first vector a provider
returns (`setResolvedEmbeddingDimension()` in `src/services/embedding/config.ts`, asserted
single-width per process). The table is created once from that first row and never reconciled:
`LanceRecordEngine.ensureTableForWrite()` opens an existing table as-is, and Lance does not add
columns during `mergeInsert(...).whenNotMatchedInsertAll()`.

Consequence observed in [#94](https://github.com/SquadRules/mcp/issues/94): a store whose rows are all
`vs384` (fastembed) received writes keyed `vs1536`, rejected with
`Found field not in schema: vs1536 at row 0`. Reads degrade silently in the same situation —
`searchMemories()` derives column names from the *query* vector length, and `cosine()` returns 0 for a
missing column, so all three dense legs score zero and ranking survives only on the text boosts and
the `finalize()` `fallbackScore`.

### Migration support: Qdrant yes, LanceDB not yet (but the SDK allows it)

- **Qdrant auto-migrates at boot.** `src/services/memory/store-init.ts` reads the collection's vector
  config, compares `existingDim` against the resolved `currentDim`, and when they differ logs
  `Vector migration required` and drives `migrateVectorSpace()` / `addVectorsToCollection()`
  (`src/utils/qdrant-vector-management.ts`).
- **LanceDB has no migration in this codebase.** `lance-records-engine.ts` uses only
  `createTable` / `openTable` / `mergeInsert` / `delete`. The SDK
  (`@lancedb/lancedb` 0.30) does expose the primitives a boot migration needs — `addColumns`,
  `alterColumns`, `dropColumns`, `update`, `createIndex`, plus MVCC version restore — so the capability
  is available and simply unused.

## Decision

- **`auto` remains the shipped default and keeps its autodetection meaning.** The resolution
  predicate becomes the stated rule: an *explicitly overridden* `OPENAI_API_URL` selects the
  OpenAI-compatible path the same way `OPENAI_API_KEY` does. Requires the config layer to distinguish
  "operator set this" from "default filled this" — TBD as a config concern, not an embedding one.
- **The provider is initialised and its dimension resolved before anything about the store is
  decided.** Probe first, then choose the vector width, then decide whether migration is required —
  for both backends. The call order already satisfies this on every boot path
  (`bootLocalRuntime()`: `ensureEmbeddingDimension()` → `memoryStore.init()` → seeding), so the work
  is not resequencing calls but making the embedded `init()` actually *use* the resolved dimension:
  today `LanceVectorRecordStore.init()` only opens a connection and ignores it entirely.
- **A store's vector width is bound to the provider that created it and is recorded with the store.**
  Persist resolved provider, model id, and dimension as store metadata, so width is a known property
  rather than something inferred from whichever column was written first. For stores predating this
  rule, derive the width from the `vs{dim}` columns present on first boot and then stamp it.
- **Width mismatch is handled, not tolerated.** The embedded store gets the same boot treatment the
  Qdrant path already has: detect `stored != resolved`, then either migrate (add the new-width columns,
  re-embed all rows, drop the stale ones, record the new width) or refuse the write with one
  actionable message. `MEM_BOOT_FORCE_INJECT=true` is explicitly *not* a repair path here, because it
  deletes and retrains against the same fixed schema and fails again.
- **Reads must use the stored width, never the query's.** `lance-records-search.ts` derives column
  names from `queryVector.length`; a width-bound store makes the correct name available from the store,
  which removes the silent-zero failure mode even when a migration is pending.
- **Startup reports what resolved.** Banner and boot lines print provider, model, and dimension
  actually in use, and warn when they differ from the stored width. `auto` must never be the only
  thing a log says about the provider.

## TBD — decisions this record does not yet make

1. **Failure policy when the resolved provider cannot initialise.**

   - Explicit (`EMBEDDING_PROVIDER=openai`): *decided by intent in this record* — boot is a critical
     error (process aborts), runtime is an error with retry. This matches today's behaviour: the probe
     throws, `bootLocalRuntime()` rejects, `runSquadrulesServer()` writes `Fatal:` to stderr and sets a
     non-zero `process.exitCode`.
   - `auto` with `OPENAI_API_KEY`/`OPENAI_API_URL` present and the provider failing: **open** — fail the
     same way as the explicit case, or fall back to the built-in fastembed silently.

   Recorded options, with the recommendation the next status change should confirm or reject:

   - **(a) Fail identically.** Predictable, and never mixes two widths into one store. Cost: a quota
     or network failure makes a local install unusable, and a key that was merely left in the
     environment decides that.
   - **(b) Fall back to fastembed, loudly, per process.** Keeps local installs working. Cost: with a
     persistent store this is exactly the width-changing event — a fallback is *not* free, it writes a
     different column name. Only safe if the width binding above already pins the store to the
     provider that created it, and the fallback is refused rather than taken when rows exist.
   - **(c) Recommended: fall back only for an empty store; fail fast for a populated one.** A brand-new
     install has no width to preserve, so a loud one-line fallback costs nothing and keeps the
     zero-configuration promise. Once rows exist, silently switching widths corrupts retrieval, so the
     operator gets the error with the two remedies named (restore the provider, or migrate the store).
     Today's `auto` branch does neither — it falls back to TEI if configured, else rethrows, and never
     reaches fastembed (`src/services/embedding/health.ts` documents that choice as deliberate:
     "a configured-but-failing OpenAI is reported as-is, never masked by the fastembed fallback").
2. **Migration UX for the embedded store.** Whether re-embedding is automatic at boot (as Qdrant does
   it) or gated behind an explicit command. Depends on the measured cost: the store in the incident
   held 66 rows / 57 MB, and [ADR 0003](0003-no-lancedb-store-snapshot.md) measured a forced cold
   injection of the shipped adapters at ~100 s on a CI runner.
3. **`OPENAI_API_URL` explicitness detection** — how the config layer marks a value as operator-set
   (needed for the first Decision bullet), and whether `getEnvString` needs an
   `wasExplicitlySet()` companion.

## Consequences

### Positive

- `auto` keeps its promise: zero-config works, and configuring an endpoint is respected — including
  key-less OpenAI-compatible endpoints via `OPENAI_API_URL`.
- The width of a store becomes a declared property of the store instead of a side effect of whichever
  provider happened to run first, so `Found field not in schema` becomes a detected state.
- Retrieval stops degrading invisibly, because reads resolve column names from the store.
- Operators can trust the startup output: what the banner says is what the process resolved.

### Negative

- Behaviour change for anyone pointing at an OpenAI-compatible endpoint through `OPENAI_API_URL`
  without a key: they will now genuinely use it, and may then need a store migration.
- A width migration on LanceDB is a full re-embed of the store — CPU-bound on fastembed, billable on
  OpenAI — with no way to reuse the old vectors.
- Recording provider/model/dimension with the store adds an invalidation input; a stored stamp that
  disagrees with reality is worse than none, so it must be derived from the columns as well as
  asserted ([ADR 0005](0005-cache-keys-under-release-stamping.md) is the precedent on this).

## Alternatives Considered

### Ship `EMBEDDING_PROVIDER=fastembed` literally, and require an explicit opt-in for remote providers

Rejected — proposed during the #94 triage and overturned on the owner's correction: it removes
autodetection, which is the point of `auto`, and would make a configured endpoint inert unless the
user also knew to set a second variable.

### Only add a fail-fast guard, keep `auto` semantics and the width inference as they are

Removes silent corruption but leaves `OPENAI_API_URL` inert, keeps the banner untrustworthy, and gives
LanceDB users no path forward once their store is misaligned — they can only wipe it. Kept as a
fallback scope if the migration work is deferred, not as the decision.

### Move vector column naming off the width (a single stable `vs` column)

Would dissolve the coupling entirely, and is attractive for the *embedded* store. Rejected for this
record: it is a breaking storage-format change that also touches the Qdrant named-vector contract
(`adapter_title_vs{dim}`, `activation_pattern_vs{dim}`) and the existing migration machinery, so it is
a separate proposal, and the width-binding rule is worth having regardless.

## Reopen condition

[#94](https://github.com/SquadRules/mcp/issues/94) reopens this record. Revisit when (a) the TBD
failure policy is decided and the record moves to Accepted, (b) a second persistent embedded backend
is supported and the width-binding rule must be expressed per backend, or (c) vector column naming
drops the embedded width, which removes the coupling protected here.

## Evidence

- `src/config.ts` — `EMBEDDING_PROVIDER` default `auto`; `OPENAI_EMBEDDING_MODEL` default
  `text-embedding-3-small`; `OPENAI_API_URL` default `https://api.openai.com`.
- `src/services/embedding/providers.ts` — auto predicate `OPENAI_API_KEY && OPENAI_EMBEDDING_MODEL`;
  OpenAI failure → TEI only if configured, else rethrow; no fastembed fallback in the auto branch.
- `src/services/embedding/config.ts` / `fastembed-provider.ts` — dimension set from the first provider
  response, asserted single-width per process.
- `src/runtime/boot-local-runtime.ts` — probe (L120) before `memoryStore.init()` (L126) before seeding
  (L158); `embedding: auto` INFO line. `src/index.ts` — both transports boot through this function.
- `src/services/vector-store/lancedb/lance-records-engine.ts` — `ensureTableForWrite()` create-or-open,
  no reconciliation; `lance-records-writes.ts` `vectorNames()`; `lance-records-search.ts` names from
  `queryVector.length`; `lance-records-mutations.ts` rebuilds `vs{len}` from a fresh embedding.
- `src/services/memory/store-init.ts` + `src/utils/qdrant-vector-management.ts` — Qdrant boot-time
  dimension detection and `migrateVectorSpace()`.
- `node_modules/@lancedb/lancedb/dist/table.d.ts` — `addColumns`, `alterColumns`, `dropColumns`,
  `update`, `createIndex`, `restore` exist and are unused by this codebase.
- [#94](https://github.com/SquadRules/mcp/issues/94) — store dump showing only
  `vs384`/`adapter_title_vs384`/`activation_pattern_vs384` against rejected `vs1536` writes.

## Related

- [ADR 0004](0004-fastembed-default-for-testing.md) — CI lanes blank the key so `auto` lands on
  fastembed; same rule, different mechanism (env hygiene, not provider inference).
- [ADR 0013](0013-embedded-store-multiprocess-safety.md) — embedded store process safety; width
  binding belongs in this contract.
- [ADR 0002](0002-boot-injection-reuse-rule.md), [ADR 0001](0001-two-layer-adapter-write-caching.md) —
  the reuse skip that limited the #94 symptom to 3 of 12 adapters.
- [ADR 0005](0005-cache-keys-under-release-stamping.md) — the risk of a stored stamp going stale.
- [#11](https://github.com/SquadRules/mcp/issues/11),
  [#23](https://github.com/SquadRules/mcp/issues/23),
  [#25](https://github.com/SquadRules/mcp/issues/25) — fastembed introduction and key-free lanes.
