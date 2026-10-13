# ADR 0016: Rename create-new-protocol to author-adapter + explicit authoring context

## Status

Proposed; implemented by the accompanying PR.

## Context

An adapter update routed to `create-new-protocol` was rejected by a host reviewer
as unrelated creation. The workflow already supported updates, but the slug name
misled reviewers into treating update intents as new creation. Its tool
description also blurred loading instructions with executing their actions.

## Decision

Rename `create-new-protocol` to `author-adapter`. The full authoring content
(create / review / update lifecycle) now lives under the `author-adapter` slug.
The old `create-new-protocol` slug becomes a one-layer redirect tombstone
following the `phase-critic` → `critic-loop` pattern (ADR 0012), so stored
adapters that still forward to `squadrules://adapter/create-new-protocol`
resolve and redirect instead of dangling.

Accept optional structured `authoring` context in activation and forward calls.
The caller supplies create, review, or update; review/update require an existing
target adapter URI. Explicit context selects the known authoring workflow without
semantic ranking. Ordinary discovery remains semantic. Do not guess target slugs
from display names or silently turn a missing target into creation.

Validate context before starting a run or processing proof. Persist it with the
execution and return it on subsequent layers and forward next calls. Reject
changes to the operation, target, or workflow during that run. Existing callers
without context remain compatible.

Describe forward's state writes, returned instructions, and possible elicitation
accurately. It does not execute returned shell or MCP contracts. Context is intent,
not an authorization token; host checks and separate mutation calls still apply.

The authoring workflow uses `tune` for identity/layer-preserving edits and `train`
replacement for required structural changes, with critic-loop evidence in both
cases. Repository-managed sources are edited in the task worktree.

## Consequences and evidence

The rename eliminates the creation/update ambiguity at the slug level. The
tombstone preserves backward compatibility for stored adapters chaining to the
old slug. Hosts can inspect operation and target before the first layer is
loaded, reducing ambiguity without overriding host policy.

Regression tests cover activation-to-forward context preservation, retired-slug
alias resolution, changed context rejection before proof processing, missing
targets, invalid operation/target combinations, and original calls. A
context-free original call still requires the agent to infer the operation from
the request.
