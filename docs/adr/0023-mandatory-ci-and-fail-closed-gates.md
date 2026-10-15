# 0023 — Mandatory CI and fail-closed gates

Status: **Accepted** — supersedes [0019](0019-path-tiered-ci-gates-with-a-classifier-job.md).
Date: 2026-10-15

## Context and evidence

After **Update branch** on [PR #108](https://github.com/SquadRules/mcp/pull/108),
[the classifier log](https://github.com/SquadRules/mcp/actions/runs/38728499328/job/116400149343)
reported `Received 0 items` and `Detected 0 changed files`. Builds, both integration
lanes, npm audit, and CodeQL were skipped, yet the required aggregate gates passed.
The empty file list's cause is not established; accepting absent validation as
success was sufficient to bypass the intended merge checks.

## Decision

Use native GitHub Actions `on.pull_request.paths` filtering to specify which paths trigger CI. Workflows only run when relevant paths change (source code, tests, dependencies, workflows, scripts), preventing empty-diff bypasses while being simpler and more reliable than classifier jobs.

Required aggregate gates need explicit successful results from every mandatory lane; skipped, failed, canceled, missing, and unknown results cannot satisfy them. Dependency review remains PR-only because it requires PR context; outside PR events, only that lane must be skipped.

Keep the existing required check names, immutable event-revision checkout, and branch protection unchanged. The executable policy lives in the [workflows](../../.github/workflows/) and [tests](../../tests/scripts/workflow-structure.test.mjs). Regression tests execute the actual gate shell scripts, including the all-skipped result observed on PR #108.

## Consequences and rejected alternatives

CI runs only when relevant paths change, reducing unnecessary runs for docs-only or harness-only PRs. Native GitHub Actions path filtering is simpler and more reliable than a classifier job, and the empty-diff bypass is prevented because GitHub itself evaluates the paths.

The classifier job approach (ADR 0019) was rejected because it depended on the GitHub API returning an accurate file list, which failed on PR #108. Native path filtering is evaluated by GitHub Actions directly and is not subject to API inconsistencies.

Allowing skipped lanes to pass is rejected. The urgent fix removes both the classifier job and the fail-open gates.

## Reopen signal

Revisit optimization only with a separately reviewed design that proves equivalent
validation coverage for the exact merge revision and fails closed on missing evidence.
Cost alone does not justify restoring skipped-as-success behavior.
