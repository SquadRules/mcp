# Adapter Authoring Guide: Flow, Ladder, and Contract Selection

This guide is the *how*. It applies the
[design principles](adapter-design-principles.md) — autonomy, help over puzzles,
honest verification — to adapter flow and contract selection. For the exact JSON
field names of each contract type and the matching `forward` solution shapes, see
[contract types](examples/challenge-types.md); this guide covers when to choose
each type and how many to use. Binding decisions are recorded in the ADRs linked
throughout — read them for rationale, not restated here.

## Define the flow first

State the trigger, the required inputs, the authority the agent already has, the
intended outcome, and the evidence that demonstrates completion. Group reversible
work into meaningful stages. Give each stage explicit instructions and a failure
response.

Add a contract only where its result changes whether execution proceeds, repairs,
stops, or asks for help. A stage is not automatically a separate layer or an extra
round trip: keep dependent instructions together when no intermediate result needs
its own decision.

## The verification ladder

Verification is an **ordered ladder, and the first applicable rung wins**. This
replaces any "purpose-based, not ranked" reading — an author must argue *out* of a
higher rung, and the argument is reviewable. The full decision, counts, and
exemptions are in
[ADR 0024](adr/0024-adapter-contract-verification-ladder.md).

| Rung | Type | Use when | Evidence it produces |
| --- | --- | --- | --- |
| 1 | `shell` | The step leaves something observable — a file, exit status, git ref, report line | The observed state, checked empirically |
| 2 | `subagent` | Correctness needs judgment that cannot be reduced to a test — intent, coverage, tone | The reviewer's report against explicit criteria |
| 3 | `subagent` | The evidence is a tool result the caller should not have to hold | The subagent's report; the tool transcript stays out of the caller's context |
| Fallback | `comment` | No observable artifact and no judgment required — a read-only or knowledge adapter | A single closing acknowledgment |

Descend only when the higher rung genuinely cannot apply, and say why in the
adapter text. "Was faster to write" is not a reason. Rungs 1–3 and the fallback are
**soft-enforced** through this guide, the `critic-loop` review checklist, and the
`author-adapter` authoring checklist; the hard, fail-closed structural rules are
the two objective ones below (`shell_interpreter_required`, `forward_link_only`).

## How many contracts

- **One per adapter is the default.** Shell checks are safety gates, not puzzles.
- **The minimum is always 1** — a `shell` check, a `subagent` critic, or a
  `comment` acknowledgment for a read-only adapter. An adapter with no contract
  block is already a structural failure (`contract_block`).
- **Extra `shell` gates** are justified only before an action that is hard to roll
  back (for example, work committed and pushed on the wrong branch). One gate per
  genuine irreversible boundary is proof splitting
  ([ADR 0010](adr/0010-critic-loop-and-proof-splitting.md)), not a quantity
  exemption.
- **`comment`: at most one per adapter, never combined** with another type. An
  adapter with any observable step does not also get an acknowledgment layer.

Named exemptions (closed; extend only by a new ADR): knowledge and reference
adapters get exactly one closing acknowledgment; and
[`docs/examples/adapter-twelve-step-linear-test.md`](examples/adapter-twelve-step-linear-test.md)
is a designated UI and long-run fixture whose many layers are the thing under
test, not a verification strategy.

## Per-type rules

### `shell` — rung 1, empirical (preferred)

- **`interpreter` is required**, one of `bash`, `sh`, `python3`, `python`, `node`
  ([ADR 0026](adr/0026-shell-interpreter-required.md)). An absent interpreter is an
  invalid contract (`shell_interpreter_required`), not a request for `bash`. Build
  tools (`docker`, `npm`, `terraform`) are not interpreters — wrap them or export a
  script.
- Prefer **empirical checks** that assert on content or resulting state, not merely
  that a file exists.
- For complex or JSON-shaped work use the **script-export pattern**: ship the gate
  as a script **artifact** attached to the adapter, materialize it into
  `$SQUADRULES_LOCAL_ARTIFACT_DIR` at run time, and keep the contract a one-line
  invocation of that script — `interpreter: "bash"`, `cmd: python3
  "$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/<name>.py" --gate <name>`. One
  dispatcher script serves many gates; never inline a multi-step program into
  `cmd`. A script *file* therefore needs that wrapper line — why: [contract
  types](examples/challenge-types.md). Artifact input contract: the `train` tool
  description; interpreter rule:
  [ADR 0026](adr/0026-shell-interpreter-required.md).

Examples: [adapter-example-shell.md](examples/adapter-example-shell.md) for a one-line check, and
[artifact-gate/adapter-example-artifact-gate.md](examples/artifact-gate/adapter-example-artifact-gate.md)
for a gate script artifact with its contract.

### `forward` — link to another adapter

A `forward` contract **must** link to another adapter
([ADR 0028](adr/0028-forward-contract-type-rename.md), which supersedes
[ADR 0025](adr/0025-mcp-contract-forward-link-only.md)):

