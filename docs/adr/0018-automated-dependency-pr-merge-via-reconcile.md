# ADR 0018: Automated dependency PR merge via reconcile

## Status

Superseded — the `auto-merge-deps.yml` workflow was removed and its function folded into `auto-update-pr-branches.yml` using native `gh pr checks --watch` + `gh pr merge` (sequential update-check-merge per PR).

## Context

Dependency updates arrive through two producers: Dependabot (native GitHub
security advisories, daily) and the consolidated `npm-audit-fix` workflow
(hourly fallback for production moderate-or-higher advisories). Each producer
opens a PR that must pass the same three required gates as human PRs
(Integration, Security, Automation policy) before it can merge. Renovate was
removed (see [Issue #73](https://github.com/SquadRules/mcp/issues/73));
Dependabot owns all version updates and Dependabot security PRs remain
enabled in repository settings.

Without an automated merge step, these PRs sit open until a maintainer reviews
and merges them manually. When `AUTOMATION_ENABLED` was `false`, all three
producers were blocked and no dependency updates landed for 11 days. Even when
enabled, Dependabot's only security PR (PR #21, `source-map-js` bump) failed CI
and was closed without merging -- no auto-merge existed to catch it even if it
had passed.

The `reconcile()` function in `scripts/ci-automation.mjs` already implements
the full merge gating: it lists eligible dependency PRs from trusted producers
(Dependabot, audit-fix), verifies all three required gates passed on
the PR head SHA, confirms mergeable state is clean and the base is current,
then squash-merges with a conventional commit title. Security PRs are
prioritised first via `orderPulls()`. The function is fully unit-tested.

## Decision

Add a dedicated `auto-merge-deps.yml` workflow that runs `ci-automation.mjs`
reconcile every 6 hours. The workflow uses the same `GH_PAT` token as
audit-fix publish. It calls `assertProtection()` before any merge to verify
branch protection requires the three standard checks with strict base
protection and admin enforcement.

The 6-hour cadence ensures dependency PRs are merged promptly. Security PRs
from Dependabot and the audit-fix fallback are prioritised and merged first.

`AUTOMATION_ENABLED` is set to `true` to unblock all three producers.

## Consequences

- Dependency PRs that pass all gates are merged automatically within 6 hours.
- Security PRs are prioritised over general version bumps.
- The reconcile function's existing safety invariants are preserved: identity
  verification, gate verification, mergeable-state checks, and expected-head
  merge API calls.
- The `npm-audit-fix` fallback continues to produce its own PR when Dependabot
  cannot resolve an advisory; the reconcile workflow merges it through the same
  path.
- Dependabot's `open-pull-requests-limit: 0` disables version PRs; only
  security PRs are opened. The reconcile workflow merges them automatically.
- If a dependency PR fails CI, it stays open for manual investigation -- the
  reconcile function skips PRs with failed or pending gate runs.

## Evidence

- `scripts/ci-automation.mjs`: `reconcile()`, `managedPull()`, `gateRuns()`,
  `orderPulls()`, `securityPull()`, `assertProtection()`.
- `tests/scripts/automation.test.mjs`: full test coverage for reconcile,
  including merge, dry-run, deferred, behind-base, and API error scenarios.
- `.github/workflows/auto-merge-deps.yml`: the new workflow.
- `scripts/ci-validate-workflows.mjs`: assertions for the new workflow's
  schedule, permissions, checkout ref, token and absence of forbidden commands.
- PR #21 (closed): Dependabot's only security PR that failed CI and was closed
  without merging, demonstrating the gap this ADR fills.

## Revisit condition

If the reconcile mechanism proves unreliable (e.g. race conditions with
concurrent merges, or false-positive gate passes), revert to manual merge and
investigate the root cause. If GitHub introduces native auto-merge for
third-party bot PRs with equivalent gating, consider replacing the custom
workflow.
