---
name: kmcp-dev-release-semver
description: >-
  kairos-mcp: unattended semantic releases from validated main, branch prerelease
  dispatch, immutable artifact recovery, and automation rollout. No manual tags
  or version-bump PRs; conventional commits determine the version.
---

# Releases and dependency automation

The single release mechanism is [release.yml](https://github.com/jakub-plichcinski/kairos-mcp/blob/main/.github/workflows/release.yml), using `release.config.mjs` as the semantic version authority. Never create release tags locally or bump committed versions to trigger publishing. The committed version is a baseline, not the next release number.

## Normal operation

- Hourly Renovate (`17 * * * *`) owns routine dependency updates, including majors. Native Dependabot owns security updates; its zero version-PR limit does not disable security updates.
- Hourly npm audit (`43 * * * *`) assesses moderate-or-higher findings. A progressing native security PR takes precedence for two hours; blocked or stalled fixes allow one refreshed consolidated fallback. Registry failures are errors, not vulnerability findings.
- The API-only controller runs after validations and every ten minutes. It verifies numeric identity, managed branch origin, dependency-only paths, current head/base and checks, then squash-merges at most one PR. Security fixes take priority; otherwise the oldest eligible PR wins. It never approves PRs or rewrites human branches.
- Main must pass full Integration, Security, and automation-policy validation at the exact source SHA. Completion events and hourly reconciliation (`53 * * * *`) trigger Release automatically.
- `fix:` and dependency updates are patches; `feat:` is minor; `!` or `BREAKING CHANGE` is major. Legacy `chore(deps)` and `deps(...)` commits count as patches. An unreleased feature or breaking change takes precedence over dependency patches. Housekeeping-only history is a true no-op.
- No AI agent, administrator bypass, or required human approval is part of this path. Copilot auto-fix remains outside it.

## One-time rollout and credentials

Keep `AUTOMATION_ENABLED` unset or `false` to pause the dependency producers and controller (Renovate, npm audit fix, dependency-merge controller, automation-health) until their prerequisites are verified. Release is **not** gated by this variable — it runs by default from its own triggers (see below).

1. Merge the implementation through normal protected PR checks.
2. Require `Integration workflow passed`, `Security workflow passed`, and `Automation policy passed`, bound to GitHub Actions (app ID `15368`). Keep strict up-to-date protection, administrator enforcement, and zero mandatory approvals. Set squash commit titles to the PR title.
3. Set `AUTOMATION_USER_ID` to the verified numeric owner of the existing Actions `GH_PAT`. That credential must have repository contents, pull-request mutation, workflow-file update and required read access. Never copy it to Dependabot secrets. Automation-generated branch/PR mutations use it so fresh CI can start unattended.
4. Keep the restricted embedding-test `OPENAI_API_KEY` in Actions and Dependabot secrets. Tests receive no publishing or repository-write credentials.
5. Keep npm's trusted publisher bound to `release.yml` and environment `release`, with no approval requirement. Publishing uses package-scoped OIDC credentials and sets the release's channel dist-tag directly (`npm publish --tag <channel>`); npm's OIDC flow authorizes only `npm publish`, so there is no separate dist-tag-promotion call (a standalone `PUT` is rejected with 403) and never a long-lived npm token. Container/Helm channel aliases are promoted with registry credentials after verification.
6. Verify `DOCKER_USERNAME`/`DOCKER_PASSWORD`, `QUAY_USERNAME`/`QUAY_PASSWORD`, and `QUAY_NAMESPACE`. Quay credentials need access to both `kairos-mcp` (images) and `kairos-mcp-chart` (Helm); these must be separate repositories so identical version tags cannot collide. Both repositories must be readable by consumers.
7. Run controller and Renovate dry-runs, then set `AUTOMATION_ENABLED=true`. Observe the next scheduled producer run, a real protected dependency merge, full main validation and all released artifact identities. Do not declare live CVE remediation verified without a real advisory.

The Renovate repository configuration disables hosted Mend execution. Only the trusted self-hosted runner enables it, using a distinct `automation/renovate/` prefix. Install scripts, plugins and arbitrary post-upgrade commands are disabled.

## Preview and prereleases

Preview stable history without mutations:

```bash
gh workflow run release.yml --ref main -f dry-run=true
gh workflow run automerge-dependabot.yml --ref main -f dry-run=true
gh workflow run renovate.yml --ref main -f dry-run=true
```

Add `-f validate-artifacts=true` to a Release dry-run to also build, consumer-test, scan and checksum every release artifact without publishing. Run this rehearsal before enabling automation.

For a short-lived prerelease branch, first dispatch **Integration**, **Security**, and **Automation policy** on that branch and wait for all three to pass at the same SHA. Then dispatch `release.yml --ref <branch> -f dry-run=false`. The sanitized branch name becomes the prerelease identifier and channel; prereleases never move `latest` or stable image aliases. A pending older release is recovered before any newer stable or prerelease publication.

## Artifact identity and recovery

Release resolves one source SHA. It prepares and consumer-tests the versioned npm tgz, validates Helm, builds a multi-platform OCI archive, smoke-tests both platforms, and scans both before publication. A manifest records version, channel, source SHA, npm integrity, image digest and artifact checksums. SBOMs and validation evidence are included.

Validated artifacts first enter immutable Actions storage, then a draft GitHub Release. Because npm's OIDC flow authorizes only `npm publish` and cannot move a dist-tag afterward, npm publishes the version directly under its final channel tag (`latest` on main, the prerelease channel otherwise) — this npm channel tag therefore moves during the npm stage, before container/Helm alias promotion. Versioned images and the Helm chart publish without moving stable aliases. Existing artifacts must match the recorded integrity/digest. Container digests are signed and verified. Container/Helm channel aliases are promoted only after all publication checks pass, and the GitHub Release stays a draft until the final `complete` step, so a mid-flight failure is retained and recoverable even though npm's channel tag has already advanced.

Cross-registry publication is not atomic. A failure retains the draft, original source, checksums, original recovery artifact ID and stage progress. The next event, hourly reconciliation, or manual `release.yml --ref main -f dry-run=false` resumes that record. It never rebuilds newer source under an old version. Missing/expired recovery bytes, mismatched artifacts, invalid credentials and legacy drafts without manifests fail visibly and need remediation. `resolve` deletes only unrecoverable `untagged-*` orphan drafts (a git tag was created but the GitHub publication never completed); a genuine pending draft keeps `tag_name vX` and must never be deleted or overwritten to force progress.

Transient command operations (skopeo/cosign, aliases) retry up to three times. Publication-metadata verification polls longer with capped backoff because an immutable write can be accepted yet queryable only after an eventual-consistency delay; npm gets the widest window because its post-publish provenance/processing pass can keep the just-published version unqueryable for many minutes even though the write already succeeded. A real identity mismatch still fails on the first read. `automation-health.yml` monitors failures, stale runs and incomplete drafts; it maintains one incident per workflow and closes it after recovery. Setting `AUTOMATION_ENABLED=false` pauses the dependency producers and controller (Renovate, npm audit fix, dependency-merge controller, automation-health). It does **not** pause Release: Release runs by default from main-push, hourly reconciliation and manual dispatch, and a `false` value does not undo artifacts already published.

## Verification

Check the workflow summary and the release's `manifest.json`, not merely a green job:

```bash
gh run list --workflow=release.yml --limit 3
gh release view v<version>
npm view @jakub-plichcinski/kairos-mcp@<version> dist.integrity
npm dist-tag ls @jakub-plichcinski/kairos-mcp
helm pull oci://quay.io/<namespace>/kairos-mcp-chart --version <version>
```

Compare npm integrity, both registries' image digests, downloaded chart checksum, channel aliases, and Git tag source with the manifest. Local regression entry points are `npm run test:automation`, `npm run test:audit-fix-workflow`, `npm run lint:workflows`, and `npm run lint:renovate`. For deployment and integration testing, follow [build-test.md](build-test.md).
