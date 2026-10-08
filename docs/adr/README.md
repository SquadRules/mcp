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

> **Provenance.** These ADRs were authored during PR
> [#26](https://github.com/SquadRules/mcp/pull/26), which was **closed without
> merging**. They are preserved as a retrospective record of the decisions taken and
> the defect analysis performed — most importantly the boot-injection reader defect
> [#24](https://github.com/SquadRules/mcp/issues/24), which is **still open on `main`**.
> Unless a record's Status says otherwise, the implementation it describes did **not**
> land: where a body says "implemented" or "fixed by #26", read it as "implemented on the
> closed #26 branch, not on `main`". Decisions marked **Proposed** are recorded intent,
> not current behaviour.

## Index

| ID | Decision | Status |
| --- | --- | --- |
| [0001](0001-two-layer-adapter-write-caching.md) | Adapter writes are cached at two independent layers: CI snapshot import, and runtime boot injection | Accepted (design is on `main`; Layer 1 parked, [#22](https://github.com/SquadRules/mcp/issues/22)) |
| [0002](0002-boot-injection-reuse-rule.md) | Boot-injection reuse is decided by semver, not by content hash | Recorded — rule is on `main`, but defect [#24](https://github.com/SquadRules/mcp/issues/24) is **open** (the #26 fix closed unmerged) |
| [0003](0003-no-lancedb-store-snapshot.md) | No LanceDB store snapshot/export in CI | Accepted, still in force — revisit condition ([#24](https://github.com/SquadRules/mcp/issues/24)) remains open |
| [0004](0004-fastembed-default-for-testing.md) | fastembed is the only embedding provider in CI | Accepted — PR #33 landed on `main` |
| [0005](0005-cache-keys-under-release-stamping.md) | Cache identity must not be derived from release-stamped values | Accepted |
| [0006](0006-two-integration-lanes.md) | Exactly two integration lanes — cluster and single — both full-suite, both gating | Accepted — PR #30 landed on `main` |
| [0007](0007-single-lane-stdio-integration-with-model-cache.md) | SINGLE lane CI runs stdio integration test with cached fastembed model | Accepted — PR #37 |
| [0008](0008-bare-cli-defaults-to-stdio-and-console-log-hygiene.md) | Bare CLI invocation defaults to stdio; console logs must not leak to stdout | Accepted |
