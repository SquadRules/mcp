# Architecture decision records

Short records of decisions that were already argued once, so they are not re-litigated
every few weeks. One decision per file. An ADR states the **context**, the **decision
taken**, the **consequences**, and the **evidence** (commits, measurements, issues)
that made it.

Rules of use:

- Never rewrite history in an accepted ADR. Supersede it with a new record and change
  the old Status line.
- An ADR owns the *why*. Code and workflows own the *what*; the project Wiki owns
  anything derivable from source. Link, do not restate.
- Every ADR names the issue that can reopen it, so "we decided this" has a place to
  go when the decision expires.

> **Provenance.** ADRs 0001–0007 were authored during PR
> [#26](https://github.com/SquadRules/mcp/pull/26), which was **closed without
> merging**. They are preserved as a retrospective record of the decisions taken and
> the defect analysis performed — most importantly the boot-injection reader defect
> [#24](https://github.com/SquadRules/mcp/issues/24), which was **fixed and closed on
> `main` on 2026-10-12**. Unless a record's Status says otherwise, the implementation it
> described did **not** land on the #26 branch's terms: where a body says "implemented" or
> "fixed by #26", read it as "implemented on the closed #26 branch, then re-landed directly
> on `main`" only where the Status line confirms it. Decisions marked **Proposed** are
> recorded intent, not current behaviour. ADRs 0008 onward describe behaviour that is on
> `main`.

## Index

| ID | Decision | Status |
| --- | --- | --- |
| [0001](0001-two-layer-adapter-write-caching.md) | Adapter writes are cached at two independent layers: CI snapshot import, and runtime boot injection | Accepted (design is on `main`; Layer 1 parked, [#22](https://github.com/SquadRules/mcp/issues/22)) |
| [0002](0002-boot-injection-reuse-rule.md) | Boot-injection reuse is decided by semver, not by content hash | Accepted — rule and reader fix are on `main`; defect [#24](https://github.com/SquadRules/mcp/issues/24) **closed** 2026-10-12 |
| [0003](0003-no-lancedb-store-snapshot.md) | No LanceDB store snapshot/export in CI | Accepted, still in force — revisit condition ([#24](https://github.com/SquadRules/mcp/issues/24)) **closed**; decision reinforced |
| [0004](0004-fastembed-default-for-testing.md) | fastembed is the only embedding provider in CI | Accepted — embedded fastembed is the runtime default unless `OPENAI_API_KEY`/Ollama/TEI is set; [#33](https://github.com/SquadRules/mcp/pull/33) set the 384-d default model |
| [0005](0005-cache-keys-under-release-stamping.md) | Cache identity must not be derived from release-stamped values | Accepted |
| [0006](0006-two-integration-lanes.md) | Exactly two integration lanes — cluster and single — both full-suite, both gating | Accepted — PR #30 landed on `main` |
| [0007](0007-single-lane-stdio-integration-with-model-cache.md) | SINGLE lane CI runs stdio integration test with cached fastembed model | Accepted — PR #37 |
| [0008](0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md) | Bare CLI invocation defaults to stdio; console logs must not leak to stdout | Accepted |
| [0009](0009-autonomous-adapter-execution-no-human-gates.md) | Bundled adapters execute autonomously; human confirmation gates removed | Accepted |
| [0010](0010-critic-loop-and-proof-splitting.md) | Rename phase-critic to critic-loop; proofs split by reversibility cost and batched | Accepted (extends 0009) |
| [0011](0011-unattended-release-pr-identity.md) | App-authored Release PRs and protected auto-merge without per-release approval | Proposed — end-to-end acceptance pending |
| [0012](0012-redirect-tombstones-for-renamed-slugs.md) | Keep redirect tombstones for deeply-referenced renamed adapter slugs | Accepted (refines 0010) |
| [0013](0013-embedded-store-multiprocess-safety.md) | The embedded store is safe across multiple local processes | Accepted |
| [0014](0014-always-latest-mcp-spec-and-sdk.md) | Always track the latest Model Context Protocol spec and SDK | Accepted |
| [0015](0015-cli-local-by-default-transport-agnostic-backend.md) | The CLI is local-by-default with a transport-agnostic backend and human-first output | Accepted |
| [0016](0016-explicit-adapter-authoring-context.md) | Explicit authoring operation and target across activation and forward | Proposed |
| [0017](0017-critic-loop-work-submission.md) | Critic-loop reviews a typed work submission, not a single input file | Accepted (extends 0010) |
| [0018](0018-automated-dependency-pr-merge-via-reconcile.md) | Automated dependency PR merge via reconcile every 6 hours | Accepted |
