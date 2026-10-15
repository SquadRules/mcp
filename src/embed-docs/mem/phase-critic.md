---
version: "5.9.3"
slug: phase-critic
title: Phase Critic (Redirect to Critic Loop)
---

# Phase Critic (Redirect to Critic Loop)

`phase-critic` was renamed to **`critic-loop`** in 5.4.0. This adapter is a
redirect tombstone: it exists only so a stored adapter that still chains to
`squadrules://adapter/phase-critic` resolves and is sent to the replacement
instead of dangling. It carries no review logic. Do not author new adapters
against this slug — use `squadrules://adapter/critic-loop`.

## Activation Patterns

**Typically invoked by:** a stored adapter that still forwards to the retired
`phase-critic` slug.

**Can be invoked directly when agent needs:**
- "phase critic" — the retired name for the critic loop

**Must Never:**
- Perform a review itself; this tombstone only redirects.
- Be used as the target of a new adapter chain.

**Must Always:**
- Send the caller to `squadrules://adapter/critic-loop`, forwarding the same
  `work` submission (or the older-spelling `input_file`), `requirements`, and
  `context` it received.

## Redirect

Forward to the replacement and continue the run there. `critic-loop` is the
bounded, requirement-aware review that replaced `phase-critic`; its integration
rules live in `critic-loop-guide`. See ADR 0010 (the rename) and ADR 0012 (why
the tombstone is kept).

```json
{"contract":{"type":"mcp","mcp":{"tool_name":"forward","arguments":{"uri":"squadrules://adapter/critic-loop"}},"required":true}}
```

## Reward Signal

The caller reached `squadrules://adapter/critic-loop`, so the retired slug
resolved and redirected instead of dangling.
