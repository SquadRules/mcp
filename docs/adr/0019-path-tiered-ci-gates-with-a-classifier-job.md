# 0019 — Path-tiered CI gates with a classifier job, not workflow `on.paths`

Status: **Superseded** by [0023](0023-mandatory-ci-and-fail-closed-gates.md)
on 2026-10-15 after the skipped-validation bypass on PR #108.
Date: 2026-10-14

## Context

`main` requires three status checks by gate-job name — "Integration workflow passed",
"Security workflow passed", "Automation policy passed" — in strict mode. Docs-only and
`.github`/harness-only PRs still triggered the full unit/build matrix, the cluster and
single integration lanes, CodeQL and npm audit (tens of minutes) even though they change
nothing those lanes exercise. The tempting fix — `on.pull_request.paths` filters — is
unsafe here: when a whole workflow is path-skipped GitHub keeps its associated required
check in "Pending/Expected", which blocks the merge ("Avoid requiring workflows that can
be skipped.").

## Decision

Gate the expensive **jobs**, not the workflows.

- `integration.yml` and `security.yml` each add a cheap `changes` job that runs
  `dorny/paths-filter@v3` against a shared `.github/paths/ci-filter.yml` with buckets
  `code`, `tests`, `infra`, `harness`. The filter **step** is PR-only while the **job**
  runs on every event, so it always completes as `success` and dependent jobs never
  strand on a skipped `needs`.
- `build`, `codeql` and `npm-audit` carry
  `if: github.event_name != 'pull_request' || needs.changes.outputs.<bucket> == 'true'`.
  Non-PR events (Release `workflow_call`, schedule, `merge_group`, `workflow_dispatch`)
  always run the full set.
- The `integration-pass` / `security-pass` merge gates already use `if: always()`; they
  now accept a `skipped` lane as green and fail only on `failure`/`cancelled`, so the
  required check still posts on every PR.
- `automation-policy.yml` is unchanged — the always-on cheap floor (title check,
  `test:automation`, `lint:workflows`) that also re-validates these edited workflows.
- Harness inputs that only feed CI (`.github/**`, non-generator `scripts/**`) exercise
  Automation policy only; the four build generators embedded in the shipped runtime and
  the full-stack compose provisioning scripts count as `code` / `infra`.

## Consequences

- Docs/harness PRs finish in minutes while keeping all three required checks green; code
  PRs still run everything.
- Branch protection is untouched. No workflow is path-skipped, so no required check can
  strand at "Expected".
- Lockstep is enforced in `scripts/ci-validate-workflows.mjs`: it asserts the filter
  buckets, that both workflows define a `changes` job referencing the filter file, that
  the gated jobs read `needs.changes.outputs`, and that both merge gates tolerate
  `skipped`. Adding a lane without wiring the classifier fails `lint:workflows`.
- Cost: two extra ~5-minute classifier jobs on code PRs, and a new duty to keep the
  filter buckets in sync with the real job list.

## Reopen signal

If a docs-only PR still runs the heavy lanes, or a required check ever shows
"Expected"/pending because a workflow was filtered out, this decision is being applied
wrong — fix the job gate; do not add `on.paths` to a required workflow.

Evidence: base `f81c2981`; GitHub docs "Handling skipped but required checks" (a
job-level `if` skip reports Success and satisfies a required check, whereas a
path-filtered workflow stays Pending).
