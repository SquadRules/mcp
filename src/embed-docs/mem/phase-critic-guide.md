---
version: "5.10.1"
slug: phase-critic-guide
title: Phase Critic Guide (Redirect to Critic Loop Guide)
---

# Phase Critic Guide (Redirect to Critic Loop Guide)

`phase-critic-guide` was renamed to **`critic-loop-guide`** in 5.4.0. This is a
redirect tombstone kept so the retired slug still resolves. It carries no rules
of its own — read **`squadrules://adapter/critic-loop-guide`** for the current
critic-loop integration, the solution-check-vs-critic decision table, and the
proof-splitting rules. Do not author against this slug.

## Activation Patterns

**Typically invoked by:** an agent or adapter that still references the retired
`phase-critic-guide` slug.

**Can be invoked directly when agent needs:**
- "phase critic guide" — the retired name for the critic-loop guide

**Must Never:**
- Restate the integration rules here; they live in `critic-loop-guide`.

**Must Always:**
- Point the reader to `squadrules://adapter/critic-loop-guide`.

## Redirect

`critic-loop-guide` is the single home for critic-loop integration and mutation
gate placement. Activate `squadrules://adapter/critic-loop-guide` and read it
there. See ADR 0010 (the rename) and ADR 0012 (why the tombstone is kept).

```json
{"contract":{"type":"comment","comment":{"min_length":40},"required":true}}
```

## Reward Signal

The reader was directed to `squadrules://adapter/critic-loop-guide`, so the
retired slug resolved instead of dangling.
