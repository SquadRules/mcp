# ADR 0048: Shared-backend parity needs a required CI lane, not a documented command

## Status

Proposed — authored and verified locally on branch `sr6-graph-db-touchpoints` on
2026-11-07; the ArangoDB container run itself is **UNPROVEN on the authoring host**
(the Docker daemon is not available there) and awaits its first CI execution plus
independent owner ratification.

Extends [ADR 0032](0032-change-class-routing-for-required-ci-gates.md) with a third
change class, and closes the evidence gap left open by
[ADR 0044](0044-graph-repository-port-and-arango-shared-backend.md) §2, whose shared
backend was implemented and tested but never gated.

## Context

### 1. One port, two implementations, one of them rarely executed

ADR 0044 made the graph a port with an embedded LadybugDB default and a shared
ArangoDB backend. The embedded backend runs in every `npm test`. The shared backend
runs only when a developer configures it by hand, so a divergence in the port appears
in production, not in CI.

### 2. The existing suites cannot fail a build on their own

`tests/integration/graph-db-arango-shared.test.ts` and
`graph-db-arango-evolution.test.ts` select themselves from
`SQUADRULES_ARANGO_URL` / `SQUADRULES_ARANGO_DATABASE`. Unset, they call
`describe.skip`. That is the right behaviour for a laptop — the report must read
"unproven" rather than "equivalent" — but on a runner it means a green build that
executed zero shared-backend assertions. An environment-variable contract is a
documented command, not a gate, and a documented command is precisely what
ADR 0032 exists to replace.

### 3. The obvious gate is skippable in two different ways

- **A path-filtered workflow** never reports for a revision outside its filter, which
  strands the required context at "Expected". This is the failure ADR 0032 was written
  about, and `tests/scripts/workflow-structure.test.mjs` now forbids path filters in the
  aggregate for exactly this reason.
- **An `if:` on the job** is worse, because it reports — as `skipped`.
  `integration-pass` asserts `test "$GRAPH" = "success"`, and `skipped` is not
  `success`. A conditional lane therefore either fails unrelated revisions (and gets
  "fixed" by deleting it from `needs`) or teaches reviewers that a skipped required job
  is acceptable. There is no third outcome.

### 4. Local absence must stay honest, CI absence must fail

The same empty environment means two different things. On a workstation it means "this
host cannot prove shared parity"; on the lane that exists to prove it, it means "the
gate is broken". One boolean cannot express both, so the contract needs an explicit
third state.

## Decision

### 1. One unconditional job, required unconditionally

`integration.yml` gains `verify-integration-graph`. It declares no `paths:` filter and
no `if:`, and `integration-pass` lists it in `needs` alongside the existing lanes, so
`skipped` can never satisfy the aggregate. Cost is one container start plus two suites
on every application revision; that is cheaper than a second filtered workflow and it
removes the entire "skipped but green" class.

### 2. The backend is a disposable, test-owned service container

GitHub Actions `services.arangodb` pins `arangodb:3.11` — the series
`SUPPORTED_ARANGO_SERIES` accepts (`src/config/graph-backend.ts`) — publishes
`8529:8529`, sets `ARANGO_NO_AUTH=1`, and mounts nothing. No repository secret, no
privileged mode, no host socket, no image build or publish. Authentication is not part
of what these suites prove, and a disposable local server needs no credential.

### 3. Readiness and schema are observed, not assumed

The job polls `/_api/version` until the server answers and then creates
`squadrules_it` through `/_api/database`, accepting `201` or `409`. The suites
themselves still prove the served series and a real stream-transaction round-trip, so
the bootstrap step cannot substitute for parity evidence.

### 4. `SQUADRULES_ARANGO_REQUIRED=true` turns absence into failure

`tests/integration/graph-db-arango-selection.ts` is the single home of the selection
contract. With the flag set and no configuration, each suite registers a failing test
that names the missing variables; the rest of the suite is skipped so the failure is
the only thing reported. Without the flag, the long-standing loud skip is unchanged.
Editing the lane's `env:` block away can therefore no longer produce a green job.

### 5. The change class is recorded, and it is diagnostic

