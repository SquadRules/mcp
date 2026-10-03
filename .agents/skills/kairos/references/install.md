<!-- squadrules-compat-surface: skill directory + name: frontmatter (kairos / kairos-dev) are retained invocation identifiers; path/filename rename is an explicit non-goal and body prose references these names plus the retained kairos CLI alias -->
# Install — global npm package (end users)

First-time setup for an end user who just wants their MCP host (Claude
Desktop, Cursor, Claude Code, …) to talk to KAIROS. Install the package
globally, then point your host at **`kairos serve`** — **no `--transport`
flag**, because `serve` already defaults to **stdio**.

This mirrors the user quick start in the repository
[README](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/README.md). If the
two ever disagree, the README is authoritative.

## Prerequisites

- **Node.js 24 or later**.
- **A Qdrant reachable on `localhost:6333`** with **no auth**. The server
  cannot boot without a vector store. If you do not already run one, the
  quickest option is:

  ```bash
  docker run -p 6333:6333 qdrant/qdrant
  ```

  This one line is a convenience, not a requirement — any Qdrant on
  `localhost:6333` works.
- **One embedding backend.** Pick exactly one and set its env (see below).

## Install

```bash
npm install -g @jakub-plichcinski/kairos-mcp
kairos --help
```

The global install provides both the **`kairos`** CLI (bulk operations, auth,
server management) and the MCP server binary used by your agent host.

## Host `mcp.json`

Add KAIROS to your MCP host configuration. The command is flagless — stdio is
the default transport:

```json
{
  "mcpServers": {
    "kairos": {
      "command": "kairos",
      "args": ["serve"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "QDRANT_API_KEY": "",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

- `QDRANT_URL` defaults to `http://localhost:6333` and `QDRANT_API_KEY`
  defaults to `""` (no auth), so on a default localhost Qdrant you may omit
  both. They are shown explicitly here so the no-auth intent is obvious.
- **Every parameter is ENV-overridable.** Set values in the host's `env`
  block (or your shell) to point at a remote Qdrant, enable auth, or swap
  embedding backends.

## Embedding backend (choose one)

Set the env for exactly one backend in the `env` block above:

- **OpenAI (hosted):** `OPENAI_API_KEY=sk-...`
- **OpenAI-compatible / Ollama (local):**
  `OPENAI_API_URL=http://localhost:11434/v1` +
  `OPENAI_EMBEDDING_MODEL=<model>` + `OPENAI_API_KEY=ollama`
- **TEI (Text Embeddings Inference):** `TEI_BASE_URL=http://localhost:8080`
  (+ optional `TEI_MODEL`)

## Verify

After the host connects, KAIROS tools (`activate`, `forward`, `reward`, …)
should be listed. If the host lets you run the CLI directly:

```bash
kairos --help
```

## HTTP listener (optional)

The default is stdio. If you instead need the HTTP server (`/mcp`, `/api/*`,
`/ui`, `/health`), pass `--transport http` or set `TRANSPORT_TYPE=http`. That
path is documented for developers in
[CONTRIBUTING.md](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/CONTRIBUTING.md).

## Troubleshooting

- **Server exits immediately / cannot reach vector store** — confirm Qdrant is
  up on `localhost:6333` (or that `QDRANT_URL` points where Qdrant actually
  runs). Try `curl http://localhost:6333/readyz`.
- **Embedding errors** — confirm exactly one embedding backend is configured
  and its endpoint/model/key are correct.
- **Auth failures against a remote Qdrant** — set `QDRANT_API_KEY` to the
  remote key (leave it `""` only for no-auth localhost).

For installing the agent skills themselves, see
[updates.md](updates.md).
