# ADR 0029: `subagent.mcp` delegation list and `subagent.context` as the authoritative field

## Status

Accepted — decision taken 2026-10-22; implemented and present on `main`, where
`subagent_mcp_invalid` is enforced. Lands together with
[ADR 0028](0028-forward-contract-type-rename.md), which frees the word `mcp` at
the top level and so makes `subagent.mcp` unambiguous.

## Context

Two independent defects and one gap sat on the `subagent` contract type.

### 1. The shipped bundle wrote a field the runtime never reads — FIXED BUG

`InferenceContractDefinition.subagent` declares exactly one field:
`subagent?: { context?: string }` (`src/types/memory.ts:44–46`). The challenge
builder reads that field and nothing else
(`src/tools/next-pow-challenge-shape.ts:32–35`):

```ts
const context = proof.subagent?.context ?? '';
result['description'] = `Delegate this task to a subagent and return its actual report. Do not perform the task yourself.${context ? ` Context: ${context}` : ''}`;
```

The shipped embed-docs instead wrote `subagent.instruction`. Nine adapter layer
contracts across four files did so
(`src/embed-docs/mem/author-adapter.md:90,124,170`,
`critic-loop.md:161,222`, `critic-loop-guide.md:242`,
`adapter-migration.md:81,117,155`), plus the illustrative template and its
explanatory prose in `challenge-type-guide.md:95,99`.

`instruction` is not in the interface, is not validated (the `subagent` policy in
`CONTRACT_TYPE_POLICIES` was an empty `subagent: {}`,
`src/services/memory/validate-protocol-structure.ts:66`), and is silently dropped
by the `?? ''` fallback. The consequence was live on `main` in `v5.12.0`: every
shipped `subagent` challenge emitted the bare delegation line with **no
task-specific context at all**. `author-adapter`, `critic-loop`,
`critic-loop-guide`, and `adapter-migration` each asked a subagent to do work
without telling it what the work was.

This is recorded as a **fixed bug**, not as a decision. It is in an ADR because
the fix has a durable half: `subagent.context` is now the *authoritative* name,
and nothing may reintroduce an alias.

### 2. Rung 3 had no way to name the tool calls it requires

[ADR 0024](0024-adapter-contract-verification-ladder.md) §1 rung 3 is
"`subagent` performing the MCP call", and
[ADR 0025](0025-mcp-contract-forward-link-only.md) sends all displaced tool work
there. But a rung-3 contract could only describe the call in free text inside
`subagent.context`. Free text is unverifiable in two directions: the subagent can
narrate a call it never made, and the caller has no structured statement of what
was required, so nothing can check the delegation was even specified. Rung 3 was
the ladder's escape hatch and it was the least specified rung on it.

### 3. A constraint from the proof hash

`hashProofRecord` (`src/tools/next-pow-helpers.ts:34`) canonicalises with

```ts
const canonical = JSON.stringify(record, Object.keys(record).sort());
```

`JSON.stringify`'s second argument, when it is an **array**, is a *replacer
allowlist applied at every depth*, not a key ordering hint. Only the record's own
top-level keys appear in it, so any nested object in the record is serialised
with all of its keys stripped: `{ forward: { target, success } }` would hash as
`{"forward":{}}`. Two different proofs would then produce the same hash. The
subagent branch (:312–318) sets only `record.status`, so it is safe today — but
the pitfall is one nested field away from silently weakening every proof hash in
the system, and nothing in the code says so.

## Decision

### 1. `subagent.context` is the authoritative field

`context` is the only task-guidance field on a `subagent` contract. All nine
shipped adapter contracts and the guide template are corrected to `context`.
`instruction` is not accepted as an alias, not normalised at read time, and not
added to the interface — the same no-shim position as
[ADR 0028](0028-forward-contract-type-rename.md) Decision §6, for the same
reason: an alias keeps two spellings alive and lets stored adapters drift from
the schema the runtime reads.

The mandatory delegation instruction is still appended by the application, not by
the author (`MANDATORY_DELEGATION_INSTRUCTION`,
`src/tools/forward-view.ts:18,257`); `context` is the task-specific half only.

### 2. Add an optional structured `subagent.mcp` for rung-3 delegated tool calls

```ts
subagent?: {
  context?: string;
  mcp?: Array<{ tool_name: string; arguments?: Record<string, unknown> }>;
};
```

- **Optional.** Absence is valid, so rung-2 judgment contracts stay clean and no
  existing adapter changes meaning.
