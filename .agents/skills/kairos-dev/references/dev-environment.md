<!-- squadrules-compat-surface: skill directory + name: frontmatter (kairos / kairos-dev) are retained invocation identifiers; path/filename rename is an explicit non-goal and body prose references these names plus the retained kairos CLI alias -->
# Development environment — Docker Compose full stack

How to run kairos-mcp the way maintainers and CI do: the Docker Compose full
stack, driven by npm scripts. This is the developer counterpart to the
end-user npx path (which is the `kairos` skill's
[install reference](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.agents/skills/kairos/references/install.md)).

The authoritative narrative for contributors lives in
[CONTRIBUTING.md](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/CONTRIBUTING.md);
this reference is the agent-facing quick path. If they disagree, CONTRIBUTING.md
wins.

## Bring up the stack

```bash
npm ci
npm run infra:up      # Qdrant (+ Redis / other infra) via Docker Compose
npm run dev:deploy    # build + deploy the app against the local infra
```

- The dev scripts default the app to port **3300** (see
  `scripts/env/.env.template` and `scripts/deploy-run-env.sh`). Use the same
  host and port for health checks, the UI, and MCP URLs.
- Docker sets `TRANSPORT_TYPE=http` explicitly, so the compose stack serves
  `/mcp`, `/api/*`, `/ui`, and `/health` — unlike the end-user npx path, which
  defaults to stdio.

## Verify

```bash
curl http://localhost:3300/health
```

- UI: `http://localhost:3300/ui`
- MCP: `http://localhost:3300/mcp`
- Metrics: `http://localhost:9090/metrics`

## Worktrees and .env

Git worktrees do not share `.env*` with the main checkout. The first
`npm run dev:*` that uses `deploy-run-env.sh` copies `.env` when missing, and
you must keep `PORT` / `METRICS_PORT` from clashing across checkouts on one
host. See [worktree-env.md](worktree-env.md).

## Build and test

Once the stack is up, follow the authoritative build/deploy/test contract in
[build-test.md](build-test.md) — npm scripts only, always `dev:deploy` before
`dev:test`.

## Cursor / MCP server ids

The repository ships [`.agents/mcp.json`](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.agents/mcp.json)
with the `KAIROS-DEVELOPMENT` entry pointed at the local dev server. Cursor
users configure the same entry in their own `.cursor/mcp.json` (see
`docs/install/README.md#cursor-and-mcp`). If an MCP call fails to resolve a
server, see [mcp-host-bridge.md](mcp-host-bridge.md).
