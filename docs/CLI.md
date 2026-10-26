# SquadRules CLI reference

Functional reference for the `squadrules` command-line tool: invocation, global
options, the command surface, and output formats. For the *why* behind the
runtime model see the architecture decision records linked at the bottom; for
internals derivable from code (HTTP/MCP API, workflow engine, memory) see the
project Wiki.

## Install and invocation

The package ships three equivalent binaries — `squadrules`, `sq`, and `sqr` —
all pointing at the same entry point.

```bash
npm install -g @squadrules/mcp
squadrules --help
```

Without a global install, `npx` runs the same entry point:

```bash
npx -y @squadrules/mcp activate "how do I deploy a release"
```

A bare invocation with no subcommand starts the MCP server over stdio (this is
how MCP hosts launch it); see
[ADR 0008](adr/0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md).

## Local by default

With no configuration, data commands run **in-process** against the embedded
LanceDB store — no server, no HTTP hop, no auth. The target resolves to the
local sentinel `stdio://local` (aliases `local` and `stdio`). See
[ADR 0015](adr/0015-cli-local-by-default-transport-agnostic-backend.md).

`squadrules login` persists an http `apiUrl`, which flips every later command to
a remote server. Target a server explicitly at any time with `--url`:

```bash
squadrules --url http://localhost:3000 spaces
```

The embedded store is shared per user and safe across multiple local processes;
see [ADR 0013](adr/0013-embedded-store-multiprocess-safety.md).

## Global options

These apply to every command and may appear before or after the subcommand.

| Option | Meaning | Default / env |
| --- | --- | --- |
| `-u, --url <url>` | API base URL, or `local` / `stdio` for in-process | `stdio://local`; `SQUADRULES_API_URL`, then saved config |
| `--timeout <seconds>` | Request timeout in seconds | 15; `SQUADRULES_TIMEOUT_MS` |
| `--retries <n>` | Max retries on network errors | 2; `SQUADRULES_RETRIES` |
| `--format <format>` | Output format: `auto`, `pretty`, `json`, `text` | `auto`; `SQUADRULES_FORMAT` |
| `--space <space>` | Space scope (`personal` or a group name) | personal |
| `--reseed` | Local mode: force delete-then-retrain of bundled adapters | off; `MEM_BOOT_FORCE_INJECT` |
| `--no-browser` | Never open a browser for auth | off |

## Output formats

`--format` controls how every data command renders:

- `auto` (default) — pretty on a terminal (TTY), JSON when piped or redirected.
- `pretty` — human-readable summary on stdout; the "next call" hint goes to stderr.
- `json` — the full structured response on stdout, including a single `next_call`
  object where one applies.
- `text` — a minimal plain-text rendering.

Because `auto` emits JSON when not attached to a terminal, scripts and pipes get
stable machine output with no extra flag:

```bash
squadrules activate "deploy a release" | jq -r '.choices[0].uri'
```

## Commands

### activate

Find the best matching adapter for a query.

```bash
squadrules activate <query...> [--space <space>]
```

### forward

Run the first or next layer of an adapter.

```bash
squadrules forward <uri> [--solution <json>]
```

### reward

Record a reward signal for an adapter execution. `outcome` is `success` or
`failure`.

```bash
squadrules reward <uri> <outcome> <feedback> \
  [--score <number>] [--rater <rater>] [--rubric-version <version>] [--model <model>]
```

### tune

Update one or more adapter layers. Provide `--file`, `--files`, `--updates`, or
`--space` alone for a move-only operation.

```bash
squadrules tune <uris...> [--file <file> | --files <files...> | --updates <json>] \
  [--space <space>] [--allow-sensitive-upload]
```

### delete

Delete one or more adapter or layer resources.

```bash
squadrules delete <uris...>
```

### spaces

List available spaces and adapter counts.

```bash
squadrules spaces [--include-adapter-titles]
```

### train

Register a new adapter from markdown, attach a text artifact to an adapter, or
fork an existing adapter. `--model` is required for fork (`--source-adapter-uri`)
and artifact (`--adapter`) modes, and is used for attribution otherwise.

