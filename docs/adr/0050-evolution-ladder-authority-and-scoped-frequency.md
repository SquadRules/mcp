# ADR 0050: The evolution ladder's rungs carry an allowlist, a deferral, and a scope

## Status

**Accepted** — implemented and verified on branch `fix/squadrules-6-gap-remediation-293` on
2026-11-11; refines [ADR 0046](0046-evidence-gated-evolution-proposals.md) without changing
its decision, which stays Accepted and is not edited. Filed because 0046 left three
questions to the implementation — what makes evidence sufficient, whether the expert rung
is reachable, and what "the same anomaly" counts — and the answers are decisions, not
details.

## Context

ADR 0046 fixed the *ordering* of the consensus ladder (evidence → authorized human expert →
two-thirds of distinct agents → branch) but left each rung's admission rule implicit. The
implementation that landed interpreted those silences, and the interpretations were
weaker than the record read:

1. **Rung 1 admitted any structured object.** 0046 §5 said a confirmation "carrying
   evidence" decides its side. The code treated evidence as sufficient whenever it was an
   object with a key other than `note`, so one caller-shaped dictionary decided a proposal
   before a vote was read. 0046 §3 already rejects "a digest is not truth"; the same
   objection applies to "a dictionary is not evidence".
2. **Rung 2 was a thrown error.** The rung is unreachable today, because the runtime
   resolves an authenticated *subject*, never a role. That was expressed as an ad-hoc
   `throw` inside the settle path, so callers could only match a message, and nothing
   recorded that the unreachability is a decision rather than a bug.
3. **Rung 3 counted by routing slug.** 0046 §4 says three or more *distinct children* report
   "the same routable anomaly". The code aggregated anomalies by `routes_to` alone, so a
   same-slug adapter in another space, or a different contested field on the same target,
   could move a threshold it had no bearing on — the exact "one child moves a global
   threshold" failure 0046 rejects for executions, reintroduced through scope.

## Decision

### 1. Rung 1 is a closed allowlist with required provenance

`EVIDENCE_SUFFICIENCY_ALLOWLIST`
(`src/services/graph-db/evolution/consensus.ts`) names the only two kinds something other
than the claimant produces, and the fields each must carry:

| Kind | Asserts | Required provenance |
| --- | --- | --- |
| `deterministic-contradiction` | a primitive domain property or an opposing rule statement differs from the stored parent | `detected_from`, `contradiction_kind` (`property` \| `rule`), `target_adapter_version` |
| `reward-failure` | a reward proof recorded a failure for the target adapter | `uri`, `outcome` (`failure`), `target_adapter_version` |

Anything else — a note, an arbitrary dictionary, a recognized kind missing its provenance —
is **attached, not verified-sufficient**: it is recorded and echoed on
`attached_unverified_evidence`, and it never decides the rung. `classifyEvidence()` returns
`absent`, `attached-unverified` or `verified-sufficient`, and `decided_by` names the
verified case so the two remain distinguishable in tool output.

### 2. Rung 2 is deferred as a value, not a message

`confirmProposal()` fails closed with `EXPERT_AUTHORITY_DEFERRED`
(`'expert_authority_deferred'`) carried on `ExpertAuthorityDeferredError`; its `deferral`
names the reason (`no-trusted-expert-role-source`), the rung it belongs to, and the recovery
action. A `human_expert` label supplied by the caller is never accepted as authority, and
is never silently recorded as an agent vote — that would let the caller choose which rung
reads their confirmation.

`consensus.ts` keeps the rung intact (`human_expert` **and** `auth-subject`), so a future
trusted role mapping activates it without redesigning the ladder.

### 3. Rung 3 counts the exact scoped target and the exact claim

Three or more distinct children must report the *same* claim against the *same* scoped
adapter. "Same target" is the scoped key `adapter:<spaceId>:<slug>`, "same claim" is
`metadata.field` compared case- and whitespace-insensitively, both resolved by
`evolution/scoped-frequency.ts`. Anomalies record `target_key` / `target_space_id` at
creation time; rows written before those fields existed are matched by a deliberately
narrow documented rule (the reporter is in the target's own scope, or the target is the
app-space adapter every scope may inherit from), never by dropping them silently. Counts
are bounded by a read window and report `truncated`, so a filled window is presented as a
floor rather than as the population.

## Consequences

**Positive**

- A proposal cannot be decided by one caller-shaped object; the deciding evidence is
  produced by the detector or the reward path, and the output says which.
- The unreachable rung is an auditable value with a stable code, so tests assert the
  deferral instead of matching a message, and the ladder stays whole for the mapping that
  will activate it.
- Thresholds move only for the adapter and claim they are about, in the scope the decision
  concerns.

**Negative**

- Two evidence kinds are covered and no more: a new detector needs a matching allowlist
  entry, which is the intended review gate, not a limitation to work around.
- An expert confirmation cannot be recorded until a trusted role source exists.
- Scope resolution for pre-target rows has a documented narrow fallback, so a historical
  row may go uncounted where its scope cannot be proven.

## Evidence

- `src/services/graph-db/evolution/{consensus,scoped-frequency,evolution.service}.ts`,
  `src/services/graph-db/adapter-evolution-hooks.ts`,
  `src/services/graph-db/adapter-evolution-facts.ts`, `src/tools/reward-evolution.ts`,
  `src/tools/reward-anomaly.ts`.
- `tests/integration/graph-db-scoped-frequency.test.ts` (real LadybugDB + real LanceDB) and
  `tests/integration/graph-db-evolution.test.ts`: allowlist admission, attached-unverified
  relabelling, the deferral value, same-slug-different-scope isolation, and window
  truncation disclosure.
- `tests/unit/evolution-consensus-boundary-node.test.mjs` and
  `tests/unit/evolution-integrity-node.test.mjs` pin the ladder's boundaries.

## Alternatives considered

- **Keep "any structured evidence decides".** Rejected: it makes the deciding rung a
  caller-controlled branch, the same spoof 0046 rejects for `human_expert`.
- **Delete the expert rung until the mapping exists.** Rejected: deleting a rung changes
  the decision 0046 made and loses the place where the mapping lands.
- **Keep matching the deferral by message text.** Rejected: a message is not a contract;
  a caller cannot branch on it safely.
- **Count distinct (child, scope) pairs without a claim identity.** Rejected: two children
  contesting different fields of one parent are not three reporters of one claim, and
  summing them moves the threshold for a claim nobody agreed on.

## Reopening trigger

Revisit if: a trusted expert-role source becomes available (activate rung 2 and supersede
this record), a third evidence producer appears (extend the allowlist by its own record),
or anomaly volume makes the frequency window routinely saturate so a floor is no longer an
honest count.
