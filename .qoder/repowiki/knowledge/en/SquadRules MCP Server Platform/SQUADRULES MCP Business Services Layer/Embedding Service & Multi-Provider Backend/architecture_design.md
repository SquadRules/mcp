The module is organized around a single public `EmbeddingService` class (`service.ts`) that exposes `generateEmbedding`, `generateBatchEmbeddings`, `calculateCosineSimilarity`, `generateMemoryEmbedding`, and `healthCheck`. Provider selection is centralized in `postEmbeddings` (`providers.ts`), which dispatches to one of three concrete providers based on the `EMBEDDING_PROVIDER` env var or auto-detection: `postEmbeddingsOpenAI` (HTTP POST to `/v1/embeddings`), `postEmbeddingsTEI` (HTTP POST to a TEI endpoint), and `postEmbeddingsFastEmbed` (`fastembed-provider.ts`, lazy-loaded ONNX model via `FlagEmbedding.init`).

Key internal layers:
- `config.ts` — resolves `OPENAI_ENDPOINT`, `TEI_EMBEDDING_ENDPOINT`, and owns a process-wide `_resolvedDimension` cache enforced by `setResolvedEmbeddingDimension` / `getResolvedEmbeddingDimension`; callers must run `probeEmbeddingDimension()` at startup.
- `providers.ts` — shared retry layer (`fetchWithRetries`) with exponential backoff + full jitter, `Retry-After` header parsing, per-call wall-clock budget (`computeDeadline` / `isBudgetExceeded`), and an `EmbeddingRateLimitError` typed error for 429/insufficient_quota.
- `audit.ts` — anomaly detection (`detectEmbeddingAnomalies` checks latency, vector norm range, dimension mismatch) plus structured logging helpers `logEmbeddingAuditSuccess` / `logEmbeddingAuditError`.
- `provider-audit.ts` — low-level provider call audit recorded via metrics.
- `bm25-tokenizer.ts` — BM25 tokenizer used alongside embeddings for hybrid search.
- `lazy-probe.ts` + `health.ts` — startup probe and health check utilities.
- `types.ts` — shared `EmbeddingResult` / `BatchEmbeddingResult` interfaces re-exported from `service.ts`.

Dependency direction is inward: consumers import only `EmbeddingService` / `embeddingService` from `service.ts`; provider implementations are internal. Metrics flow through `../metrics/embedding-metrics.js` and `../metrics/anomaly-metrics.js`.