<!-- squadrules-compat-surface: emits/dual-accepts canonical kairos:// and ui://kairos/* URIs so existing stored URIs and clients keep resolving -->
# SquadRules adapter bundles

A bundle is a directory of adapter markdown files stored outside the SquadRules
server, usually in Git. Bundles are useful when you want reviewable source
files for adapters, export snapshots from a space, or bulk-import a set of
documents.

## Bundle layout

Recommended layout:

- one adapter per `.md` file
- optional subdirectories by topic or team
- optional `README.md` files for humans

Every adapter markdown file still has to satisfy the normal `train` requirements
enforced by the server:

- H1 title
- `## Activation Patterns` as the first H2
- `## Reward Signal` as the last H2
- at least one trailing ````json` challenge block somewhere in the file

## Bulk import with the CLI

The CLI can train from a whole directory.

### Top-level only

```bash
squadrules train --force /path/to/bundle-root
```

This imports only `.md` files directly inside the bundle root.

### Recursive import

```bash
squadrules train --force --recursive /path/to/bundle-root
```

This imports `.md` files from subdirectories too.

### `README.md` handling

In directory-batch mode, the CLI skips files whose basename is exactly
`README.md`. That rule applies at the root and in subdirectories. If you need
to register a `README.md` file, pass that file path explicitly instead of a
directory.

## Export from a running server

Use `squadrules export` or the MCP `export` tool to save current server
content before curating a bundle in Git.

```bash
squadrules export kairos://adapter/<uuid>
squadrules export kairos://layer/<uuid> --format reward_jsonl --output json
```

`export` works one adapter or layer URI at a time. If you want a
reviewable bundle, export the specific protocols you need and place the
resulting markdown files in a directory that follows the layout above.

## Practical guidance

- Use `squadrules train --recursive` when your bundle is already a nested
  directory tree and you want recursive import.
- Use `squadrules export` or the MCP `export` tool when you need current
  server content before curating a bundle in Git.

## Caveats

- Only the exact basename `README.md` is skipped in CLI directory-batch mode.
- `export` works one URI at a time; it does not recreate a directory
  tree for you.
