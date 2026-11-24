# Issue #297: CI gate for ADR 0049 shutdown-handler reproducer (SIGABRT regression protection)

> Archived 2026-11-24 when the SquadRules 6 workstream was benched (branch `squadrules-6` renamed to `archive/squadrules-6`).
> Source: https://github.com/SquadRules/mcp/issues/297 · opened 2026-11-09T13:47:43Z by @jakub-plichcinski · state at archive: OPEN · labels: none

## What

[ADR 0049](../blob/squadrules-6/docs/adr/0049-drain-handles-on-graceful-shutdown-instead-of-process-exit.md) accepted the drain-handles-on-shutdown rule and its mechanism shipped via [PR #296](https://github.com/SquadRules/mcp/pull/296) squash commit `40af9c75` on `squadrules-6` (2026-11-09, all thirteen CI gates green). The ADR's `SIGABRT` reproducer, however, was measured by scripts under `.local/` on the authoring host — those probes are gitignored scratch, not a CI gate.

Nothing currently in `integration.yml` / `ci-gate.yml` asserts:

1. That a graceful shutdown with a loaded `fastembed` model in the process drains its listeners and exits with `exitCode = 0` instead of being aborted by ONNX Runtime teardown.
2. That the drain-aware listener helper closes a listener that finishes booting after the signal (the mid-boot registration case corrected under "Evidence" in the ADR).
3. That the known remaining `process.exit()` sites listed in the ADR's "Known remaining exposure" section stay within the sanctioned CLI-error-path envelope, or that if any drifts into a server/harness boot path, a test fails.

## Why it matters

`onnxruntime-node` teardown aborts the process with `SIGABRT`/exit 134 whenever a live `InferenceSession` exists at `process.exit()` time. The ADR's mechanism prevents that; without a gate, a future refactor can regress it silently and only surface as an intermittent `Abort trap: 6` on a user's machine. This is exactly the class of "unauditable regression" the CI gate doctrine (see [ADR 0023](../blob/squadrules-6/docs/adr/0023-mandatory-ci-and-fail-closed-gates.md), [ADR 0031](../blob/squadrules-6/docs/adr/0031-ruleset-enforced-single-required-gate.md)) forbids.

## Scope for the fix

Add a required CI step or lane that boots the shipped server with `fastembed` loaded and:

- Sends `SIGTERM` and asserts the process exits with `code = 0` and prints the shutdown-complete marker;
- Asserts the listener helper's late-registration path closes the late listener (either a direct integration test against `registerDrainAwareListener` or the equivalent surface the ADR names);
- Greps the codebase for `process.exit(` inside `src/http`, `src/stdio`, `src/server.ts`, `src/bootstrap.ts`, `src/metrics-server.ts` (i.e. the boot/server paths) and fails if any appear there, leaving CLI-only sites (`src/cli/**`) permitted by ADR 0049;
- Uses `SQUADRULES_ONNX_MODEL` or equivalent to force a real model load so the abort condition is genuinely reachable in the CI env.

## Non-scope

- The three CLI `process.exit(1)` error paths named by the ADR — those are correct behaviour, not exposure, and this issue is not asking to remove them.
- Replacing `fastembed` with an out-of-process embedding provider (that's the ADR's reopen trigger, not this fix).

## References

- [ADR 0049 — Drain handles on graceful shutdown](../blob/squadrules-6/docs/adr/0049-drain-handles-on-graceful-shutdown-instead-of-process-exit.md), specifically "Known remaining exposure" and "Evidence".
- [ADR 0023 — Mandatory CI and fail-closed gates](../blob/squadrules-6/docs/adr/0023-mandatory-ci-and-fail-closed-gates.md).
- [ADR 0031 — Ruleset-enforced single required gate](../blob/squadrules-6/docs/adr/0031-ruleset-enforced-single-required-gate.md).

---

## Comments

None.
