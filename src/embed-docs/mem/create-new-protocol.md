---
version: "5.9.6"
slug: create-new-protocol
title: Create New Protocol (Redirect to Author Adapter)
---

# Create New Protocol (Redirect to Author Adapter)

`create-new-protocol` was renamed to **`author-adapter`** in 5.6.0. This adapter
is a redirect tombstone: it exists only so a stored adapter that still chains to
`squadrules://adapter/create-new-protocol` resolves and is sent to the replacement
instead of dangling. It carries no authoring logic. Do not author new adapters
against this slug — use `squadrules://adapter/author-adapter`.

## Activation Patterns

**Typically invoked by:** a stored adapter that still forwards to the retired
`create-new-protocol` slug.

**Can be invoked directly when agent needs:**
- "create new protocol" — the retired name for the author adapter

**Must Never:**
- Perform any authoring itself; this tombstone only redirects.
- Be used as the target of a new adapter chain.

**Must Always:**
- Send the caller to `squadrules://adapter/author-adapter`, forwarding the same
  context it received.

## Redirect

Forward to the replacement and continue the run there. `author-adapter` is the
create / review / update lifecycle that replaced `create-new-protocol`; its
integration rules live in the adapter itself. See ADR 0016 (the rename).

```json
{"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/author-adapter"}},"required":true}}
```

## Reward Signal

The caller reached `squadrules://adapter/author-adapter`, so the retired slug
resolved and redirected instead of dangling.