- **`subagent.mcp` means real MCP tool calls executed *by the subagent*.** Never
  a forward link, never a call on the caller's thread. The transcript stays in
  the subagent's context; that isolation is the entire reason rung 3 exists
  ([ADR 0024](0024-adapter-contract-verification-ladder.md) §1,
  [ADR 0025](0025-mcp-contract-forward-link-only.md)).
- **Hard-enforced shape.** The previously empty `subagent` policy gains a
  `validate` closure: if `mcp` is present it must be an array; each entry must be
  an object with a non-empty string `tool_name`; `arguments`, if present, must be
  a plain object (not an array, not null). Violation is a new `missing` code,
  `subagent_mcp_invalid`, reported by
  `src/services/memory/validate-protocol-structure.ts` and surfaced through
  `train`. This is objective and fail-closed, so it belongs in the validator
  rather than with the soft ladder rules
  ([ADR 0024](0024-adapter-contract-verification-ladder.md) §6).
- **Surfaced in the challenge.** The challenge description names the tools the
  subagent must call, and `result['subagent']` carries `{ context, mcp? }` so the
  executing agent sees the required calls as data, not as prose it must parse.

### 3. Proof stays `evidence.report`

`subagent.mcp` changes what the contract *requires*; it does not change what the
caller *submits*. Proof remains the subagent's actual report in
`evidence.report`, unchanged from
[ADR 0024](0024-adapter-contract-verification-ladder.md) §2. `mcp` is **not**
added to the subagent *solution* schema, and the caller must not echo the tool
transcript back — doing so would put the transcript in the caller's context
through the proof channel, defeating the point.

### 4. The hashed proof record stays flat

`record.subagent` continues to set `status` only, and `record.forward` (the
renamed `record.mcp`) is `{ target, success }` — no nested `arguments` object.
The constraint and its cause are recorded here so the next author does not
rediscover it: `hashProofRecord`'s replacer-array form strips every nested key
at every depth (Context §3). **If nested data ever needs to enter a hashed proof
record, `hashProofRecord` must be fixed first** — replace the replacer array with
a real recursive canonicaliser — and that is its own record, not an amendment to
this one.

## Consequences

### Positive

- The live defect is gone: shipped subagent challenges now carry their
  task-specific context. Four bundled adapters that were delegating blind
  (`author-adapter`, `critic-loop`, `critic-loop-guide`, `adapter-migration`)
  delegate with instructions again.
- Rung 3 becomes specifiable. A contract can now state the exact calls whose
  results constitute the evidence, which is what makes "the subagent did the tool
  work" reviewable rather than asserted.
- The proof-hash pitfall is documented at the place the next author will look,
  and the flat-record constraint has a stated reason instead of being a
  coincidence.
- `subagent.mcp` is unambiguous: with
  [ADR 0028](0028-forward-contract-type-rename.md) there is no top-level `mcp`
  type, so the word means exactly one thing everywhere in a contract.

### Negative

- Structuring the delegation list creates a temptation to treat it as proof. It
  is not: an adapter can list calls and receive a report that never mentions
  them, because nothing compares the two. Verification of the *report* remains
  judgment (rung 2's critic) or observation (rung 1's shell check). Accepted —
  the alternative (requiring the caller to echo transcripts) is the pollution
  rung 3 exists to prevent.
- Two field names on `subagent` (`context`, `mcp`) instead of one, and one more
  `missing` code in the validator's vocabulary.
