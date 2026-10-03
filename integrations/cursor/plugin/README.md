<!-- squadrules-compat-surface: references the retained logo/kairos-mcp.svg asset filename (filename rename is an explicit non-goal) -->
# SQUADRULES MCP — Cursor plugin (local)

This folder is a **Cursor plugin** bundle: manifest, logo, and MCP server config
for connecting to the SQUADRULES streamable HTTP endpoint. Use it when you want
Cursor’s tool row to show the SQUADRULES logo (plugin metadata), not only a manual
`mcp.json` entry.

Official artwork matches [logo/kairos-mcp.svg](../../../logo/kairos-mcp.svg)
in the repository root (copied here as `assets/logo.svg`).

## Layout

| Path | Role |
|------|------|
| `.cursor-plugin/plugin.json` | Plugin manifest (`logo`, `mcpServers` → `mcp/mcp.json`) |
| `assets/logo.svg` | Logo referenced by the manifest |
| `mcp/mcp.json` | `mcpServers` block (same shape as user-level MCP config) |

## Prerequisites

- A running SQUADRULES server on the URL you configure (default in `mcp/mcp.json` is
  `http://localhost:3300/mcp`, aligned with local dev in this repo).
- Cursor with support for [Cursor
  plugins](https://cursor.com/docs/plugins/building).

## Install (local plugin directory)

1. Start SQUADRULES and confirm health on the base URL you will use (for example
   `curl http://localhost:3300/health`).
2. If your server is not on port **3300**, edit
   `mcp/mcp.json` and set `"url"` to your `/mcp` endpoint.
3. In Cursor, install this directory as a plugin: use the folder that **contains**
   `.cursor-plugin` (that is, this `integrations/cursor/plugin` directory), per
   Cursor’s plugin docs. If your Cursor build only offers user-level MCP JSON,
   use [docs/install/README.md#cursor-and-mcp](../../../docs/install/README.md#cursor-and-mcp) instead.

## Verify

1. Open a chat that can call MCP tools.
2. Run **`spaces`** (empty `{}` is enough).
3. Confirm the **SQUADRULES** logo appears next to the tool run in the tool row and
   that the call still hits your HTTP MCP server (same behavior as a manual
   `mcp.json` entry).

## Trademark

The name and logo are governed by [TRADEMARK.md](../../../TRADEMARK.md). Use this
bundle to connect to **official** SQUADRULES MCP, not for unrelated distributions.
