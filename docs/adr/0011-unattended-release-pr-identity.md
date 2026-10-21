# 0011 — An App identity for unattended Release PRs

- Status: Accepted — the App identity is provisioned and an unattended App-authored
  release is observed: `v5.11.0`
  ([#132](https://github.com/SquadRules/mcp/pull/132)) landed as a squash commit
  authored by `squadrules-release[bot]`, not by a human and not by `GITHUB_TOKEN`.
  Caveat, stated so it is not lost: that release ran under the prior per-purpose
  App. [#135](https://github.com/SquadRules/mcp/pull/135) then consolidated the
  identities into the single `SquadRules auto` App and
  [#137](https://github.com/SquadRules/mcp/pull/137) fixed installation-token
  identity verification, so no release has yet been observed end to end under the
  consolidated identity.
- Date: 2026-10-12
- Revisit: if GitHub changes which events satisfy required PR checks or permits
  unattended PR validation from its built-in token; track through the migration PR.

## Context

The intended pipeline creates a version PR, validates it, merges it through
protected main and publishes the resulting tag to npm without per-release human
interaction. Release PR #42 showed that this is not achieved by the existing
GITHUB_TOKEN plus workflow_dispatch implementation.

PR #35 removed a PAT after it returned Bad credentials. PR #43 repaired repository
selection for dispatch. All dispatched checks then passed, but GitHub rejected the
merge because three required checks were still expected. The actual PR runs were
held for approval. Successful dispatch is not proof of release automation.

## Decision

Use the official, SHA-pinned create-github-app-token action to mint a separate,
short-lived installation token for each release producer, synchronizer and
protected auto-merge job. Limit access to this repository and Contents, Issues and
Pull requests write, plus Checks and Commit statuses read for auto-merge.
Request only each job's necessary subset. Do not grant protection bypass, administration or checks
write. Do not restore the invalid PAT or fall back to GITHUB_TOKEN.

Remove dispatched validation substitutes. App-authored PR updates trigger normal
PR checks. After synchronizing all versioned sources, verify the expected PR head,
branch, repository, release label and base, then enable native auto-merge with a
head-SHA guard. Existing required checks decide when merging is allowed. Use the
App identity for the merge so publication is triggered on main.

Keep npm publication on OIDC Trusted Publishing from the immutable release tag.
Keep manual tag retry for recovering publication failures, not routine releases.

## Consequences

One-time App installation and private-key provisioning are external prerequisites.
The existing connector cannot provision them. No human action is part of a normal
release after setup. Missing credentials fail early and visibly. Key rotation and
revocation remain administrative operations.

CI verifies the workflow wiring and rejects unsafe auto-merge candidates. This does
not prove the App installation, permissions, npm trust or release environment are
configured. Acceptance requires observing a fresh PR, checks, merge and publication
without approval clicks. Human-assisted 5.3.0 is diagnostic evidence only.

## Evidence

- [Original failure](https://github.com/SquadRules/mcp/actions/runs/38117268821).
- [Dispatch fix PR](https://github.com/SquadRules/mcp/pull/43).
- [Release PR](https://github.com/SquadRules/mcp/pull/42).
- [GitHub token event rules](https://docs.github.com/en/actions/concepts/security/github_token).
- [Required-check event restrictions](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
- [App authentication in Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow).
