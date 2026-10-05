# Known issues and limitations

This page only lists limitations that are directly supported by the current
codebase and configuration model.

## Runtime limitations

- **One transport per process.** The server started by `src/index.ts` runs in
  either `TRANSPORT_TYPE=http` or `TRANSPORT_TYPE=stdio` mode. It does not run
  both transports in one process.
- **stdio mode is MCP-only.** With `TRANSPORT_TYPE=stdio`, the process serves MCP on
  stdin/stdout and does not start an HTTP listener: no `/health`, `/api`, `/ui`, or `/mcp` over HTTP.
- **Qdrant is optional now.** An embedded LanceDB store is the default (see
  *Vector store backends* below). Qdrant is used only when `QDRANT_URL` is set.
- **An embedding backend is required, but no longer needs a key or service.** Search and
  training (store) depend on embeddings. By default they are produced **locally** with
  fastembed (see *Embedding backends* below), so simple mode and `npx ... serve` need no
  `OPENAI_API_KEY` and no inference service. OpenAI/Ollama remain opt-in alternatives.
- **Redis is optional, but the no-Redis path is in-process only.** When
  `REDIS_URL` is empty, caches and proof-of-work state live in the local memory
  store. That is suitable for single-process/local use, not shared multi-process
  deployments.

## Vector store backends

The server picks its vector/trace store from a single switch — the presence of a
non-empty `QDRANT_URL`:

- **Default: embedded LanceDB.** With `QDRANT_URL` unset or empty the server runs a
  local, file-backed LanceDB store, so `npx -y @squadrules/mcp serve` needs no Qdrant,
  Redis, or Docker — only an embedding provider.
- **Qdrant is opt-in.** Setting `QDRANT_URL` keeps the existing Qdrant backend with
  unchanged collections, aliases, search, and snapshots. A failed Qdrant connection
  surfaces as an error; the server never falls back to an empty LanceDB while
  `QDRANT_URL` is set.

### Embedded LanceDB limitations

- **Data directory must be writable.** LanceDB opens `<config dir>/lancedb/` —
  `~/.config/squadrules/lancedb` (or `$XDG_CONFIG_HOME/squadrules/lancedb`) on
  macOS/Linux and `%APPDATA%\squadrules\lancedb` on Windows — the same parent as
  `config.json`. It is created on first run; a read-only or otherwise unwritable
  location fails startup.
- **Back up by stopping the server.** There is no server-side snapshot on the embedded
  backend. `POST /api/snapshot` is a Qdrant capability and returns an honest
  `400 SNAPSHOT_UNSUPPORTED` here. To back up, stop the server and copy the `lancedb`
  directory.
- **`/health` names the backend truthfully.** On the embedded store `dependencies`
  reports `vectorStore` (not `qdrant`) and `details.vectorStoreBackend` is
  `embedded-lancedb`; on Qdrant it reports `qdrant` and `vectorStoreBackend: qdrant`.
- **No cross-process cache coherence without Redis.** Several MCP processes may share
  one LanceDB directory (concurrent reads and writes are safe under Lance MVCC), but
  each keeps its own in-process cache and cache `publish()` is a no-op when Redis is
  not configured. A tune/update/delete in one process is not seen by another until that
  process restarts or reads with `fresh`. Run Redis if you need shared invalidation.
- **Qdrant-substrate integration tests are skipped on the embedded backend.** Tests
  that assert raw Qdrant behavior (`points/scroll` / `points/payload` REST probes or
  `POST /api/snapshot`) are gated to run only when `QDRANT_URL` is set, so they report
  as skipped under embedded LanceDB. The equivalent behavior is covered by
  backend-neutral API-level tests that run on both backends.

## Embedding backends

Embeddings default to **local fastembed** (`BAAI/bge-base-en-v1.5`, 768 dims) when no
external provider is configured; OpenAI (including Ollama via `OPENAI_API_URL`) and TEI
are opt-in alternatives. See [install/prerequisites.md#embedding-backend](install/prerequisites.md#embedding-backend)
for configuration.

- **First run downloads the model.** fastembed's own downloader fetches the ONNX weights
  into a shared per-user cache dir (`<config dir>/models`, sibling of the LanceDB data
  dir). This needs network on first use; **air-gapped installs must pre-seed that
  directory**. `FASTEMBED_MODEL` / `FASTEMBED_CACHE_DIR` override the model and location.
- **Model dimensions are a migration boundary.** fastembed is 768-d, OpenAI
  `text-embedding-3-small` is 1536-d, and TEI models vary. Changing the provider on an
  existing collection can require a vector migration because stored vectors are fixed-size.
- **Deferred limitation — download integrity and cross-instance races.** The download is
  delegated to fastembed, so this release does **not** verify a boot checksum, does not
  lock the cache across instances, and does not atomically move a completed download. Two
  `npx` processes cold-starting at once against a fresh cache dir could race it. Accepted
  deliberately for a young, low-traffic project; revisit — or file improvements upstream
  with fastembed — if corruption or races surface.
- **TEI is deprecated (issue #11).** It remains functional but emits a one-time startup
  warning; removal is planned as a future breaking change.

## Auth and client limitations

- **Auth is optional, not transparent.** If `AUTH_ENABLED=false`, the server
  allows unauthenticated access to `/api`, `/mcp`, and `/ui`. If
  `AUTH_ENABLED=true`, those surfaces require a valid session or Bearer token.
- **CLI token storage is per API URL.** Logging in against one base URL does
  not authenticate the CLI against a different base URL.
- **Browser PKCE login depends on a reachable local callback port.** If local
  callback binding is blocked, browser login will fail until you free or change
  the callback port.

## UI limitations

- **The browser UI is not a full agent runtime.** It provides browsing,
  adapter detail/editing, and a guided run/testing surface, but the core
  automation model remains MCP/REST/CLI driven.

## Project/operational limitations

- **Single-maintainer project.** There is no formal SLA or managed support
  channel in the repository.

## Upgrades

Release notes are published on
[GitHub Releases](https://github.com/SquadRules/mcp/releases).

Before upgrading, check:

- release notes
- env var changes in `src/config.ts`
- workflow or image changes in `.github/workflows/` and the Dockerfiles
