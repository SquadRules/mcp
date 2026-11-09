# ADR 0043: Inheritance merges additively and selectively, and recovery state is a checkpoint, never a proof

## Status

Proposed — implemented and verified on branch `sr6-graph-db-touchpoints`, awaiting
independent owner ratification. Refines [ADR 0024](0024-adapter-contract-verification-ladder.md)'s
rule that the contract an agent executes is the contract it was shown, and
[ADR 0042](0042-graph-owned-by-runtime-scoped-keys-derived-topology.md)'s rule that
inheritance topology is projected from stored records. It changes neither the ladder nor
the storage class.

## Context

`inherits:` shipped, but the effective content behind it was unspecified in five places,
and each defaulted to a behaviour nobody chose:

1. **Whole-ancestor replacement.** The nearest ancestor layer replaced the child's body,
   so a child lost every section it had added. "Inherit" behaved like "become".
2. **Contract provenance.** The executed contract came from the layer that won the body,
   which meant a child could execute an ancestor's gate while `activate` had shown the
   child's own. An adapter's own verification was not the verification that ran.
3. **Silent partial ancestry.** A missing parent record, a cycle, or an over-deep chain
   produced a shorter chain and a `resolved: true` answer, so an agent was told an
   inheritance had resolved when part of it had not.
4. **Author properties were not data.** The graph node and the merge read a fixed set of
   fields, so an author-declared property (`risk_level: high`) vanished on the way through
   and `override: [risk_level]` was rejected as an unknown field against a parent that
   really did declare it.
5. **Restart was undocumented.** A retried `forward` after a crash had no way to know
   which ancestry stages it had already resolved, and no statement of what such state may
   be mistaken for.

One more defect was found while writing the tests for §1: the writer's heading sanitizer
rewrote `## Step 1` to a bare `##`, which is not a heading. The section lost its key, so
no descendant could inherit or override it.

## Decision

### 1. The merge is additive and selective

`mergeAdapterMarkdown` is a pure function over the stored layers, root first, child last.

- The child is the spine: its section order is the output order and its preamble is the
  document preamble.
- A section is identified by a **key**: the heading text, lowercased with whitespace
  collapsed. The heading is the override unit, because it is the only thing an author
  writes that a reader can also see.
- An ancestor section is inherited when no nearer level has claimed its key. A nearer
  level that claims an inherited key is the **explicit override**, and the pair
  `key -> claiming slug` is recorded in `overrides` so the lineage stays auditable.
- A child-only section is an **addition** and is never dropped.
- A body block that precedes every heading in an ancestor has no key, so it is not
  inherited. Adapter documents are heading-structured by construction; inventing a key
  for unheaded prose would guess at the author's intent.
- A heading that is nothing but its prefix (`## Step 1`, `## 3.`) is kept verbatim. The
  sanitizer still strips a prefix that has a name after it (`## STEP 1 — Foo` → `## Foo`).

### 2. The child's own contract is what `forward` executes

A stored layer keeps its contract on the record, not as a fence in its body, so the merge
takes each level's carried contract as the primary source (nearest level first) and only
then fences a hand-written body still contains. `effective_contracts[0]` is the executable
contract, and `applyEffectiveContent` writes exactly that value onto the child memory.
Consequence: a child layer that declares a contract always executes its own; an ancestor
contract is inherited only when the child layer carries none. `activate` surfaces the same
ordered list it resolved, so the shown contract and the executed contract cannot diverge.

Identity is never merged: slug, version, adapter id, `memory_uuid` and scope stay the
child's.

### 3. Incomplete ancestry fails closed

The walk returns a reason instead of a shorter chain: `parent_missing`,
`inheritance_cycle`, `inheritance_depth_exceeded` (32 levels). A reason always produces
`resolved: false` plus `resolved_reason`, and a warning is logged for the agent. When the
child alone could be materialised nothing is substituted at all; when some ancestors
resolved, the resolvable ones are merged and executed — but the result is still reported as
unresolved. `resolved: true` means the whole declared ancestry resolved to content, and
nothing else may claim it.

### 4. Author frontmatter is data, not a schema

`inheritanceFromStoredRecord`, `toStoredAdapterFrontmatter` and
`upsertAdapterFromFrontmatter` all copy every stored field verbatim. `override:` is
validated against the parent's actual keys plus the documented overridable set, so a
declared domain property is overridable and an undeclared one is still rejected.
Structural keys (`contract`, `type`, `steps`, `chain_root`, `inherits`, `override`,
`verdict`, `work_envelope`, `effective_contracts`) remain vetoed before anything is
written.

### 5. Resume state is a checkpoint, not a proof

`InheritanceCheckpointService` writes one JSON file per ancestry stage into a directory
owned by the running instance, atomically (temp file then rename), keyed by
`execution_id + scope_id + adapter_slug` and stamped with each stage's version and content
digest.

- `load` reports `missing`, `resumed` (with a SHA-256 token that names no filesystem path)
  or `stale` with an explicit reason; only a matching identity and matching stage digests
  resume.
- A terminal resolution removes the directory; an abandoned one expires after the TTL
  (24 h by default) and is swept.
- A checkpoint never substitutes for a proof: it carries no verdict, no exit code and no
  output, `reward` and the quality paths never read it, and a write failure is logged at
  debug level and ignored. Its only claim is "this process has already read these stages",
  which is what makes a crashed and retried run resume instead of restarting blind.

### 6. Tree display depth is presentation only

`SQUADRULES_TREE_DISPLAY_DEPTH` (0 = full, the default) trims the surfaced `lineage` array
and sets `lineage_truncated`. Content, contracts, the recorded lineage and the
materialisation walk are never trimmed by it.

## Consequences

### Positive

- A child adapter is genuinely a delta: its additions survive, and every inherited section
  has a visible, auditable owner.
- `activate` and `forward` cannot disagree about which contract runs.
- An agent is never told an inheritance resolved when it did not, and a missing parent is a
  warning with a reason instead of a quiet downgrade.
- A crashed resolution resumes from the stages it had already read, without the server
  exposing a path or the client learning a private directory name.

### Negative

- The heading is the override unit, so two authors who name sections differently cannot
  override each other. This is the price of visibility and is deliberate.
- Unheaded ancestor prose is not inherited.
- A checkpoint file lives for up to the TTL after an abandoned run, which is a small amount
  of disk the sweep, not the agent, is responsible for.

## Verify

- `tests/integration/adapter-inheritance-effective-content.test.ts` — real LadybugDB, real
  LanceDB, production `train`/`tune`, three-level additive merge, exact effective
  contracts, arbitrary frontmatter, structural veto, missing parent and cycle fail-closed,
  checkpoint resume/invalidations/TTL.
- `tests/unit/graph-db-forward-unit.test.ts` — the resolver and merge against the real
  record-source contract, with the graph and logger as doubles.
- `tests/unit/adapter-builder.test.ts` — a nameless numbered heading survives storage.

## Revisit

An author needs unheaded ancestor prose inherited, or the merge's heading-key rule proves
insufficient for a real adapter family — then add an explicit section-identity field rather
than loosening the key. Or a deployment needs a checkpoint to be readable by a *different*
process (a second server instance), which invalidates the owner-instance directory.