- The bug was silent for at least one release. Nothing structural caught a
  contract field the interface does not declare, and the `?? ''` fallback turned
  the mismatch into an empty string rather than an error. A schema-strictness
  check on contract blocks (reject unknown keys under a type's payload) would
  have caught it at `train` time; it is deliberately **not** added here, because
  it would reject every stored adapter carrying a field this project has since
  removed. Reopen under the condition below if the drift recurs.
- Correcting the nine contracts changes the text of four bundled adapters, so
  their content hashes change and any cached embedding is invalidated on the next
  `train`.

## Alternatives Considered

### Accept `instruction` as an alias for `context`

Rejected. It preserves the drift permanently, needs mirroring in the interface,
the builder, the validator, the UI parser, and every doc, and it leaves authors
guessing which spelling is current. The same reasoning rejects a read-time
normalizer.

### Make `subagent.mcp` required on rung-3 contracts

Rejected, and not enforceable. The validator cannot tell rung 2 from rung 3 —
both are `type: "subagent"`, and the distinction is a judgment about whether the
evidence is a tool result. Requiring the list would push authors to invent a
token tool call to satisfy it, which is worse than no list.

### Express the required calls in `subagent.context` prose and parse it at runtime

Rejected. It makes the requirement unvalidatable at `train` time, unrenderable as
data in the challenge, and dependent on a natural-language parse of text the
author also uses for criteria and inputs. A structured list is the whole point.

### Let the caller submit the tool transcript as proof

Rejected outright. It puts the transcript in the caller's context through the
solution channel, which is exactly the defect
[ADR 0025](0025-mcp-contract-forward-link-only.md) removed for inline calls, and
it would grow the hashed proof record with nested data (Decision §4).

### Fix `hashProofRecord` now

Deferred. It is not broken by this change — the subagent record sets `status`
only and the forward record is flat — and fixing the canonicaliser changes every
proof hash, which is a separate break needing its own record. The constraint is
documented here instead, where the next person adding a proof field will read it.

## Evidence

- `src/types/memory.ts:44–46` — `subagent?: { context?: string }`, the interface
  the shipped bundle contradicted.
- `src/tools/next-pow-challenge-shape.ts:32–35` — the builder reading
  `proof.subagent?.context ?? ''`, which turned the mismatch into an empty
  context rather than an error.
- `src/embed-docs/mem/author-adapter.md:90,124,170`,
  `src/embed-docs/mem/critic-loop.md:161,222`,
  `src/embed-docs/mem/critic-loop-guide.md:242`,
  `src/embed-docs/mem/adapter-migration.md:81,117,155` — the nine adapter layer
  contracts written with `instruction`;
  `src/embed-docs/mem/challenge-type-guide.md:95,99` — the template and the prose
  that taught the wrong field name ("The `instruction` field provides
  task-specific guidance").
- `src/services/memory/validate-protocol-structure.ts:66` — `subagent: {}`, the
  empty policy that let the unknown key through at `train`.
- `src/tools/next-pow-helpers.ts:312–318` — the subagent proof branch requiring
  `evidence.report` and setting `record.status` only; `:34` — `hashProofRecord`'s
  `JSON.stringify(record, Object.keys(record).sort())`.
- `src/tools/forward-view.ts:18,257` — `MANDATORY_DELEGATION_INSTRUCTION`,
  appended by the application, which is why `context` carries only the
  task-specific half.
- [ADR 0024](0024-adapter-contract-verification-ladder.md) §1 rung 3, §2
  (`evidence.report`), §6 (soft vs hard enforcement split).
- [ADR 0025](0025-mcp-contract-forward-link-only.md) — the record that sends
  displaced tool work to rung 3 and therefore creates the specification gap this
  record closes.
- `docs/examples/adapter-example-subagent.md` — rungs 2 and 3 side by side;
  `docs/examples/adapter-example-all-types.md` Step 3 — the optional list in the
  reference demonstration.

## Revisit condition

Reopen if the `context`/`instruction` drift recurs — that is, if a contract field
is again shipped in the bundle that the runtime does not read — in which case the
fix is a contract-block strictness check (reject unknown payload keys per type)
plus a unit test that every shipped `src/embed-docs/mem/*.md` contract parses
against `InferenceContractDefinition`. Also reopen if a rung-3 delegation needs
to express more than `tool_name` and `arguments` (ordering, expected results,
per-call timeouts), or if the flat-record constraint in Decision §4 blocks a
genuine need, which then requires fixing `hashProofRecord` first under its own
record. Track via a new issue; do not rewrite this record.

## Related

- [ADR 0024](0024-adapter-contract-verification-ladder.md) — the ladder. Rung 2
  and rung 3 are both `subagent`; this record makes rung 3 specifiable and fixes
  the field both rungs are written in.
- [ADR 0028](0028-forward-contract-type-rename.md) — lands with this record and
  frees the word `mcp` at the top level, which is what makes `subagent.mcp`
  unambiguous.
- [ADR 0025](0025-mcp-contract-forward-link-only.md) — superseded by 0028; its
  displacement of bare tool calls to rung 3 is the gap Decision §2 closes.
- [ADR 0026](0026-shell-interpreter-required.md) — the sibling hard structural
  rule in the same table-driven validator; `subagent_mcp_invalid` joins
  `shell_interpreter_required` and `forward_link_only`.
- [ADR 0010](0010-critic-loop-and-proof-splitting.md),
  [ADR 0017](0017-critic-loop-work-submission.md) — the rung-2 critic and the
  typed work submission it reviews; unchanged.
