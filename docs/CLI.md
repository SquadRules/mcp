# SquadRules CLI

The `squadrules` CLI talks to a running SquadRules server over HTTP.

## Install

Node.js 24 or later is required (Node 24 is the supported LTS baseline; 25 and 26 are exercised as advisory CI lanes).

```bash
npm install -g @squadrules/mcp
squadrules --help
```

The package also installs the **`squadrules-mcp`** command (same binary as
**`squadrules`**), and retains the former **`squadrules`** and **`squadrules-mcp`**
command names as compatibility aliases that behave identically.

## Run the MCP server (`serve`)

Start the SquadRules server process (same bootstrap as `node dist/bootstrap.js` / `node dist/index.js` after a build). You still need Qdrant and embedding-related variables in `.env` the same way as [Docker Compose — simple stack](install/docker-compose-simple.md).

Transport resolution:

1. **`--transport stdio|http`** (highest priority)
2. **`TRANSPORT_TYPE`** in the environment
3. **Default `stdio`** when neither is set (only for this command; other CLI commands ignore this default)

Main HTTP listener port when **`TRANSPORT_TYPE=http`** (UI, REST, `/mcp`) is resolved as:

1. **`--server-port <n>`** — also sets **`SERVER_PORT`** for the spawned server and writes **`defaultUrl`** to the shared CLI config as `http://localhost:<n>` (so `squadrules login` and other commands target the same port).
2. **`SERVER_PORT`** in the environment (set in `.env*`)
3. Otherwise the child inherits whatever your env files define.

```bash
squadrules serve
squadrules serve --env-file .env
squadrules serve --metrics-port 9091
squadrules serve --transport http --server-port 4300
TRANSPORT_TYPE=http squadrules serve
TRANSPORT_TYPE=http squadrules serve --transport stdio
squadrules serve --transport http
```

Equivalent:

```bash
squadrules-mcp serve --transport stdio
```

- **`--env-file`** — if the path exists, it is loaded with `dotenv` before the server reads configuration. If the file is missing, the command continues (environment-only startup).
- **`--metrics-port`** — sets `METRICS_PORT` for this process before configuration is read.
- **`--server-port`** — sets the main HTTP listener (`SERVER_PORT`); see numbered list above.

The root **`--url`** option applies to **client** commands (it sets `SQUADRULES_API_URL`); it does **not** change the HTTP bind address for `serve`. For supported full-stack installation, prefer **Docker Compose** in [install/README.md](install/README.md); use `serve` when you already run backing services and want a single Node entrypoint.

**From a local clone (npm scripts):** build the publishable tarball and run the install smoke test:

```bash
npm run test:package-local
```

Same as `npm run build:tgz && npm run test:tgz` (installs `dist/squadrules-mcp-<version>.tgz` into a temp directory and checks `squadrules` / `squadrules-mcp`).

Set **`QDRANT_URL`**, **`QDRANT_COLLECTION`**, and an embedding backend (e.g. **`OPENAI_API_KEY`**) as for any server run.

## Select the server URL

The CLI resolves the API base URL in this order:

1. `--url`
2. `SQUADRULES_API_URL`
3. the default URL stored in the shared CLI config
4. fallback: `http://localhost:3000`

Examples:

```bash
squadrules --url http://localhost:3000 search "release checklist"
export SQUADRULES_API_URL=http://localhost:3000
squadrules search "release checklist"
```

> **Environment-variable naming.** Server configuration variables use the
> `SQUADRULES_*` prefix. A few CLI-only connection variables (`SQUADRULES_API_URL`,
> `SQUADRULES_TIMEOUT_MS`, `SQUADRULES_RETRIES`, `SQUADRULES_LOGIN_CALLBACK_PORT`)
> likewise use the `SQUADRULES_*` prefix only; keep using those exact names for the CLI.

## Authentication

When the server requires auth, the CLI uses a stored Bearer token.

### Timeout and retry

By default each HTTP request times out after **15 seconds** and failed requests
are retried up to **2 times** on transient network errors (connection refused,
reset, timeout). Both can be overridden:

```bash
squadrules --timeout 120 train ./adapters --force --recursive
squadrules --timeout 120 --retries 5 train ./adapters --force --recursive
squadrules --retries 0 spaces   # disable retry, fail fast
```

Environment variables (useful in CI / scripts):

