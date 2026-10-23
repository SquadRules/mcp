# ADR 0028: Rename the `mcp` contract type to `forward`

## Status

Accepted — decision taken 2026-10-22 and implemented by the accompanying change;
not yet on `main` when this record was written. **Supersedes
[ADR 0025](0025-mcp-contract-forward-link-only.md)**: 0025's forward-link-only
rule is carried forward unchanged, its body is preserved, and only its Status
line is reconciled.

## Context

[ADR 0025](0025-mcp-contract-forward-link-only.md) restricted the `mcp` contract
type to a single use — a forward link to another adapter — and removed bare MCP
tool calls from the contract vocabulary. The restriction was correct and survives
here intact. The **name** did not survive it, and once 0025 landed the name
became the defect.

**The runtime contradicted the rule it was enforcing.**
`buildChallengeShapeForDisplay` (`src/tools/next-pow-challenge-shape.ts:20`)
rendered every `mcp` challenge to the executing agent as:

> `Call MCP tool: forward. … You MUST actually call this tool and report its real
> result; do not fabricate.`

Read literally, that instructs the agent to invoke an MCP tool inline — the exact
behaviour 0025 exists to ban. The type name leaked into the challenge
description, and the challenge description is the text the agent actually obeys.
The validator enforced one rule at `train` time while the prompt emitted at run
time taught the opposite.

**The name collides with every model's prior.** To every model this project runs
on, `mcp` means "Model Context Protocol tool call", and the surrounding
vocabulary reinforces that reading: the server is an MCP server, its tools are
MCP tools, the transport is MCP, the audit category is `audit.mcp`. An author or
an agent reading `"type": "mcp"` reasonably concludes the contract wants a tool
call. It wanted the opposite. 0025's Consequences already recorded that its
mid-adapter exemption "is a hole an author can argue through"; the type name is
what makes the hole arguable, because it invites the wrong reading before the
author ever reaches the rule.

**The payload shape argued back.** An `mcp` contract carried
`{ tool_name: "forward", arguments: { uri: "squadrules://adapter/<slug>" } }`
(`src/types/memory.ts:32–37`). With `tool_name` pinned to the single legal value
`"forward"` by 0025, that field carries no information — it is a constant
restated in every stored adapter and every example. `arguments.uri` is a generic
tool-argument envelope wrapped around the one fact the contract actually states:
which adapter comes next. The wrapper also forced a generic deep-subset argument
matcher (`isPlainMcpArgumentsObject`, `deepMcpArgumentSubset` in
`src/tools/mcp-contract-match.ts`) to be maintained for a comparison that is
really a string equality check.

**A third use for the word arrived.** Rung 3 of the verification ladder
([ADR 0024](0024-adapter-contract-verification-ladder.md) §1) needs to name the
real MCP tool calls a *subagent* must make. That field belongs at `subagent.mcp`,
and it cannot be introduced while a top-level contract type is also called `mcp`:
the same word would mean "an adapter link" at the top level and "a real tool
call" one level down, inside the same JSON object. That addition is recorded in
[ADR 0029](0029-subagent-mcp-and-context-authority.md); the rename here is what
makes it unambiguous.

## Decision

1. **Rename the top-level contract type `mcp` → `forward`.**
   `InferenceContractType = 'shell' | 'forward' | 'user_input' | 'comment' | 'subagent'`
   (`src/types/memory.ts:15`).
2. **Flatten the payload: `mcp.arguments.uri` → `forward.target`.** The contract
   becomes
   `{"type":"forward","forward":{"target":"squadrules://adapter/<slug>"},"required":true}`,
   with an optional `forward.expected_result`.
3. **Drop `tool_name`.** 0025 pinned it to `"forward"`; it is now the type name.
   No information is lost.
