# 0031 — Protect main with a repository ruleset that requires one always-on gate

Status: Accepted — applied to live repository settings on 2026-10-27 (ruleset
`25951418` created, classic branch protection deleted, verified through
`GET /repos/SquadRules/mcp/rules/branches/main`). Partially supersedes
[0023](0023-mandatory-ci-and-fail-closed-gates.md).
Date: 2026-10-27

## Context

`main` was governed by classic branch protection: `strict: true`,
`enforce_admins: true`, and three required contexts — `Integration workflow passed`,
`Security workflow passed`, `Automation policy passed` — all attributed to GitHub
Actions (`app_id: 15368`).

Two of those contexts come from workflows that declare `on.pull_request.paths`
filters ([integration.yml](../../.github/workflows/integration.yml),
[security.yml](../../.github/workflows/security.yml)). GitHub evaluates a trigger
path filter **before a run exists**, so a pull request that touches none of the
listed paths never queues the workflow and never produces its check run. A required
context with no check run stays "Expected" indefinitely and blocks the merge;
[GitHub's own troubleshooting guidance](https://docs.github.com/en/actions/how-tos/monitor-workflows/troubleshooting-required-status-checks#handling-skipped-but-required-checks)
states it plainly: "Avoid requiring workflows that can be skipped."

[Issue #196](https://github.com/SquadRules/mcp/issues/196) reports the deadlock, and
PR [#195](https://github.com/SquadRules/mcp/pull/195) — a `.qoder/agents/**`-only
change — demonstrated it on live state: head `297259dd` carried nine
`Automation policy passed` check runs, zero integration or security check runs, and
`mergeStateStatus: BLOCKED`, with no bypass available to anyone including admins.
`auto-update-pr-branches.yml` also refused to merge it, because its gate loop requires
a successful run of each of `integration`, `security` and `automation-policy`.

Two neighbouring mechanisms are routinely conflated with this one, and neither
explains the block:

- A **job** skipped by a conditional, or skipped because a `needs` job failed, does
  create a check run and reports Success. That is the fail-open ADR 0019 relied on and
  ADR 0023 removed; it is not what happens to a path-filtered workflow.
- **Step-level** `if: always()` creates no check run of its own. It cannot queue a
  workflow the trigger filters excluded and cannot make an absent required context
  report; it only decides whether steps still run inside a job that exists, so it
  bears on that job's check outcome, not on which checks GitHub waits for.

Required-ness comes only from the required-context list, so ADR 0023's instruction to
"keep … branch protection unchanged" is what had to be revisited.

## Decision

Protect `main` with a repository ruleset, not classic branch protection, and require
exactly one always-on gate:

- Ruleset `25951418` "main merge gate", `target: branch`, `enforcement: active`,
  `conditions.ref_name.include: ["refs/heads/main"]`, `bypass_actors: []`.
- Rule `required_status_checks` with `strict_required_status_checks_policy: true` and
  a single check: `Automation policy passed`, `integration_id: 15368`.
- Rule `pull_request` with `required_approving_review_count: 0` and
  `require_extra_approval_for_unattributed_changes: false`, preserving the previous
  "merge only via pull request, no approvals required" behaviour.
- Rules `deletion` and `non_fast_forward`, matching the prior
  `allows_deletions: false` / `allows_force_pushes: false`.
- Classic branch protection deleted, since protection and rulesets are enforced as a
  union while both exist.
- `bypass_actors` stays empty to preserve `enforce_admins: true` semantics. The older
  `main` ruleset (`24349936`) grants administrators an always-bypass for its own rules;
  it does not exempt anyone from this one.

`Automation policy passed` is the only context required because
`automation-policy.yml` carries **no** path filter — it queues on every pull request
event this repository uses, so the required context always reports and can never strand
a PR.

Rejected alternatives:

- **Widen the `paths` filters to cover `docs/**`, `.qoder/**` and `*.md`.** Rejected:
  every documentation PR would then run the full CLUSTER and SINGLE integration lanes
  plus CodeQL against unchanged source, which is the cost ADR 0023 accepted filters to
  avoid.
- **Put the required contexts into the existing `main` ruleset.** Rejected: its
  condition is `include: ["~ALL"]`, so it would demand `Automation policy passed` on
  pull requests targeting any branch, where that workflow only queues for `main` —
  reproducing this same block everywhere.
- **Keep classic protection and let a human re-run workflows.** Rejected: it makes the
  human the merge gate for documentation changes and cannot be automated.
- **Synthetic check runs for the missing contexts.** Rejected: it reports success for
  validation that never ran, which is the failure mode ADR 0023 exists to prevent.

## Consequences

- Pull requests whose changed paths match neither workflow's filter — `docs/**`,
  `.qoder/**`, top-level `*.md` — become mergeable; the class of change that could
  never merge disappears. PR #195 went from `BLOCKED` to `CLEAN` within seconds of
  the change, with no other settings touched.
- **Enforcement for code changes is weaker than before, by design and only
  provisionally.** Nothing required now proves that build, the integration lanes,
  npm audit or CodeQL ran on a code PR. `Integration workflow passed` and
  `Security workflow passed` still report when their paths match, and
  `auto-update-pr-branches.yml` still demands successful runs of `integration`,
  `security` and `automation-policy` before it merges anything, so automation keeps the
  old bar while a human or bot merge no longer does.
- Closing that gap needs a change-class routing aggregate gate that always queues, runs
  documentation checks for the documentation class and waits for integration and
  security evidence for the code class — then becomes a required context itself. That
  is the subject of issue #196's remaining scope and will take its own decision record.
- `scripts/ci-automation.mjs` `assertProtection()` still reads
  `GET /branches/main/protection` and asserts the three contexts plus
  `enforce_admins`; that endpoint now returns 404, so the function can no longer pass.
  It has no live caller — `automation-policy.yml` runs `ci-automation.mjs title`, and
  `npm-audit-fix.yml` uses `ci-audit.mjs`, which does not import it — but the code now
  encodes a policy this record retires, and its unit test asserts a protection shape
  that no longer exists. It must be retargeted at the ruleset alongside the aggregate
  gate.
- SquadRules/charts still carries the classic three-context protection described in
  "Branch protection (SquadRules)" of the archived iac-github README; the two repos are
  no longer in parity on this point.

## Evidence

- [Issue #196](https://github.com/SquadRules/mcp/issues/196) — the reported deadlock.
- PR [#195](https://github.com/SquadRules/mcp/pull/195) at head `297259dd`:
  nine `Automation policy passed` check runs, zero `Integration workflow passed` /
  `Security workflow passed` check runs, `mergeStateStatus: BLOCKED`; `CLEAN` after
  the ruleset was created.
- Pre-conversion protection document and the ruleset payload sent to
  `POST /repos/SquadRules/mcp/rulesets`, both retained outside the repository.
- Post-change verification on 2026-10-27:
  `GET /repos/SquadRules/mcp/rulesets` lists `25951418` "main merge gate" with
  `enforcement: active`; `GET /repos/SquadRules/mcp/rulesets/25951418` reports
  `bypass_actors: []`; the effective-rules response from
  `GET /repos/SquadRules/mcp/rules/branches/main` carries the single required
  context `Automation policy passed` (`integration_id` 15368) with
  `strict_required_status_checks_policy: true`; and
  `GET /repos/SquadRules/mcp/branches/main/protection` returns
  404 "Branch not protected".
- Filter membership read from the workflows themselves:
  [integration.yml](../../.github/workflows/integration.yml) and
  [security.yml](../../.github/workflows/security.yml) both list
  `.github/workflows/**`, which is why a Markdown-only edit inside
  `.github/workflows/` still queues them; [automation-policy.yml](../../.github/workflows/automation-policy.yml)
  declares no `paths` key.

## Revisit condition

Revisit when the change-class aggregate gate lands — then the required-context list
grows by one and this record's enforcement-gap consequence should be retired rather
than restated. Also revisit if a required context is ever added to the `~ALL` ruleset,
or if an out-of-band edit to `main` protection appears that this record does not
describe.
