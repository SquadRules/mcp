# ADR 0046: Evidence-gated evolution — anomalies propose, consensus authorizes, normal train/tune applies

## Status

Accepted — implemented and verified on branch `sr6-graph-db-touchpoints` on 2026-11-06;
landed on `squadrules-6` via [PR #296](https://github.com/SquadRules/mcp/pull/296)
squash-merge commit `40af9c75` on 2026-11-09 with all thirteen required CI gates green
including both embedded and Arango-shared evolution suites in the `verify-integration-graph`
lane; reconciled by agent on 2026-11-09 under the documentation-authority ADR-status rule.

Implements the resolution rules of
[`docs/specs/ontological-knowledge-system.md`](../specs/ontological-knowledge-system.md)
§ Layer 4 and Decisions 1/5/6/7 on top of
[ADR 0042](0042-graph-owned-by-runtime-scoped-keys-derived-topology.md) (graph-native
`Anomaly`) and [ADR 0045](0045-graph-native-history-and-restore.md) (history + CAS).

## Context

### 1. The spec named four triggers but not who may act on them

The knowledge system says a parent changes when a contradiction is core, when ≥3 children
report the same anomaly, when an anomaly is instance-specific, or when it is a domain
variation. It does not say how a system distinguishes "a child observed reality" from "a
child hallucinated a contradiction", nor what a system is allowed to do with either.

### 2. Auto-rewriting a parent is unauditable and irreversible

If `reward`/`train` rewrote the parent directly, a single failed run could restructure a
shared adapter, and no record would say which observation caused which edit. The parent
would also skip validation, because the rewrite path is not a `train`.

### 3. A digest is not truth

Hashes prove that bytes did not change. They say nothing about whether the claim inside
those bytes is correct. Any design that "verifies" a free-text contradiction by hashing it
is claiming semantic verification it does not have.

### 4. Frequency is about distinct reporters, not attempts

Three failures from one child is one observation repeated. Three failures from three
children is a pattern. A threshold that counts executions lets one child raise the bar for
everyone.

## Decision

### 1. Anomalies are recorded, never resolved, by the write path

- Explicit `anomaly:` frontmatter on a trained document is persisted as an `Anomaly` node
  with `source_child` (the scoped child key) and scope metadata.
- `reward` records a failure anomaly through the same node type.
- Both are proposals-only: they never edit the parent.

### 2. Automatic detection is restricted to what is empirically deterministic

`evolution/detection.ts` compares only:

- **primitive domain properties** — a boolean or number that differs between child and
  parent (`has_fur: true` vs `has_fur: false`, `timeout: 30` vs `timeout: 60`); and
- **opposing rule statements** — a child `Must Never` line equal (after normalization) to
  a parent `Must Always` line, or the reverse.

Non-domain and non-primitive fields are excluded by name (`NON_DOMAIN_FIELDS`). Free-text
semantic disagreement is **not** detected automatically; it needs a proposing caller or a
human. The detector asserts no semantic verification and hashes nothing.

### 3. A proposal is a scoped, verifiable record

`EvolutionProposalNode` persists: `target_key`, `target_slug`, `space`, `change_type`
(`parent_update` | `subcategory_split`), `field`, `from_value`, `to_value`, `reason`,
`source_child`, `source_anomaly`, `evidence`, `evidence_digest`, `status`,
`required_confirmations`, `created_at/by`, `actor_source`.

- The key is deterministic (`proposal:<sha256[:32]>` over target + field + source child +
  to-value), so re-running the same observation does not create a second proposal.
- `source_child` is the scoped child key, so "unique source child" is checkable.
- `evidence_digest` proves the evidence bytes; the record states that it is an integrity
  proof, not a truth proof.

### 4. Frequency is distinct children

`required_confirmations` is `3` when three or more **distinct** children already report the
same routable anomaly, and `1` otherwise. `distinctConfirmedChildren()` counts distinct
`distinct_child` values on confirmations; duplicate actors collapse to one vote.

### 5. Consensus follows one ladder, and duplicate confirmers cannot vote twice

`evolution/consensus.ts` (`evaluateConsensus`), in order:

1. **Evidence** — a confirmation carrying evidence on each side is a conflict → `branch`;
   evidence on one side decides that side.
2. **Authorized human expert** — `actor_kind: "human_expert"` **and**
   `actor_source: "auth-subject"`; identity resolved by the runtime from the authenticated
   subject, never from a document field.
3. **Two-thirds of distinct agents** — `ceil(required × 2 / 3)` distinct agent actors, and
   the frequency bar (≥3 distinct children) when the proposal demanded it.
4. Otherwise **pending**, or **branch** when rejections reach the confirmation count.

Confirmation identity is `proposal + actor`, so a repeated confirmation from the same
identity is one vote. The record cannot be spoofed by repeating a name.

### 6. Acceptance hands back a plan; it never writes the parent

`settleProposal()` returns an `EvolutionApplyPlan` naming the target URI, the field, the
from/to values, the **observed target version** as `expected_version`, and instructions
that name the ordinary `tune` call. Applying it is a normal, validated write that appends
history ([ADR 0045](0045-graph-native-history-and-restore.md)). Rejected/branched
proposals leave the parent byte-identical and carry an actionable next step.

### 7. Conflicts leave no partial state

Every proposal/confirmation write is a single document insert (unique keyed) on the
embedded backend and a single stream-transaction unit on Arango
([ADR 0044](0044-graph-repository-port-and-arango-shared-backend.md) §5). A status update
that loses to a concurrent settle is reported, not force-applied.

## Consequences

**Positive**

- Every parent change has a traceable cause: anomaly → proposal → confirmations → apply.
- Nothing silently rewrites a shared adapter.
- The deterministic detector cannot claim more than it proves.
- Duplicate confirmers and repeated executions cannot manufacture quorum.

**Negative**

- Semantic contradictions need a human or an explicit proposing caller; automatic coverage
  is intentionally narrow.
- A proposal accepted against version *N* must be re-based if the parent moves to *N+1*;
  the plan carries `expected_version` so the write fails closed instead of applying stale
  content.
- There is no automatic cleanup of superseded proposals.

## Evidence

- `src/services/graph-db/evolution/{detection,consensus,evolution.service}.ts`,
  `src/services/graph-db/adapter-evolution-hooks.ts`, `src/tools/reward-evolution.ts`,
  `src/tools/reward-anomaly.ts`, `src/tools/reward.ts`.
- `tests/integration/graph-db-evolution.test.ts` (real LadybugDB + real LanceDB):
  explicit anomaly persistence, deterministic detection, ≥3-distinct-children threshold,
  duplicate confirmer without quorum, conflict → branch with no adapter mutation, apply
  plan against the current version, descendant validation.

## Alternatives considered

- **Auto-apply accepted proposals.** Rejected: it bypasses validators and history and makes
  a shared parent mutable by a single run.
- **Semantic detection via an LLM judge inside the write path.** Rejected for now: it is a
  new authority surface that cannot be audited deterministically; consensus exists for
  exactly that judgment.
- **Count executions instead of children.** Rejected: one child can then move a global
  threshold.
- **Trust a `human_expert` claim in the document.** Rejected: identity must come from the
  authenticated subject, otherwise the ladder is spoofable.

## Reopening trigger

Revisit if: a deterministic detector for a further primitive class is identified, semantic
verification gains a trustworthy authority (then it is its own ADR, not a detector tweak),
an accepted proposal must survive a parent version move without re-basing, or proposal
volume needs retention/archival.