| Variable | Description |
|----------|-------------|
| `SQUADRULES_TIMEOUT_MS` | Request timeout in milliseconds (e.g. `120000`) |
| `SQUADRULES_RETRIES` | Max network-error retries (e.g. `5`, or `0` to disable) |

Precedence: CLI flag > env var > default.

### Storage model

The CLI and MCP hosts share the same local config path:

- Unix: `$XDG_CONFIG_HOME/squadrules/config.json`
- fallback Unix: `~/.config/squadrules/config.json`
- Windows: `%APPDATA%\squadrules\config.json`

A former `squadrules` config directory is still read as a fallback and copied into
the `squadrules` directory on first use; the older directory is never deleted.

**Token read:** The CLI reads the token from the keyring when available,
otherwise from the paths above. Bearer tokens are **not** read from process
environment variables; use `squadrules login` and the shared config file.

When keyring storage is active, `config.json` keeps non-secret sentinels:

```json
{
  "defaultUrl": "http://localhost:3300",
  "environments": {
    "http://localhost:3300": {
      "bearerToken": "__KEYCHAIN__",
      "refreshToken": "__KEYCHAIN__"
    }
  }
}
```

The `__KEYCHAIN__` marker means the secret is stored in the OS keychain and
must be resolved from there at runtime. The marker itself is never used as an
HTTP bearer token. The keyring service name is `squadrules-cli`; credentials
stored under the former `squadrules-cli` service are copied forward on first read.

**If absent:** Run `squadrules login` (browser PKCE or `squadrules login --token <token>`).
The CLI writes tokens (and API URL) to the keyring or, on fallback, to that
config file so MCP hosts can use it too.

**Refresh tokens:** After **browser PKCE** login, the CLI also stores a refresh
token when the IdP returns one (same keyring / file rules as the access token,
with a separate keyring entry). On **401**, the CLI refreshes the access token
before opening the browser again. If the JWT access token is within about **60
seconds** of expiry, the CLI refreshes proactively to reduce spurious 401s.

**`squadrules login --token`:** Stores **only** the access token you pass; any
previously stored refresh token is **cleared**, so later 401 handling will use
browser login (unless you run full PKCE login again).

Token storage behavior is:

1. **OS keyring first** when available
2. **config-file fallback** when keyring access is unavailable or fails

Copying `config.json` to another machine does not copy keychain secrets. A file
that only contains `__KEYCHAIN__` entries will not authenticate unless matching
keychain items exist on that machine.

### Login methods

#### Browser PKCE login

```bash
squadrules login
```

The CLI:

- discovers auth endpoints from `/.well-known/oauth-protected-resource`
- uses the public client ID `squadrules-cli` (the Keycloak default; override with
  `KEYCLOAK_CLI_CLIENT_ID`)
- binds a local callback port
- exchanges the code for an access token
- stores the token for the current API URL

If you do not want the browser to open automatically:

```bash
squadrules login --no-browser
```

To pin the callback port:

```bash
export SQUADRULES_LOGIN_CALLBACK_PORT=38123
squadrules login
```

#### Store an existing token

```bash
squadrules login --token <bearer-token>
```

This validates the token with `GET /api/me` before storing it. It does **not**
obtain or store a refresh token.

### Logout and token inspection

```bash
squadrules logout
squadrules token
squadrules token --validate
squadrules token --login
```

- `logout` clears the stored access and refresh credentials for the current API URL
- `token` prints the stored token to stdout
- `token --validate` checks it with `GET /api/me`
- `token --login` performs browser login first if no token exists

## Commands

### `activate`

Match stored adapters for a user phrasing (plain-text query).

```bash
squadrules activate ai coding standards
```

This calls `POST /api/activate` and prints the JSON response (choices and
`next_action`).

### `forward`

Run the first or next adapter layer. For a **new** run, pass an **adapter** URI
from **`activate`** and **omit** `--solution`. For later steps, pass the
**layer** URI from the prior response (include `?execution_id=` when the server
returned one) and a `--solution` JSON object whose `type` matches the current
`contract`.

```bash
squadrules forward squadrules://adapter/<uuid>
squadrules forward 'squadrules://layer/<uuid>?execution_id=<id>' --solution '{"type":"comment","comment":{"text":"done"}}'
```

