# Known issues and limitations

This page only lists limitations that are directly supported by the current
codebase and configuration model.

## Runtime limitations

- **One transport per process.** The server started by `src/index.ts` runs in
  either `TRANSPORT_TYPE=http` or `TRANSPORT_TYPE=stdio` mode. It does not run
  both transports in one process.
- **stdio mode is MCP-only.** With `TRANSPORT_TYPE=stdio`, the process serves MCP on
  stdin/stdout and does not start an HTTP listener: no `/health`, `/api`, `/ui`, or `/mcp` over HTTP.
- **Qdrant is always required.** Startup fails without a reachable
  `QDRANT_URL`.
- **Embedding provider is always required.** Search and training (store) depend on a
  working embedding backend (OpenAI-compatible or TEI-compatible).
- **Redis is optional, but the no-Redis path is in-process only.** When
  `REDIS_URL` is empty, caches and proof-of-work state live in the local memory
  store. That is suitable for single-process/local use, not shared multi-process
  deployments.

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
