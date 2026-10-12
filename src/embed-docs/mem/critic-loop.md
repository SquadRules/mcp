---
version: "5.5.0"
slug: critic-loop
title: Critic Loop
---



# Critic Loop

Bounded adversarial investigator that the calling protocol **loops until it
returns PASS** — not a one-shot review. Receives a reference document, the
original requirement list, and the calling protocol's invariants, then
independently verifies the target by extracting claims, gathering evidence,
searching for contradictions, and checking requirement-by-requirement coverage.
A FAIL sends the caller back to fix and re-invoke; the loop is bounded by an
explicit iteration ceiling (see Verdict).

## Activation Patterns

**Typically invoked by:** another protocol at the end of a plan, implement,
validation, or review phase via `forward` with the stored adapter URI
`squadrules://adapter/critic-loop`.

**Can be invoked directly when agent needs:**
- "review phase output" / "verify plan" / "audit implementation"
- "adversarial review" / "critic review"

**Trigger pattern:** **review** / **verify** / **audit** / **critic** +
(phase / plan / implementation / output).

**Must Never:**
- Modify any file outside the provided input and output paths.
- Trust the executor's assertions without independent evidence.
- Classify a claim as `verified` based only on absence of contradiction.
- Keep investigating after a precondition failure that blocks verification.

**Must Always:**
- Extract claims before investigating.
- Verify in-scope claims first.
- Search for contradictory evidence, not only confirming evidence.
- Check every item in the supplied requirement list for coverage; a missing
  requirement is a FAIL even when the output is internally consistent.
- Include confidence in every verdict and failure class in every FAIL verdict.
- Preserve the boundary between execution and review.

**Good trigger examples:**
- implement protocol fires this after planning → run this protocol
- compose protocol fires this after output generation → run this protocol

**Bad trigger examples:**
- "Create a new protocol" → use `create-new-protocol`
- "Implement a feature" → use an execution protocol, not this one

## Artifact Contract

This protocol receives:

```text
{
  input_file: string,              // absolute path to the document under review
  calling_protocol_slug: string,
  verification_target: string,
  requirements: string[],          // original intent / requirement list to check coverage against
  context: {
    operation: string,
    verdict_file: string,          // absolute path where the verdict will be written
    iteration: number,             // 1-based loop pass; caller increments after each FAIL
    max_iterations: number         // hard ceiling; exceeding it is a terminal FAIL
  }
}
```

This protocol produces:

```text
{
  verdict: "PASS" | "FAIL",
  confidence: "High" | "Medium" | "Low",
  failure_class: string,           // incorrect_claim | verification_blocked | requirement_gap | iteration_ceiling
  uncovered_requirements: string[],// requirement items lacking positive evidence (empty on PASS)
  verdict_file: "{context.verdict_file}"
}
```

## Precondition Check [SUBAGENT]

Verify foundational preconditions before deep investigation. Early-abort if any
are broken.

**Input:** `$INPUT_FILE` (absolute path), calling protocol slug, context

**Actions:**
1. Verify the input file exists: `test -f "$INPUT_FILE"`.
2. Verify the verdict output path is writable (parent directory exists).
3. Load the calling protocol's Must Never / Must Always sections if possible.
4. Verify the target state is available for review.
5. Verify required tools are available.

**On early-abort:**
- verdict = `FAIL`
- failure class = `verification_blocked`
- confidence = `Low`
- write focused diagnostics
- skip all later steps

**Output:** verified preconditions or early-abort diagnostics

```json
{"contract":{"type":"shell","shell":{"cmd":"test -f \"$INPUT_FILE\"","timeout_seconds":3},"required":true}}
```

## Audit [SUBAGENT]

Perform bounded adversarial review of the target against the reference document
and invariants.

**Input:** reference document, invariants, verification target, requirement list, context

**Actions:**

**Step 1 — Extract claims**
Extract every verifiable claim that matters operationally:
- workflows, commands, tool calls
- configuration and environment variable claims
- architecture claims that imply behaviour
- guarantees and constraints
- security, auth, and permission claims