The server emits `squadrules://` URIs as the canonical stored form; echo them back
verbatim. `squadrules://` is also accepted on input as an alias for the same
adapter and layer URIs.

### `train`

Register one adapter from a markdown file, or many from a directory of `.md`
files.

```bash
squadrules train adapter.md --model "gpt-4.1"
squadrules train adapter.md --model "gpt-4.1" --force
squadrules train ./bundle --force
squadrules train ./bundle --force --recursive
```

Options:

- `--model <model>` — sent as `llm_model_id` (required for single-file train)
- `--force` — replace an existing adapter with the same label when allowed
- `--recursive` — when the path is a directory, include nested `.md` files

Directory-batch behavior:

- non-recursive by default
- skips files whose basename is exactly `README.md`
- prints one JSON batch object with per-file results

### `tune`

Update one or more adapter or layer URIs.

```bash
squadrules tune squadrules://adapter/<uuid> --file updated.md
squadrules tune squadrules://adapter/<uuid> --updates '{"tags":["updated"]}'
squadrules tune squadrules://layer/<a> squadrules://layer/<b> --files a.md b.md
squadrules tune squadrules://layer/<uuid> --updates '{"text":"new content"}'
```

Use one of:

- `--file`
- `--files` (one path per URI)
- `--updates`

Use `tune` for in-place adapter/layer edits. For structural adapter changes
(for example, changing title identity or layer count), re-train with force:

```bash
squadrules train adapter.md --model "gpt-4.1" --force
```

### `delete`

Delete one or more adapters or layers by URI.

```bash
squadrules delete squadrules://adapter/<uuid>
squadrules delete squadrules://layer/<a> squadrules://layer/<b>
```

### `reward`

Attach a reward outcome to the **final layer** URI for a completed run (see tool
docs for `execution_id` when applicable).

```bash
squadrules reward squadrules://layer/<uuid> success "Completed successfully"
squadrules reward 'squadrules://layer/<uuid>?execution_id=<id>' failure "Validation failed"
```

Options:

- `--score <number>` — normalized score in `0..1`
- `--rater <id>` — evaluator identifier
- `--rubric-version <version>`
- `--model <model>` — `llm_model_id` for attribution

### `export`

Export an adapter or layer as markdown or training JSONL.

```bash
squadrules export squadrules://adapter/<uuid>
squadrules export squadrules://layer/<uuid> --format reward_jsonl --output json
```

Options:

- `--format` — `markdown` (default), `trace_jsonl`, `reward_jsonl`,
  `sft_jsonl`, or `preference_jsonl`
- `--output` — `text` (default) for raw content, or `json` for the full API response

## Common flows

### Activate → forward (loop) → reward

```bash
squadrules activate "release checklist"
squadrules forward squadrules://adapter/<uuid>
squadrules forward 'squadrules://layer/<step-uuid>?execution_id=<id>' --solution '{"type":"comment","comment":{"text":"done"}}'
squadrules reward 'squadrules://layer/<last-layer-uuid>?execution_id=<id>' success "Run completed"
```

### Batch train a bundle

```bash
squadrules train ./adapters --force --recursive
```

## Run from this repo against the local dev server

After the local dev server is ready (port from `.env` **`SERVER_PORT`**, commonly `3300` in the template):

```bash
npm run dev:cli-ready
npm run cli:dev -- activate "test"
```

`npm run dev:cli-ready` performs an auth-ready check for the local dev setup.

## Troubleshooting

### `squadrules: command not found`

Check Node.js version and reinstall:

```bash
node --version
npm install -g @squadrules/mcp
```

### Connection refused / timeout

Verify the target server:

```bash
curl http://localhost:3000/health
```

Also confirm you are using the intended `--url` or `SQUADRULES_API_URL`.

### The CLI says authentication is required

Run:

```bash
squadrules login
```

or store an existing token:

```bash
squadrules login --token <bearer-token>
```

### A stored token is not being used

Remember that tokens are stored per normalized API base URL. A token for
one host/port pair (for example `http://localhost:3300`) is different from a token for another (for example `http://localhost:3000`).

## Related docs

- [Install index](install/README.md)
- [Environment variables and secrets](install/prerequisites.md)
- [Cursor and MCP](install/README.md#cursor-and-mcp)
- [Architecture (project Wiki)](https://github.com/SquadRules/mcp/wiki)
- [Adapter examples](examples/README.md)