4. **Rename the validator rule `mcp_link_only` → `forward_link_only`**
   (`src/services/memory/validate-protocol-structure.ts:28`). The rule is
   unchanged in force: `forward.target` must match
   `/^squadrules:\/\/adapter\/[^\s/]+$/` and anything else fails closed at
   `train`. `isMcpForwardLink` becomes `isForwardLink`, reading
   `contract.forward?.target` instead of `contract.mcp.tool_name` plus
   `contract.mcp.arguments.uri` (:82–87).
5. **Simplify the submission match.**
   `validateMcpSubmissionAgainstContract` becomes
   `validateForwardSubmissionAgainstContract`; the two codes
   `MCP_TOOL_MISMATCH` and `MCP_ARGUMENTS_MISMATCH` collapse into one
   `FORWARD_TARGET_MISMATCH`, and the deep-subset matcher is deleted with the
   wrapper it existed to unpack. `src/tools/mcp-contract-match.ts` is renamed to
   `src/tools/forward-contract-match.ts`.
6. **No read-time normalizer and no compatibility alias.** `type: "mcp"` is not
   accepted, silently rewritten, or mapped onto `forward`. See Alternatives.
7. **Rename every surface that offers the type**, including the UI
   (`CHALLENGE_TYPE_KEYS`, the run and edit forms, the `run.mcp.*` and
   `protocolEdit.mcpToolName` i18n keys), the shipped embed-docs bundle, the
   curated docs and examples, and the integration scripts — so no surface still
   presents `mcp` as a contract type.

The word `mcp` survives exactly where it is true: MCP server, MCP tool, MCP
transport, `audit.mcp`, and the new `subagent.mcp` delegation list.

## Consequences

### Positive

- The runtime stops contradicting the validator. The challenge description now
  reads "Forward to adapter `squadrules://adapter/<slug>`", which is what the
  contract means and what 0025 permits.
- The type name states the contract's behaviour, so the misreading that made
  0025's exemption arguable is removed at the source rather than patched with
  more prose.
- Stored adapters get smaller and the matcher gets simpler: one string equality
  check replaces a constant field plus a recursive subset comparison and its
  three helper functions.
- `subagent.mcp` can now be added without the word `mcp` meaning two things at
  once ([ADR 0029](0029-subagent-mcp-and-context-authority.md)).
- The rename lands in the same change as the addition, so no released version
  ever ships the ambiguous intermediate state.

### Negative

