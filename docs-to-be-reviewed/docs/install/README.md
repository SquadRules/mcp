# Install SquadRules

`@squadrules/mcp` is an **npm-only** package. Install it with `npm`, run it
either as the **`squadrules`** CLI or as the MCP server that your agent host
launches over **stdio**, and use the CLI as the primary interface for
authentication, bulk adapter operations, and verification.

For container image (Docker Hub / quay.io) or Kubernetes (Helm) deployment,
see the [sibling repos](#other-install-paths) below.

---

## Quick start

### 1. Prerequisites

- **Node.js 24+** (Node LTS).
- **One embedding backend.** By default SquadRules embeds locally with
  fastembed — no API key, no inference service. See
  [Embedding backend](prerequisites.md#embedding-backend) for the alternatives.

There is **no database requirement**: with no `QDRANT_URL` set, the server uses
the embedded LanceDB store under `~/.config/squadrules/lancedb` (created on
first run). The full selection rule and per-backend limitations are in
[Known issues & limitations § Vector store backends](../known-issues-and-limitations.md#vector-store-backends).

### 2. Install the package

```sh
npm install -g @squadrules/mcp
squadrules --help
```

The global install provides both the **`squadrules`** CLI (auth, bulk
operations, verification, `serve`) and the MCP server binary used by your
agent host. The package also installs the **`squadrules-mcp`** alias.

### 3. Choose how you run it

- **stdio (default)** — your MCP host spawns `squadrules serve`. Best for
  Cursor, Claude Desktop, Claude Code, and other local-process hosts. No
  port, no HTTP listener, no Docker.
- **HTTP** — run `squadrules serve --transport http` on a host that must
  serve `/mcp`, `/api/*`, `/ui`, and `/health`. Add `TRANSPORT_TYPE=http` to
  the environment (or set `--transport http`) when you want a long-running
  server reachable by remote agents.

Full command surface: [CLI reference](../CLI.md).

---

## Configure your MCP host

Add SquadRules to your host's `mcp.json`. With **no `QDRANT_URL`** the server
uses the embedded LanceDB store and the local fastembed model — an empty
`env` object is enough:

```json
{
  "mcpServers": {
    "SquadRules": {
      "command": "squadrules",
      "args": ["serve"],
      "env": {}
    }
  }
}
```

To use an existing Qdrant instead, add `"QDRANT_URL": "http://localhost:6333"`
(and `"QDRANT_API_KEY": ""` for no-auth localhost Qdrant). To override the
local embedding default with an external backend, supply **one** of:

- **OpenAI** — `OPENAI_API_KEY`
- **Ollama / OpenAI-compatible** — `OPENAI_API_URL`, `OPENAI_EMBEDDING_MODEL`,
  and `OPENAI_API_KEY=ollama`
- **TEI** (deprecated) — `TEI_BASE_URL` (+ optional `TEI_MODEL`)

Every parameter is **ENV-overridable**. See
[prerequisites § Embedding backend](prerequisites.md#embedding-backend) for
model sizes, migration notes, and cache-directory behaviour.

## Cursor and MCP

Configure MCP only when your IDE or host needs it. The CLI remains the primary
interface even when MCP is enabled.

Use transport by host class:

- **stdio** for local-process hosts (Cursor, Claude Desktop, Claude Code).
- **Streamable HTTP** for containerised or remote deployments.

### stdio host snippet

```json
{
  "mcpServers": {
    "SquadRules": {
      "command": "squadrules",
      "args": ["serve"],
      "env": { "TRANSPORT_TYPE": "stdio" }
    }
  }
}
```

`TRANSPORT_TYPE=stdio` is the default; setting it explicitly is only useful
when the environment might otherwise carry `TRANSPORT_TYPE=http` from another
deployment. In stdio mode the server writes MCP JSON-RPC frames to stdout and
all logs to stderr.

### HTTP host snippet

Run the server on a shell (`squadrules serve --transport http` or
`TRANSPORT_TYPE=http node dist/index.js` from a source checkout), then point
the host at the port. The MCP URL uses the same host and port as `/health`,
with `/mcp` appended.

```json
{
  "mcpServers": {
    "SquadRules": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp",
      "alwaysAllow": [
        "activate",
        "forward",
        "train",
        "reward",
        "tune",
        "delete",
        "export",
        "spaces"
      ]
    }
  }
}
```

```sh
curl -sS "http://localhost:3000/health"
```

- Discovery: `/.well-known/oauth-protected-resource`
- Auth: [CLI § Authentication](../CLI.md#authentication),
  [auth overview (project Wiki)](https://github.com/SquadRules/mcp/wiki)
- Widgets: `spaces` and `forward` use MCP Apps on hosts that support them.
- Discovery scopes default to
  `openid,profile,email,squadrules-groups,offline_access`; set
  `SQUADRULES_OIDC_SCOPES_SUPPORTED` (or its
  `SQUADRULES_OIDC_SCOPES_SUPPORTED` compatibility alias) to override this
  list for your IdP policy.

Some hosts show a longer **agent-visible** server id (for example one ending
in `-SQUADRULES`); see [AGENTS.md](../../AGENTS.md) for the runtime
authority note.

If MCP does not connect, verify the health URL first, confirm the host and
port, and make sure the server has a working embedding backend (and, if
opted-in, a reachable `QDRANT_URL`).

---

## Other install paths

The npm package is the source of truth. To consume it via other deployment
mechanisms, follow the sibling repos that wrap it:

| Path | Home repo | Notes |
|------|-----------|-------|
| Container image | [`SquadRules/containers`](https://github.com/SquadRules/containers) | Multi-arch (amd64/arm64), signed with cosign keyless, published to `docker.io/squadrules/mcp` and `quay.io/squadrules/mcp`. Built **from** the published npm package. |
| Kubernetes (Helm chart) | [`SquadRules/charts`](https://github.com/SquadRules/charts) | Deploys Qdrant + optional Redis/Valkey, Keycloak, Postgres via operators. Published to `oci://ghcr.io/squadrules/charts/mcp`. Values and operator prerequisites live in the chart. |

---

## Pages in this directory

| Doc | Use for |
|-----|---------|
| [prerequisites](prerequisites.md) | Vector-store and embedding-backend selection before you set `.env` or `mcp.json` env |

---

## Developer path

For working **on** the codebase (running integration tests, using the full
Keycloak / Valkey / Postgres stack locally, or using the VS Code / Cursor
devcontainer), see [CONTRIBUTING.md](../../CONTRIBUTING.md). The
infrastructure services used by CI and devcontainers live in
[`compose/infra.yaml`](../../compose/infra.yaml) — that file is **not** a
user-facing install target; it does not run the SquadRules app.

---

## Index

- [Documentation map](../README.md)
- [Main README](../../README.md)
- [CLI reference](../CLI.md)
- [Project Wiki](https://github.com/SquadRules/mcp/wiki)