- `forward.target` matches `squadrules://adapter/<slug>`.

Use it to **chain to the next adapter** at the tail, or mid-flow to a **reusable
sub-adapter** driven through its own forward/reward loop — `critic-loop` at a phase
boundary is the standing case. A forward contract without `forward.target` is not a
chain link and fails the same rule.

**Bare tool calls are not valid `forward` contracts.** A `forward` contract names an
adapter, never a tool: `activate`, `export`, `getMergeRequest`, and similar are
rejected (`forward_link_only`), because every such call dumps its full transcript
into the executing agent's context. Re-express it as a `subagent` contract (rung 3),
or as an instruction the agent carries out and a `shell` check on the artifact it
leaves behind (rung 1).

Example: [adapter-example-forward.md](examples/adapter-example-forward.md).

### `subagent` — rungs 2 and 3

For **delegated judgment** (rung 2) or **delegated MCP tool work** (rung 3). The
challenge is instruction-based; give the subagent explicit inputs, criteria, and
the required result. Proof is the subagent's actual report (`evidence.report`),
not the caller's summary of it. For rung 2, loop the critic to `PASS`
([ADR 0010](adr/0010-critic-loop-and-proof-splitting.md),
[ADR 0017](adr/0017-critic-loop-work-submission.md)); for rung 3, the subagent
returns only its report so the tool transcript never reaches the caller.

**When to fill `subagent.mcp`.** Fill it when the step's evidence *is* a specific
MCP tool result — naming the calls (`tool_name` plus `arguments`) stops the
subagent from substituting a plausible narrative for the real call. Leave it out
for rung-2 judgment, where the free text in `subagent.context` is the whole
instruction and no tool call is required. The field is optional either way; the
example below shows both rungs side by side, and
[ADR 0029](adr/0029-subagent-mcp-and-context-authority.md) records why the
delegation list is structured while the proof stays a flat report.

Example: [adapter-example-subagent.md](examples/adapter-example-subagent.md).

### `user_input` — emergency only

For a genuine authority or decision gap the agent cannot resolve autonomously
([ADR 0009](adr/0009-autonomous-adapter-execution-no-human-gates.md)) — **not**
routine confirmation or an approval gate. Reuse existing authorization rather than
asking for it again. The prompt states what the agent determined, why it cannot
decide alone, and the specific answer it needs.

Example: [adapter-example-user-input.md](examples/adapter-example-user-input.md).

### `comment` — last resort

A single closing acknowledgment for a read-only or knowledge adapter that produces
no observable artifact and needs no judgment. At most one per adapter, never
combined with another type (see the quantity rules above). `min_length` does not
establish understanding or execution — label it a run-completion formality, not
verification.

Example: [adapter-example-comment.md](examples/adapter-example-comment.md).

For a side-by-side reference of every shape, see
[adapter-example-all-types.md](examples/adapter-example-all-types.md).

## Failure and completion

For every contract, name the failure it detects, what its evidence proves, the next
action on failure, and the retry limit. Distinguish a failed result from a check
that could not run. Preserve valid work and never turn either into a false pass.
Knowledge adapters need no understanding test; a closing acknowledgment is
run-completion only.

## Lifecycle flows

The executable, step-by-step flow for these operations lives in the
`author-adapter` workflow (`squadrules://adapter/author-adapter`); the guidance
below is the authoring angle — which rung and how many contracts each operation
needs. All four operations are autonomous: no human approval gate, and the
`critic-loop` `PASS` verdict is the sole quality gate for a mutation.

- **Create** — resolve intent and gather requirements without a confirmation
  prompt; draft the markdown. Verify readiness with one combined `shell` check on
  the draft's mechanical structure, and use a `subagent` critic (rung 2) for
  intent, authorization, and clarity. Publish with `train`, attach any gate
  script with a second `train` (`mime`, `artifact_name`, `adapter_uri`), then
  verify the stored result against the intended adapter — `activate` it and
  confirm every `linked_artifacts[].relative_path` matches the path its contract
  invokes. Do not add separate contracts for "requirements written", "draft
  exists", or "I understood the review".
- **Update** — export the target, identify the exact gap, plan the minimal change.
  Re-run the critic on the changed parts (a changed draft invalidates review
  evidence about those parts), then save with `tune` and read back to verify. Keep
  readiness before the save and outcome verification after it: they answer
  different questions.
- **Review** — read-only. Export the target(s) and audit against the checklist
  (structural compliance, contract coverage, ladder placement, DRY, activation
  accuracy). Produce a findings report; do not mutate and do not `train`.
- **Delete** — confirm the slug is not a chain dependency of another adapter,
  delete it, then verify it no longer resolves. A destructive, hard-to-roll-back
  action is exactly where an extra `shell` gate before the delete is justified.
