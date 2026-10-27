# 0032 — Route required CI evidence by change class through one always-on aggregate gate

Status: Accepted — implemented on this branch ([`ci-gate.yml`](../../.github/workflows/ci-gate.yml),
[`scripts/ci-change-class.mjs`](../../scripts/ci-change-class.mjs), the ruleset retarget of
[`scripts/ci-automation.mjs`](../../scripts/ci-automation.mjs) and their regression tests).
Retires the enforcement-gap consequence of
[0031](0031-ruleset-enforced-single-required-gate.md); supersedes only the
"keep … branch protection unchanged" clause of
[0023](0023-mandatory-ci-and-fail-closed-gates.md), whose fail-closed aggregate mechanism
this record extends. Neither earlier body is edited.
Date: 2026-10-27
Enforcement applied: 2026-10-27 (ruleset `25951418` now requires `Automation policy passed` and `CI gate passed`)

## Context

ADR 0031 closed its own Consequences with the words this record answers:

> Closing that gap needs a change-class routing aggregate gate that always queues, runs
> documentation checks for the documentation class and waits for integration and security
> evidence for the code class — then becomes a required context itself. That is the subject
> of issue #196's remaining scope and will take its own decision record.

The deadlock half of [issue #196](https://github.com/SquadRules/mcp/issues/196) is already
gone: classic branch protection on `main` was deleted and replaced by ruleset `25951418`
"main merge gate", which requires one always-on context, and documentation-only PR
[#195](https://github.com/SquadRules/mcp/pull/195) merged as soon as that landed. What
remains is enforcement. For an application-class pull request nothing required proves that
build, the two integration lanes, npm audit or CodeQL ran: `Integration workflow passed` and
`Security workflow passed` still report when their `on.pull_request.paths` filters match, but
no required context demands they succeeded, so unvalidated source can merge. Only
`auto-update-pr-branches.yml` still insisted on their success, and a bot's policy is not a
merge gate.

The fix depends on a distinction between three layers that are routinely conflated, so they
are stated separately here:

1. **Workflow-level `on.pull_request.paths`** is evaluated by GitHub *before a run exists*. A
   filtered-out workflow produces **no check run at all**, so a required context naming it
   never reports and sits at "Expected" forever. Measured on live state: head `297259dd`
   carried nine `Automation policy passed` check runs, zero integration or security check
   runs, and `mergeStateStatus: BLOCKED`.
2. **A job** skipped by a conditional, or skipped because a `needs` job failed, *does* create
   a check run and **reports Success**. That is the fail-open ADR 0019 relied on and ADR 0023
   removed, and it is also the case GitHub's own troubleshooting page describes as checks that
   "may not block merging".
3. **Step-level `if: always()`** creates no check run at all. It has no bearing on which
   checks GitHub waits for; it decides only whether steps still execute inside the job that
   already exists, and therefore that job's outcome.

Required-ness itself comes only from ruleset `25951418`: `main` has no protection document
any more (`GET /repos/SquadRules/mcp/branches/main/protection` returns 404), so there is no
protection payload to edit and any assertion reading that endpoint can never pass.

Because a skipped job reports Success (level 2) while a filtered workflow reports nothing
(level 1), the gate cannot be added inside `integration.yml` or `security.yml`, and it cannot
be a job that is skipped for the class it does not serve. It must be its own always-on
workflow that produces positive evidence in its own job.

## Decision

Add one always-on aggregate required check that classifies the revision and demands evidence
according to the class:

- **New workflow [`ci-gate.yml`](../../.github/workflows/ci-gate.yml)** named `CI gate`, single
  job `gate` named `CI gate passed`. It declares **no** `paths:` or `paths-ignore:` filter on
  any trigger — that omission is the mechanism — and queues on `pull_request`
  (`opened`, `synchronize`, `reopened`, `ready_for_review`), `merge_group` and
  `workflow_dispatch`, with `contents`/`pull-requests`/`actions` read permissions and a
  90-minute job timeout.
- **Classification comes from the revision's own git history, not from an API file list.**
  `git merge-base` of the event's base commit and `github.sha`, then `git diff --name-only`,
  piped into **[`scripts/ci-change-class.mjs`](../../scripts/ci-change-class.mjs)**. The script
  exports `APP_PATHS` — the union of `integration.yml`'s and `security.yml`'s current PR
  filters — and `DOCS_PATHS` (`docs/**`, `.qoder/**`, `.agents/**`, any `*.md`), so the
  aggregate's idea of "application class" cannot drift from the workflows it collects
  evidence from; a test asserts the two sets are equal.
- **Fail closed, in this order:** documentation-only revision → `{docs: true, app: false}`;
  any application path → `app: true` (`docs` set independently); a revision whose paths match
  neither set → both lanes expected; empty or unreadable input, rejected revision identifiers,
  or a failed `git merge-base`/`git diff` → both lanes expected with `reason=unclassified`. A
  revision contributing no files exits non-zero with an explicit message instead of consuming
  the wait deadline, because a PR that changes nothing must not be accepted as validated.
- **The documentation lane runs inside the gate job** when documentation is owed (own
  20-minute wall-clock budget: `npm ci`, `npm run lint:markdown`,
  `node scripts/lint-docs-links.mjs --strict`, `npm run lint:skills`), so the required check
  carries positive evidence for a docs-only change rather than being satisfied by an absent or
  skipped job.
- **For the application class the gate waits for transitive evidence** from the existing runs:
  it polls the Actions API for `integration.yml` and `security.yml` runs and requires
  `status: completed` with `conclusion: success`, using the provenance filter already used by
  `auto-update-pr-branches.yml` — `.path`, `head_sha`, `head_branch`,
  `head_repository.full_name`, `event` — so a superseded attempt or a run from a same-named
  branch in a fork cannot be mistaken for this revision's evidence. A reported
  `failure`/`cancelled`/`timed_out`/`action_required`/`startup_failure`/`stale` aborts at once;
  the 80-minute poll budget inside the 90-minute job timeout ends in an explicit "no CI
  evidence for this revision" failure. Absence never passes.
- **Runs are keyed by the pull request head commit, never by `github.sha`.** For a
  `pull_request` event `github.sha` is the synthetic merge commit, which no workflow run ever
  records; the gate reads `github.event.pull_request.head.sha` (merge-group and dispatch
  fall back accordingly).
- **`integration.yml` and `security.yml` are not restructured.** Their `paths` filters remain
  the queueing rule, their check names stay as they are, and the `if: always()` on
  `integration-pass` and `security-pass` is byte-identical because it is load-bearing: without
  it a failed lane skips the gate job, and that skipped job reports Success over a broken
  build — the ADR 0019 fail-open ADR 0023 removed.
- **`workflow_dispatch` runs the documentation lane only** and prints that a dispatch revision
  can never satisfy a required check; it waits for no evidence, since no pull request context
  exists to attribute.
- **Required contexts become `Automation policy passed` + `CI gate passed`**, both on ruleset
  `25951418` and nowhere else: the `~ALL` ruleset `24349936` must not host a `main`-only
  context, and the context is added only after it has been observed green on a real pull
  request revision — adding it first reproduces issue #196 exactly.
- **The policy is asserted in code.** `scripts/ci-automation.mjs` replaces `assertProtection()`
  with `assertRuleset()`, reading `GET /repos/{owner}/{repo}/rulesets/{id}` (id from
  `AUTOMATION_RULESET_ID`) and asserting enforcement, target, `ref_name` inclusion, empty
  `bypass_actors`, the strict status-check policy, `require_extra_approval_for_unattributed_changes:
  false` and the exact required-context set. `auto-update-pr-branches.yml` gates on
  `automation-policy` plus `ci-gate` and adds `CI gate` to its `workflow_run` triggers, since
  the aggregate — not the bot — is now the authority for integration and security evidence.
- **[`docs.yml`](../../.github/workflows/docs.yml) ships in this change**: its `on.push.paths` is
  aligned with the scope declared in `.qoder/repowiki/wiki_plan.yaml` (plus the plan file
  itself), and a diagnostics step exported as an artifact precedes the failing
  `Qoder wiki --update` step. Generated output lands only under `.qoder/repowiki/**`, which is
  outside that filter, so a merged wiki-regeneration PR cannot retrigger generation. The
  regeneration **repair** is not decided here; it depends on the diagnostic evidence and on a
  documentation-authority exception.

## Consequences

- ADR 0031's enforcement-gap consequence is closed rather than restated: an
  application-class pull request can no longer merge unless `integration.yml` and
  `security.yml` both completed successfully for its head commit, and a documentation-class
  pull request now carries positive documentation evidence in a required check instead of
  nothing at all.
- Both required contexts always report, because neither producing workflow is path-filtered.
  `Integration workflow passed` and `Security workflow passed` keep their names and stay
  non-required; they are enforced transitively.
- Cost: every pull request now queues the gate job, and a documentation-only revision pays an
  install plus three documentation lints it did not pay before. That is the price of level-1
  reality — a required check cannot come from a filtered workflow — and it replaces the
  alternative of running full integration and CodeQL on prose, which ADR 0031 rejected.
- Strict link checking becomes gating, so frontmatter must not be read as content:
  `scripts/lint-docs-links.mjs` strips a leading `---` … `---` block (line numbers preserved)
  before extracting links. Without it,
  `.qoder/agents/principles-guardian.md`'s `model: "[DeepSeek-Flash](dfmodel)"` fails the
  gate as a dangling link.
- Classification reads the merge base, so a branch that is behind `main` is judged on what it
  actually contributes, and a revision whose diff is empty fails with a reason instead of
  passing silently.
- An application-class revision from a fork is attributed through
  `head_repository.full_name`, so the wait does not assume the head lives in this repository.
- A gate whose evidence never arrives reports at its own deadline rather than being cancelled
  by Actions, and the deadline verdict is a failure — the class of "green because nobody was
  watching" cannot recur.
- `scripts/ci-automation.mjs` no longer reads an endpoint that 404s, so the automation policy
  can express this repository's real protection topology again; its test fixture now mirrors
  the ruleset shape instead of the deleted protection document.

## Alternatives considered

- **Widen `integration.yml`/`security.yml` `paths` to cover `docs/**`, `.qoder/**`, `*.md`.**
  Rejected: every prose change would run the CLUSTER and SINGLE integration lanes plus CodeQL
  over unchanged source — the cost ADR 0023 accepted filters to avoid, and it still leaves the
  required context sourced from a filtered workflow.
- **Keep the filtered workflows required and gate on `skipped` jobs** (a
  `needs`-chained `*-pass` job inside each workflow, or `if:` conditions per lane). Rejected: a
  skipped job reports Success, which is precisely the fail-open ADR 0019 introduced and ADR
  0023 removed, and a filtered-out workflow still reports nothing at all.
- **Fan out to `workflow_call` reusable workflows** so one aggregate literally runs the lanes.
  Rejected on evidence: a called reusable workflow's jobs report check names prefixed by the
  caller, and it emits no top-level `workflow_run` event for the callee — which
  `auto-update-pr-branches.yml` relies on to learn that lanes finished — and CodeQL's elevated
  `security-events` permission could only be narrowed by restructuring the chain.
- **Post synthetic check runs for the absent contexts.** Rejected: it certifies validation that
  never ran, the failure mode ADR 0023 exists to prevent (and already rejected in ADR 0031).
- **Leave enforcement to `auto-update-pr-branches.yml`.** Rejected: the bot only governs PRs it
  manages, and any merge performed without it would bypass integration and security evidence
  entirely.

## Evidence

- [Issue #196](https://github.com/SquadRules/mcp/issues/196) — open, title records the
  path-filtered required-check cause; PR [#195](https://github.com/SquadRules/mcp/pull/195)
  merged 2026-10-27T11:04Z after ADR 0031 landed, PR
  [#200](https://github.com/SquadRules/mcp/pull/200) merged ADR 0031 as `a1449c48`.
- Live ruleset state read before writing this record:
  `GET /repos/SquadRules/mcp/rulesets/25951418` → `enforcement: active`, `target: branch`,
  `include: ["refs/heads/main"]`, `bypass_actors: []`, one required context
  `Automation policy passed` (`integration_id: 15368`) with
  `strict_required_status_checks_policy: true`; `GET /repos/SquadRules/mcp/rules/branches/main`
  reports the same single effective context;
  `GET /repos/SquadRules/mcp/branches/main/protection` → 404.
- Run-keying fact measured against Actions data for PR #200: its runs record
  `head_sha = 74edaae7` (the PR head) while `github.sha` for the same event is the merge
  commit `a1449c48` — evidence that waiting on the wrong key would poll for runs that never
  exist.
- Replays of the real step shells extracted from the YAML (not paraphrased copies) against
  repository revisions: a documentation-only pair → `docs=true app=false
  reason=documentation-only`; an application pair → both lanes; an unfetchable base sha →
  `reason=unclassified` with both lanes; `workflow_dispatch` → documentation only; head equal
  to base (empty diff) → exit 1 with the explicit message. The evidence step against live
  data: head `74edaae7` satisfied immediately (exit 0), head `297259dd` failed closed with
  "no CI evidence for this revision" (exit 1).
- Regression coverage: `npm run test:automation` → 82 tests passing, including
  `tests/scripts/change-class.test.mjs` (10) and the new `ci-gate`, docs-scope and ruleset
  assertions in `tests/scripts/workflow-structure.test.mjs` and
  `tests/scripts/automation.test.mjs`. `npm run lint:workflows` (actionlint + shellcheck) is
  clean, and `node scripts/lint-docs-links.mjs --strict` exits 0 over 99 tracked Markdown
  files with the frontmatter strip in place (it exits 1 without it).
- `docs.yml` diagnostics step executed locally from the YAML: all sections captured, and the
  committed generation stamp read as `wiki_repo.name = prune-agent-assets-20261013`,
  `progress_status = completed`, `wiki_present_status = COMPLETED`, 65 items — the evidence a
  later repair decision needs, recorded here as a follow-up rather than acted on.

## Related

- [0019](0019-path-tiered-ci-gates-with-a-classifier-job.md) — classifier-job tiering,
  superseded for the fail-open reason this record's level-2 constraint restates.
- [0023](0023-mandatory-ci-and-fail-closed-gates.md) — native path filters and fail-closed
  aggregates; mechanism kept, protection clause superseded.
- [0031](0031-ruleset-enforced-single-required-gate.md) — the ruleset conversion whose
  deferred scope this record completes.

## Reopen signal

Reopen when GitHub changes what a required status check may depend on (native aggregation of
filtered workflows, or `workflow_run` events from called reusable workflows), when a lane's
path filter changes without `APP_PATHS` being regenerated, when the aggregate's own evidence
proves cheaper to obtain by running the lanes directly than by waiting for them, or when the
poll deadline starts being hit in practice rather than in tests. Adding the second required
context to ruleset `25951418` is an application step of this record, not a revision of it.