**Step 2 — Investigate with scope discipline**
1. verify all in-scope claims first
2. review high-risk claims with maximum depth
3. expand beyond scope only when contradiction signals, dependencies, or
   high-risk impact require it
4. continue reviewing all in-scope claims even after a normal FAIL condition is met;
   only a precondition failure stops the audit early

**High-risk areas**
- setup steps and prerequisites
- CLI commands and flags
- configuration keys and environment variables
- authentication, identity, and permissions
- deployment and release behaviour
- external publishing actions
- destructive or irreversible operations

**Step 3 — Gather evidence using the hierarchy**

| Priority | Evidence source |
|---|---|
| 1 | source code, config files, schemas, route definitions |
| 2 | direct runtime verification |
| 3 | tests |
| 4 | MCP-queried system state |
| 5 | external docs, web pages, linked references |
| 6 | conversational assumption or indirect inference |

**Rules:**
- higher-priority evidence overrides lower-priority evidence
- priority 5–6 alone is not enough for `verified`

**Step 4 — Produce claim verdicts**

For each claim, record:
- CLAIM
- EVIDENCE
- EVIDENCE PRIORITY
- VERDICT: `verified` / `partially_verified` / `unverifiable` / `incorrect`

A claim must not be marked `verified` without positive supporting evidence.

**Step 5 — Review the phase boundary**
Check whether the calling protocol preserved the right mode boundary:
- was execution reviewed independently?
- were review and execution kept separate?
- did the protocol switch to verification when it should have?
- is escalation needed because certainty was overstated?

**Step 6 — Check requirement coverage**
For every item in the supplied `requirements` list, confirm the target addresses
it with positive evidence and record it as `covered` / `partial` / `missing`. An
omitted requirement leaves no trace in the output, so coverage can only be judged
against the list, never from the artifact alone. Any `missing` item — or any
`partial` high-risk item — forces a FAIL with `failure_class: requirement_gap`.

**Output:** structured audit findings for the verdict step

```json
{"contract":{"type":"comment","comment":{"min_length":120},"required":true}}
```

## Verdict [SUBAGENT]

Turn the audit into a final PASS / FAIL result.

**Input:** audit findings and verdict file path from context (use it as
`$VERDICT_FILE`)

**Actions:**
1. Fail if any critical claim is incorrect.
2. Fail if verification was blocked.
3. Fail if the evidence base is too weak for high-risk claims.
4. Fail if any requirement is `missing`, or a high-risk requirement is only
   `partial` (`failure_class: requirement_gap`); list the uncovered items.
5. Fail terminally if `context.iteration` exceeds `context.max_iterations`
   (`failure_class: iteration_ceiling`) so the loop stops instead of thrashing.
6. Otherwise, pass with the appropriate confidence.
7. Write `$VERDICT_FILE` so line 1 is `PASS` or `FAIL`,
   line 2 is `High`, `Medium`, or `Low`, and the remaining lines summarise key
   findings and any uncovered requirements.

**Verdict contract (calling adapter must obey):**
- Line 1 is `PASS` → the loop is satisfied; the calling adapter may continue.
- Line 1 is `FAIL` → the calling adapter **MUST NOT** proceed to reward, **MUST
  NOT** ask the user for approval, and **MUST NOT** continue. It must address the
  findings, increment `context.iteration`, and re-invoke critic-loop.
- `failure_class: iteration_ceiling` → stop looping and surface the unresolved
  findings; never silently pass. The ceiling bounds the loop so a weak agent
  cannot thrash forever.

**Output:** final verdict file

```json
{"contract":{"type":"shell","shell":{"cmd":"test -f \"$VERDICT_FILE\" && head -1 \"$VERDICT_FILE\" | grep -qiE '^(PASS|FAIL)$' && sed -n '2p' \"$VERDICT_FILE\" | grep -qiE '^(High|Medium|Low)$'","timeout_seconds":5},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

The phase output has been independently challenged and looped until satisfied. The
resulting verdict is more truthful because it is based on extracted claims,
explicit evidence, contradiction search, requirement-by-requirement coverage, and
a clean boundary between execution and review.