`scripts/ci-change-class.mjs` gains a third key, `graph`, over the shared-backend
surface (`src/services/graph-db/**`, `src/config/graph-backend.ts`, `compose/**`, the
graph suites, the classifier itself and the workflow directory). It fails closed on
unclassified and unattributable revisions, exactly like `app`. `ci-gate.yml` reports it
in the step summary so a shared-backend regression is attributable to a revision.

It is deliberately **not** permission: the lane runs for every application revision, so
`graph: false` never means "this revision may skip the lane". Granting that meaning
would recreate the skippable-lane problem one layer up.

### 6. Every graph path is also an application path

A graph path that `integration.yml`'s `paths:` filter does not cover could never reach
the lane. The unit tests assert the containment, so widening the graph class can never
pull a revision into a lane that will not run.

## Consequences

- Every application pull request pays a container start (~10 s) and two suites; the
  lane has its own 20-minute budget so a hung container cannot consume the job timeout.
- Deleting the job, the `needs:` entry, the `env:` block or the classifier globs now
  fails `tests/scripts/ci-graph-lane.test.mjs`, `workflow-structure.test.mjs` or
  `change-class.test.mjs`, and at runtime fails either the aggregate or the required
  test.
- A host without a container runtime still cannot prove parity. That state is reported
  as UNPROVEN; nothing here converts it into a pass.
- Local development is unchanged: no flag, no server, loud skip.
- ArangoDB 3.12 remains unsupported until `SUPPORTED_ARANGO_SERIES` widens; the lane
  pins the same series so a silent drift is impossible.

## Evidence

Recorded on branch `sr6-graph-db-touchpoints`, 2026-11-07:

| Command | Result |
| --- | --- |
| `npm run lint:workflows` (actionlint 1.7.7 + shellcheck) | pass — the new job, its `services:` block and its shell validate |
| `node --test tests/scripts/workflow-structure.test.mjs` | 20/20 pass |
| `node --test tests/scripts/ci-graph-lane.test.mjs` | 2/2 pass — the lane contract and the diagnostic (non-permission) graph class |
| `node --test tests/scripts/change-class.test.mjs` | 13/13 pass, including the graph class and its fail-closed cases |
| `jest tests/unit/graph-arango-selection.test.ts` | 8/8 pass |
| `jest tests/integration/graph-db-arango-*.test.ts` (no env) | 14 skipped, exit 0, both skip banners printed |
| `SQUADRULES_ARANGO_REQUIRED=true jest tests/integration/graph-db-arango-*.test.ts` | 2 failed, exit 1, both failures name `SQUADRULES_ARANGO_URL` and `SQUADRULES_ARANGO_DATABASE` |
| Real ArangoDB 3.11 execution | **UNPROVEN locally** — the authoring host has the Docker client but no daemon socket |

## Alternatives considered

- **Path-filtered workflow.** Rejected: the required context never reports outside its
  filter (ADR 0032's original defect).
- **`if:` on the job keyed by the change class.** Rejected: reports `skipped`, which the
  aggregate cannot distinguish from "not proven", and invites weakening `needs`.
- **Environment-only contract, gate enforced by humans.** Rejected: this is the status
  quo, and it is why the shared backend has no CI evidence today.
- **`testcontainers` inside the suite.** Rejected: it moves the container lifecycle into
  Jest, requires a Docker socket in every lane that runs the suite, and still needs the
  same `services` plumbing in CI. The suites stay runnable against any deployment URL —
  a developer's compose stack, a staging server or the lane's container.
- **A service in `compose/infra.yaml`.** Rejected for this purpose: it couples a
  required gate to the fullstack profile and the application image, both of which the
  gate is meant to be independent of.

## Reopening trigger

Reopen this record when any of the following becomes true:

- a graph surface is identified that the declared globs do not cover, or the containment
  rule (every graph path is an application path) has to be relaxed;
- `SUPPORTED_ARANGO_SERIES` widens or narrows, so the pinned image must change;
- the lane's wall clock or flake rate becomes material enough to justify caching the
  ArangoDB image;
- shared-backend evidence becomes a required check in a **separate** workflow, which
  would supersede Decision 1.

Related: [0044](0044-graph-repository-port-and-arango-shared-backend.md) (the port),
[0032](0032-change-class-routing-for-required-ci-gates.md) (the always-on aggregate),
[0038](0038-lint-runs-for-every-change-class.md) (the precedent that no change class may
leave a checker unrun).