- **This is a breaking wire change.** `contract.type`, the solution `type`, and
  the proof record field all change name on the wire. Any external client that
  hard-codes `type: "mcp"` stops working. The project has a single consumer
  (this repository's own skill, UI, and scripts) and the owner's standing
  precedent is a fast break announced in the PR body rather than a compatibility
  window; the release is cut as a minor bump accordingly, with the break recorded
  here instead of in a `BREAKING CHANGE:` footer.
- **Stored `type: "mcp"` adapters fail closed.** There is no shim. A stored
  adapter carrying the old type reaches `buildChallengeShapeForDisplay`'s new
  unknown-type guard and returns
  `Unsupported contract type "mcp". This adapter must be re-trained with a
  current contract type (shell, forward, user_input, comment, or subagent).`
  rather than an opaque Zod enum rejection, and re-`train`ing the same content
  fails `invalid_contract_type`. Recovery is deliberate and already shipped:
  run the `adapter-migration` adapter (`squadrules://adapter/adapter-migration`),
  whose structural checks now include the forward-link rule, to rewrite the
  affected adapters in place.
- **The UI renames too.** The edit form's tool-name input becomes a target-URI
  input, and the i18n keys move. Any screenshot-based documentation or external
  walkthrough of the edit page is stale.
- **Documentation churn.** Every shipped embed-doc, the curated `docs/` allowlist,
  the examples, and the always-active skill reference the type. All are updated in
  this change; the generated `.qoder/repowiki` content and
  `src/resources/embedded-mcp-resources.ts` are regenerated rather than
  hand-edited.
- 0025's Evidence table cites files by their pre-rename paths and line numbers
  (`docs/examples/adapter-example-mcp.md`). Those citations are historical and
  are intentionally left as written; the file is now
  `docs/examples/adapter-example-forward.md`.

## Alternatives Considered

### Keep the type named `mcp`

Rejected. It preserves the runtime contradiction ("Call MCP tool: forward") and
the model-prior collision, and it blocks `subagent.mcp` outright — the word
cannot mean "adapter link" at the top level and "real tool call" one level down
in the same object. 0025 already had to spend a Consequences paragraph and a
named exemption defending the type against its own name.

### Keep the `tool_name` / `arguments` wrapper

Rejected. Lower churn — the generic subset matcher survives untouched — but it
preserves the "this looks like an MCP tool call" shape that the rename exists to
remove, and it keeps a constant (`tool_name: "forward"`) duplicated into every
stored adapter. The flat `forward.target` is honest, reads correctly to a model,
and reduces the matcher to a target comparison.

### Add a read-time normalizer (`type: "mcp"` → `forward`)

Rejected. `normalizeContract` (`src/tools/forward-view.ts:63`) stays a
pass-through. A normalizer would keep both spellings alive indefinitely, would
have to be mirrored in the validator, the proof store, the UI parser, and the
challenge builder, and would let stored adapters drift from the schema the
validator enforces — the same drift class that produced the
`subagent.instruction` bug recorded in
[ADR 0029](0029-subagent-mcp-and-context-authority.md). Failing closed with a
readable message plus a shipped migration adapter is cheaper than a permanent
translation layer for a single-consumer system.

### Rename but keep `mcp` as an accepted alias for one release

Rejected for the same reason, at smaller scale: it makes the wire change
non-breaking only for clients that were already correct, and it defers the
cleanup into a second change that has to be remembered. The fast break is the
owner's stated precedent.

### Predefined list-of-choices / branching forward menu (one-of-N targets)

Explicitly **deferred by the owner** and out of scope for this record. Noted here
so the deferral is discoverable: a `forward` contract naming several acceptable
targets would weaken the equality check in Decision §5 to a membership check, and
would need its own record.

## Evidence

- `src/tools/next-pow-challenge-shape.ts:20` — the contradiction, verbatim:
  ``result['description'] = `Call MCP tool: ${toolName}. …` `` emitted for every
  `mcp` challenge, while
  `src/services/memory/validate-protocol-structure.ts:82–87` rejects any `mcp`
  contract whose `tool_name` is not `"forward"`.
- `src/types/memory.ts:15` — `InferenceContractType` including `'mcp'`;
  `:32–37` — `mcp?: { tool_name; arguments?; expected_result? }`, the wrapper
  with its constant field.
- `src/services/memory/validate-protocol-structure.ts:28` — `MCP_LINK_ONLY =
  'mcp_link_only'`; `:30` — `ALLOWED_CONTRACT_TYPES`; `:36` —
  `ADAPTER_FORWARD_LINK_URI`; `:57`, `:63–65` — the table-driven
  `CONTRACT_TYPE_POLICIES` entry the rename re-keys.
- `src/tools/mcp-contract-match.ts` — `validateMcpSubmissionAgainstContract`,
  `MCP_TOOL_MISMATCH`, `MCP_ARGUMENTS_MISMATCH`, `isPlainMcpArgumentsObject`,
  `mcpArgumentValuesMatch`, `deepMcpArgumentSubset`: the generic matcher the
  wrapper required.
- `src/tools/next-pow-helpers.ts:252–267` — the `proofType === 'mcp'` proof
  branch writing a nested `record.mcp`.
- `src/tools/forward_schema.ts:16,25–29,41,57–76,165–176,186,197,265,273` and
  `src/tools/next_schema.ts:18,27–32,40–49,55,69–73` — the enums, payload
  fields, `typeToField` map, and `normalizeForwardSolutionFormat` that carry the
  name through the wire schema.
- `src/ui/pages/protocol-edit/constants.ts:18`,
  `src/ui/components/run/SolutionForm.tsx:29–32,56,80–89,170–205`,
  `src/ui/hooks/useProtocol.ts:67,81,139–140,177,192,239`,
  `src/ui/i18n/en.json:142–146,200` — the surfaces offering `mcp` as a type.
- `src/embed-docs/mem/README.md:31–33,99–107`,
  `src/embed-docs/mem/challenge-type-guide.md:49,58,79–86,128,229,258`,
  `src/embed-docs/mem/protocol-linking-guide.md:128–142,184,200`,
  `src/embed-docs/mem/critic-loop-guide.md:124,130,228`,
  `src/embed-docs/mem/adapter-migration.md:100–101,190`,
  `src/embed-docs/tools/forward.md:102–114,148–149` — the shipped bundle that
  teaches the type.
- `docs/adapter-authoring-guide.md:42,82–101`,
  `docs/examples/challenge-types.md:36–43,81`,
  `docs/examples/adapter-example-mcp.md`, `docs/examples/adapter-example-all-types.md:29–44`,
  `docs/examples/README.md:10,20,23`,
  `docs/adapter-design-principles.md:127` — the curated docs.
- `.agents/skills/squadrules/references/action-routing.md:40–43` — the
  always-active skill's proof-types list naming `mcp`.
- `scripts/test-ai-mcp-integration-proof-utils.mjs:1` — `CONTRACT_TYPES`
  including `'mcp'`; `scripts/test-ai-mcp-integration.mjs:111–119,306–310` — the
  solution builder and the explicit example list.
- [ADR 0025](0025-mcp-contract-forward-link-only.md) Consequences — "The
  mid-adapter exemption is a hole an author can argue through", and its own
  reversal history (erase → keep, 2026-10-19): the type has been argued about
  twice under a name that keeps re-opening the argument.

## Revisit condition

Reopen if the fast break proves wrong — specifically, if a consumer outside this
repository is found holding stored `type: "mcp"` adapters that the
`adapter-migration` path cannot reach, or if the unknown-type guard's message
turns out not to be actionable for the agents that hit it. Also reopen if a
legitimate need appears for a `forward` contract that names something other than
an adapter (a tool, a URL, a layer URI), which would mean the flat
`forward.target` needs a discriminator after all. The deferred branching-menu
idea gets its own record, not a reopen of this one. Track via a new issue; do not
rewrite this record.

## Related

- [ADR 0025](0025-mcp-contract-forward-link-only.md) — **superseded** by this
  record. Its forward-link-only rule stands unchanged as `forward_link_only`; its
  body is preserved and only its Status line is reconciled.
- [ADR 0024](0024-adapter-contract-verification-ladder.md) — the ladder. Rung 3
  is where displaced MCP tool work goes; this rename is what lets rung 3 name its
  tool calls `subagent.mcp`.
- [ADR 0026](0026-shell-interpreter-required.md) — the sibling hard structural
  rule in the same table-driven validator; `forward_link_only` and
  `shell_interpreter_required` are the two fail-closed codes.
- [ADR 0027](0027-retire-redirect-tombstones.md) — removed two of the conformant
  forward links 0025 enumerated; the remaining links are what this record
  renames.
- [ADR 0029](0029-subagent-mcp-and-context-authority.md) — lands with this
  record; adds `subagent.mcp` and fixes the `subagent.instruction` drift.
- [ADR 0010](0010-critic-loop-and-proof-splitting.md),
  [ADR 0017](0017-critic-loop-work-submission.md) — the reusable sub-adapter
  (`critic-loop`) that the mid-adapter `forward` link exists to serve; unchanged.
- [ADR 0014](0014-always-latest-mcp-spec-and-sdk.md) — the Model Context
  Protocol surface whose name this record stops borrowing.
