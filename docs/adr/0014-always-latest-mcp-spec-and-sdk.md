<!-- squadrules-lint-allow-protocol-synonyms -->

# ADR 0014: Always track the latest Model Context Protocol spec and SDK

## Status

Accepted

## Context

SquadRules is a Model Context Protocol (MCP) server: it speaks the MCP wire
protocol over stdio and HTTP, and it depends on `@modelcontextprotocol/sdk` for
the transport, the server object, and the negotiated protocol revisions.

The MCP specification advances by dated revisions, and each revision can add
required or optional surfaces. The published spec has moved through
`2025-06-18`, `2025-11-25`, and most recently `2026-07-28` (which adds
`server/discover` for capability discovery). The SDK shipped in this repo is
`@modelcontextprotocol/sdk@^1.32.1`; its `LATEST_PROTOCOL_VERSION` is
`2025-11-25`, one revision behind the published spec, and its
`SUPPORTED_PROTOCOL_VERSIONS` list stops there too.

Pinning to a conservative SDK floor lets that gap widen silently: new hosts that
negotiate a later revision fall back to an older one, and newly added capabilities
never light up. Because the whole product is an MCP server, SDK currency is a
product concern, not a routine dependency chore.

## Decision

Track the latest published MCP spec revision and the latest SDK that implements
it. Concretely:

1. Hold `@modelcontextprotocol/sdk` at the newest release rather than a stale
   caret floor; treat an available major/minor as a scheduled task, not an
   optional upgrade.
2. When a newer SDK raises `LATEST_PROTOCOL_VERSION`, adopt it and align every
   spec-revision reference in the code and comments — for example the
   authorization-metadata note in `src/http/http-well-known.ts` that cites spec
   `2025-11-25`.
3. Adopt newly added or newly required surfaces (such as `server/discover` from
   the `2026-07-28` revision) once the SDK exposes them, so negotiation with
   current hosts uses the newest common revision.

The SDK major bump itself is executed as a separate dependency change
(fast-follow), not bundled into the CLI overhaul
([#47](https://github.com/SquadRules/mcp/issues/47)), to keep that change
reviewable and stable. Dependabot owns security PRs in this repo, so SDK
currency is a deliberate manual or scheduled dependency task — there is no
auto-merge rule to point at "latest".

## Consequences

### Positive

- **Interop with current hosts.** Negotiation lands on the newest common
  revision instead of silently downgrading.
- **New capabilities arrive on purpose.** Surfaces like `server/discover` are
  adopted deliberately rather than missed.
- **No hidden drift.** A single posture ("latest") removes the recurring argument
  about which revision to target.

### Negative

- **Major SDK bumps can break.** Each bump must run the stdio launch smoke and
  the integration lanes before merge; a new revision may require code changes
  (handlers, authorization metadata, capability declarations).
- **A moving target.** "Latest" is a commitment to keep upgrading, not a one-time
  change.

## Alternatives Considered

### Pin a known-good SDK floor and upgrade only on breakage

Rejected: it is the posture that produced the current one-revision gap, and it
defers interop and capability work until a host forces the issue.

### Track the spec but not the SDK

Rejected: the spec is only usable through the SDK's transport and negotiation;
tracking the document without the library that implements it changes nothing at
runtime.

## Evidence

- `package.json`: `"@modelcontextprotocol/sdk": "^1.32.1"`.
- Installed SDK `dist/esm/types.js`: `LATEST_PROTOCOL_VERSION = '2025-11-25'`;
  `SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26',
  '2024-11-05', '2024-10-07']`.
- `src/http/http-well-known.ts`: authorization-metadata comment citing spec
  `2025-11-25`.
- `src/stdio/stdio-server.ts` and `src/server.ts`: the server is created and
  connected through the SDK, so the negotiated revision is whatever the SDK
  pins — there is no separate version override in this repo.
- Published MCP spec revision `2026-07-28` (modelcontextprotocol.io) adds
  `server/discover`.

## Related

- [ADR 0015: CLI is local-by-default](0015-cli-local-by-default-transport-agnostic-backend.md)
- Issue [#47](https://github.com/SquadRules/mcp/issues/47): records this posture;
  the SDK bump is proposed as a fast-follow dependency change.
