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

## Index

| ID | Decision | Status |
| --- | --- | --- |
| [0001](0001-two-layer-adapter-write-caching.md) | Adapter writes are cached at two independent layers: CI snapshot import, and runtime boot injection | Accepted (Layer 1 parked, [#22](https://github.com/SquadRules/mcp/issues/22)) |
| [0002](0002-boot-injection-reuse-rule.md) | Boot-injection reuse is decided by semver, not by content hash | Accepted, implemented ([#24](https://github.com/SquadRules/mcp/issues/24) fixed by #26) |
| [0003](0003-no-lancedb-store-snapshot.md) | No LanceDB store snapshot/export in CI | Accepted — revisit condition met and dissolved by the 0002 fix |
| [0004](0004-fastembed-default-for-testing.md) | fastembed is the only embedding provider in CI | Accepted, implemented 2026-10-06 |
| [0005](0005-cache-keys-under-release-stamping.md) | Cache identity must not be derived from release-stamped values | Accepted |
| [0006](0006-two-integration-lanes.md) | Exactly two integration lanes — cluster and single — both full-suite, both gating | Accepted, implemented 2026-10-06 |
