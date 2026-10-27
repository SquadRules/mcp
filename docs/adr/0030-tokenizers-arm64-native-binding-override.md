# 0030 — Pin @anush008/tokenizers to ^0.6.0 via root npm override for arm64 native bindings

Status: Accepted — implemented on this branch (`package.json` `overrides`,
`package-lock.json` resolved to 0.6.0 with all six platform bindings present).
Date: 2026-10-24

## Context

The built-in embedding path uses `fastembed` (`^3.0.0`), which depends on
`@anush008/tokenizers: "^0.0.0"`. Under npm semver `^0.0.0` resolves to exactly
`0.0.0`, and that published version declares only three napi optional
dependencies — `darwin-universal`, `linux-x64-gnu`, and `win32-x64-msvc`. There
is **no `linux-arm64` binding at 0.0.0**.

The practical gap is Linux on arm64, not the Mac. `darwin-universal` already
covers Apple Silicon Macs, so native macOS was never broken. The failing case is
a `linux/arm64` environment — most directly this repository's `.devcontainer`
when the Docker host is an Apple Silicon Mac, where the container is
`linux/arm64` and `require('@anush008/tokenizers')` finds no matching binding.

`@anush008/tokenizers` `0.6.0` publishes the full matrix, including
`linux-arm64-gnu` and `linux-arm64-musl`. Issue
[#173](https://github.com/SquadRules/mcp/issues/173) asked for a root npm
`overrides` entry to force that version.

## Decision

Add `"@anush008/tokenizers": "^0.6.0"` to the root `package.json` `overrides`
block and refresh `package-lock.json`. The lockfile now resolves
`@anush008/tokenizers` to `0.6.0` with all six optional bindings
(`darwin-universal`, `linux-arm64-gnu`, `linux-arm64-musl`, `linux-x64-gnu`,
`linux-x64-musl`, `win32-x64-msvc`). No source, runtime-mode, provider, or
public-API behaviour changes; `fastembed` is still lazily imported, so the native
binding loads only when the embedded provider is selected.

## Consequences

- `linux/arm64` installs (including the `.devcontainer` on Apple Silicon hosts)
  resolve a matching native tokenizer binding instead of failing at load.
- **The override does not propagate to consumers.** npm applies `overrides` only
  from the root package being installed; a published `@squadrules/mcp` tarball's
  nested override is ignored by downstream installs. The sibling
  [`SquadRules/containers`](https://github.com/SquadRules/containers) image build
  must therefore keep its **own** `@anush008/tokenizers` override — this record
  does not replace it.
- `0.6.0` is **archived/deprecated upstream**: the registry marks it
  `deprecated: "This package has been archived. Please use the official and
  updated 'huggingface/tokenizers' package."` We pin to it deliberately because
  it is the version that carries the arm64 napi matrix and is API-compatible with
  what `fastembed@3` expects; the deprecation is a reason to revisit, not a
  blocker for this fix.
- The override is a transitive-version pin, so a future `fastembed` that raises
  its own `@anush008/tokenizers` floor (or migrates to `huggingface/tokenizers`)
  can make this entry redundant or conflicting; it should be removed at that
  point.

## Alternatives considered

- **Do nothing / document a manual workaround:** rejected — the `.devcontainer`
  on Apple Silicon is a first-class contributor path and should install cleanly.
- **Fork or patch `fastembed` to raise its tokenizers floor:** rejected as
  disproportionate; a root override achieves the same resolution locally without
  carrying a fork.
- **Pin to a non-deprecated tokenizers line:** not available — `0.6.0` is the
  latest published `@anush008/tokenizers` and the only one with the arm64
  bindings; the maintained successor is a different package
  (`huggingface/tokenizers`) that `fastembed@3` does not consume.

## Evidence

`package.json` (`overrides["@anush008/tokenizers"] = "^0.6.0"`),
`package-lock.json` (`node_modules/@anush008/tokenizers` version `0.6.0` with the
six `optionalDependencies`, including `@anush008/tokenizers-linux-arm64-gnu` and
`-linux-arm64-musl`),
`tests/unit/tokenizers-arm64-override.test.ts` (asserts the override and the
resolved lockfile version/bindings),
`src/services/embedding/fastembed-provider.ts` (lazy `import('fastembed')`).
Issue [#173](https://github.com/SquadRules/mcp/issues/173).

## Related

- [ADR 0004](0004-fastembed-default-for-testing.md) — fastembed as the embedded
  CI provider.
- [ADR 0021](0021-embedding-provider-auto-resolution-and-store-width-binding.md) —
  embedding provider auto-resolution; unchanged by this dependency pin.

## Reopens when

`fastembed` raises its `@anush008/tokenizers` floor above `0.0.0` or migrates to
`huggingface/tokenizers` (making this override redundant or conflicting), or the
`0.6.0` deprecation turns into a removal/security problem that forces a different
resolution — then revisit via [#173](https://github.com/SquadRules/mcp/issues/173).
