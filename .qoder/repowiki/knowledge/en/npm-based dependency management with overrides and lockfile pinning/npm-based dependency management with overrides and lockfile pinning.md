---
kind: dependency_management
name: npm-based dependency management with overrides and lockfile pinning
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - docs/adr/0005-cache-keys-under-release-stamping.md
    - docs/adr/0014-always-latest-mcp-spec-and-sdk.md
    - docs/adr/0030-tokenizers-arm64-native-binding-override.md
    - .agents/skills/squadrules/references/install.md
    - .agents/skills/squadrules/references/updates.md
    - docs/CLI.md
---

## System / Approach

The repository is a Node.js/TypeScript project managed through npm. Dependency declarations live in a root `package.json` (not visible to this extraction due to scope exclusion) and are resolved via a `package-lock.json` lockfile. There is no vendored `node_modules/`, no private registry configuration visible in source, and no monorepo workspaces setup — the codebase is a single npm package published as `@squadrules/mcp`.

## Key Files

- `package.json` — declares dependencies, devDependencies, `overrides`, scripts, and the package name `@squadrules/mcp`. It is also the source of truth for version stamping (ADR-0005).
- `package-lock.json` — locks transitive resolution; ADR-0030 documents that the arm64 tokenizer binding was pinned here after adding an override.
- `docs/adr/0005-cache-keys-under-release-stamping.md` — ties artifact cache keys to the `package.json` version.
- `docs/adr/0014-always-latest-mcp-spec-and-sdk.md` — pins `@modelcontextprotocol/sdk` at `^1.32.1` in `package.json`.
- `docs/adr/0030-tokenizers-arm64-native-binding-override.md` — documents the use of `package.json` `overrides["@anush008/tokenizers"] = "^0.6.0"` to force a native-binding-compatible version across the tree.
- `.agents/skills/squadrules/references/install.md` and `references/updates.md` — document end-user install/update commands (`npm install -g @squadrules/mcp`, `npm install -g @squadrules/mcp@latest`).
- `docs/CLI.md` — references `npm install -g @squadrules/mcp` and `npx -y @squadrules/mcp activate ...` as the public surface.

## Architecture and Conventions

- **Single-package layout**: all source under `src/`; no sub-packages or workspaces. Internal modules import each other via relative paths (e.g. `../tools/activate_schema.js`), not via scoped packages.
- **Dependency declaration location**: third-party libraries are declared only in the root `package.json`; nothing is vendored into the repo.
- **Lockfile discipline**: `package-lock.json` is committed and used as the canonical resolution snapshot. ADR-0005 explicitly uses the `package.json` version as part of cache-key computation, making the manifest part of the build identity.
- **Override strategy**: targeted transitive fixes go through the npm `overrides` field rather than patching downstream packages. ADR-0030 prescribes pinning `@anush008/tokenizers` to `^0.6.0` via `overrides` so that `linux/arm64` installs resolve a native binding; consumers of this package must maintain their own override because npm ignores nested overrides.
- **Version ranges**: documented dependencies use caret ranges (e.g. `^1.32.1` for `@modelcontextprotocol/sdk`), allowing minor/patch upgrades while keeping major versions stable.
- **Publishing identity**: the package is published under the `@squadrules/mcp` scope. End-user installation is via `npm install -g @squadrules/mcp` or one-shot `npx -y @squadrules/mcp` (ADR-0008). The CLI entrypoint is exposed by the package's `bin` field (implied by the `squadrules` command).

## Conventions and Constraints

- Dependencies are declared in the root `package.json` only; no per-directory manifests were found.
- Transitive dependency conflicts are resolved via `package.json` `overrides` rather than manual patches or forked copies (ADR-0030).
- The `package.json` version participates in artifact cache keys, so changing it changes built artifact identity (ADR-0005).
- The MCP SDK dependency is pinned to `^1.32.1` in `package.json` (ADR-0014); updating it requires following the "always latest MCP spec and SDK" policy documented there.
- Native bindings (specifically `@anush008/tokenizers`) require an explicit override to `^0.6.0` on platforms like `linux/arm64`; without it, fastembed fails to resolve a usable binding (ADR-0030, known issues doc).
- Consumers installing this package cannot rely on nested `overrides` from their own `package.json` being applied — they must add their own override if they need a different tokenizers version (ADR-0030).
- No private registry, `GOPRIVATE`, or vendor directory conventions exist in this repo; dependency sourcing is exclusively the public npm registry.