```bash
# single markdown file
squadrules train ./my-adapter.md --model gpt-4 [--space personal] [--force]

# directory of markdown files (batch; quiet summary or JSON manifest)
squadrules train ./adapters --recursive --model gpt-4

# fork an existing adapter
squadrules train --source-adapter-uri squadrules://adapter/my-adapter --model gpt-4

# attach an artifact to an adapter
squadrules train ./notes.txt --adapter squadrules://adapter/my-adapter [--mime text/plain]
```

Artifact trains attach to an adapter that already exists, so a script ships in a
second call after its adapter markdown. `--adapter` takes the adapter **URI**
(`squadrules://adapter/<slug>`), so pin the slug in the adapter's frontmatter
rather than inferring the one `train` derived from the title, and pass `--force`
when the target artifact already exists. Artifact identity, the
`# squadrules-artifact:` header, and the rest of the artifact input contract: see
the `train` tool description.

- Directory batch: each `.md` becomes an adapter and every **sibling** file with a
  recognizable extension is attached to **every** `.md` in that directory, with
  `relative_path` taken from the batch root (and only when `--model` is set).
- `--adapter`, `--artifact-name`, `--mime`, and `--relative-path` are single-file
  only — a directory batch rejects them. A gate script that belongs to one adapter
  needs its own directory or a single-file `--adapter` train.

### export

Export adapters to disk. This is a machine-facing bulk command: it writes files
and prints only a compact summary (or a JSON manifest with `--format json`) — it
never dumps adapter or content bytes to stdout.

```bash
squadrules export [uri] [--adapters <uri-or-slug>...] [--all-adapters --space <name>] \
  [--as <format>] [--out <dir>] [--to <file>] [--zip-out <file>]
```

- `--as <format>` — content format: `skill_zip` (default), `markdown`,
  `skill_tree`, `source`, `trace_jsonl`, `reward_jsonl`, `sft_jsonl`,
  `preference_jsonl`.
- `--out <dir>` — write artifacts into this directory (default: current directory).
- `--to <file>` — write the payload of a single `<uri>` selection to this exact
  file path, creating parent directories. Requires a non-`skill_zip` `--as`
  format and cannot be combined with `--out` or `--zip-out`. Use it to place an
  artifact at the path a shell contract expects (the `materialize` command in an
  `activate` response uses it on stdio transport).
- `--zip-out <file>` — write `skill_zip` bytes to this explicit file path.

```bash
# every adapter in a space, as skill zips, into ./out
squadrules export --all-adapters --space personal --out ./out

# one adapter as flat markdown
squadrules export squadrules://adapter/my-adapter --as markdown --out ./out

# one artifact's source at an exact path (stdio materialize)
squadrules export squadrules://artifact/my-gate --as source \
  --to "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/my-gate.py"
```

### serve

Run the MCP server (stdio or HTTP). The root `--url` does not set the listen
address; use `--server-port` or `SERVER_PORT`.

```bash
squadrules serve [--transport <stdio|http>] [--server-port <port>] \
  [--metrics-port <n>] [--env-file <path>]
```

## Authentication (http targets only)

`login`, `token`, and `logout` need an OAuth server. Local mode has none, so
against the local sentinel they print guidance and fall back to
`http://localhost:3000`. Pass `--url http://<host>:<port>` to target a specific
server.

```bash
squadrules login --url http://localhost:3000   # browser PKCE, stores a bearer token
squadrules login --token <token>               # validate and store an existing token
squadrules token --validate                    # print the stored token (validate first)
squadrules logout                              # clear stored credentials for the current --url
```

After a successful `login`, the stored `apiUrl` makes later data commands use the
HTTP backend automatically.

## Environment variables

| Variable | Effect |
| --- | --- |
| `SQUADRULES_API_URL` | Default target (an http URL, or `local`/`stdio`) |
| `SQUADRULES_TIMEOUT_MS` | Default request timeout in milliseconds |
| `SQUADRULES_RETRIES` | Default max retries |
| `SQUADRULES_FORMAT` | Default output format |
| `MEM_BOOT_FORCE_INJECT` | Force boot re-injection (same as `--reseed`) |

## Related

- [ADR 0008: Bare CLI invocation defaults to stdio](adr/0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md)
- [ADR 0013: Embedded store multi-process safety](adr/0013-embedded-store-multiprocess-safety.md)
- [ADR 0015: CLI is local-by-default](adr/0015-cli-local-by-default-transport-agnostic-backend.md)
- [Architecture decision records index](adr/README.md)
