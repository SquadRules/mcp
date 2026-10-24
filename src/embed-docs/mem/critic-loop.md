---
version: "5.13.4"
slug: critic-loop
title: Critic Loop
---



# Critic Loop

Bounded adversarial investigator that the calling protocol **loops until it
returns PASS** — not a one-shot review. Receives a work submission (files,
links, a git diff, a pull request, command output, or inline text), the
original requirement list, and the calling protocol's invariants, then
independently verifies the submitted work by extracting claims, gathering
evidence, searching for contradictions, and checking requirement-by-requirement
coverage. A FAIL sends the caller back to fix and re-invoke; the loop is bounded
by an explicit iteration ceiling (see Verdict).

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
- Modify any submitted item or any file other than the verdict path.
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
- "Create a new protocol" → use `author-adapter`
- "Implement a feature" → use an execution protocol, not this one

## Artifact Contract

This protocol receives:

```text
{
  work: {
    kind: 'file_set' | 'links' | 'git_diff' | 'pr' | 'command_output' | 'inline',
    items: string[],              // paths | URLs | 'base..head' refs | PR URL/number | commands | text
    root: string                  // absolute cwd used to resolve relative paths, refs and commands
  },
  work_manifest: string,          // absolute path to the handoff file recording `work`
  input_file: string,             // accepted alias: a one-item work.kind='file_set'
  calling_protocol_slug: string,
  verification_target: string,
  requirements: string[],         // original intent / requirement list to check coverage against
  context: {
    operation: string,
    verdict_file: string,          // absolute path where the verdict will be written
    iteration: number,             // 1-based loop pass; caller increments after each FAIL
    max_iterations: number         // hard ceiling; exceeding it is a terminal FAIL
  }
}
```

The submission is the **work itself**, not an essay about it. Write `work` to
`$WORK_MANIFEST` as flat keys so the handoff stays machine-checkable:
`kind:`, `root:`, then `items:` with one item per line. Callers that still pass
only `input_file` are handled as `kind: file_set` with that single path; the
review rules do not change, only the scope of what is submitted.

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

## Precondition Check

Verify foundational preconditions before deep investigation. Early-abort if any
are broken.

**Input:** `$WORK_MANIFEST` (or the older-spelling `$INPUT_FILE`), calling protocol slug, context

**Actions:**
1. Verify a submission handoff is present: `$WORK_MANIFEST`, or `$INPUT_FILE`
   when the caller passed no manifest.
2. Verify the verdict output path is writable (parent directory exists).
3. Load the calling protocol's Must Never / Must Always sections if possible.
4. Verify the target state is available for review.
5. Verify required tools are available for the submission's `kind` (a `pr`
   submission with no `gh` on the host is `verification_blocked`, not skipped).

**On early-abort:**
- verdict = `FAIL`
- failure class = `verification_blocked`
- confidence = `Low`
- write focused diagnostics
- skip all later steps

**Output:** verified preconditions or early-abort diagnostics

```json
{"contract":{"type":"shell","shell":{"cmd":"test -f \"${WORK_MANIFEST:-}\" || test -f \"${INPUT_FILE:-}\"","interpreter":"bash","timeout_seconds":3},"required":true}}
```

## Resolve Submission

Turn the submission into the material under review. What cannot be resolved is
never guessed at.

**Input:** `work` recorded in `$WORK_MANIFEST` (or the older-spelling `$INPUT_FILE`),
`work.root`

**Actions:**
1. Read `kind`, `root`, `items`. An unknown `kind`, an empty `items` list, or a
   malformed manifest is `verification_blocked`.
2. Resolve every item by kind, always from `work.root`:
   - `file_set` — read each path; relative paths resolve against `root`, and a
     missing path is `verification_blocked`.
   - `links` — fetch each URL; a URL that cannot be fetched is
     `verification_blocked`, not an `unverifiable` claim.
   - `git_diff` — `git -C "$root" diff <base>..<head>`, or the working tree when
     no range is given; no `git`, no repository, or a bad ref is
     `verification_blocked`.
   - `pr` — `gh pr view` plus `gh pr diff` for the number or URL; a missing
     `gh`, an expired login, or an unreachable host is `verification_blocked`.
   - `command_output` — run each command from `root` and capture stdout and
     stderr as the material.
   - `inline` — the text recorded in the manifest is the material.
3. Record the resolved inventory before auditing: `kind`, item count, per-item
   status (`resolved` or `blocked`), and where each item's evidence lives.
4. A `pr` or `git_diff` submission is reviewed as a diff: claims are checked
   against the changed lines and the tests they touch, never against the
   description written alongside them.

**Output:** resolved work inventory for the audit

```json
{"contract":{"type":"subagent","subagent":{"context":"Resolve the work submission into reviewable material: read the manifest, resolve each item by kind from work.root, and record the resolved inventory with per-item status."},"required":true}}
```

## Audit

Perform bounded adversarial review of the target against the resolved work
submission and invariants.

**Input:** resolved work inventory, invariants, verification target, requirement list, context

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

**High-risk areas:** setup steps, CLI commands, configuration keys, authentication,
deployment, external publishing, destructive operations.

**Step 3 — Gather evidence using the hierarchy**

| Priority | Evidence source |
|---|---|
| 1 | source code, config files, schemas, route definitions |
| 2 | direct runtime verification |
| 3 | tests |
| 4 | MCP-queried system state |
| 5 | external docs, web pages, linked references |
| 6 | conversational assumption or indirect inference |

**Rules:** higher-priority evidence overrides lower; priority 5–6 alone is not
enough for `verified`; a submitted link or PR description is priority 5.

**Step 4 — Produce claim verdicts**
For each claim: CLAIM, EVIDENCE, EVIDENCE PRIORITY, VERDICT
(`verified` / `partially_verified` / `unverifiable` / `incorrect`).
A claim must not be marked `verified` without positive supporting evidence.

**Step 5 — Review the phase boundary**
Check whether the calling adapter preserved the right mode boundary.

**Step 6 — Check requirement coverage**
For every item in `requirements`, confirm coverage with positive evidence.
Any `missing` item — or any `partial` high-risk item — forces FAIL with
`failure_class: requirement_gap`.

**Output:** structured audit findings for the verdict step

```json
{"contract":{"type":"subagent","subagent":{"context":"Perform bounded adversarial audit: extract claims, investigate with scope discipline, gather evidence by priority hierarchy, produce claim verdicts, review phase boundary, and check requirement coverage."},"required":true}}
```

## Verdict

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
{"contract":{"type":"shell","shell":{"cmd":"test -f \"$VERDICT_FILE\" && head -1 \"$VERDICT_FILE\" | grep -qiE '^(PASS|FAIL)$' && sed -n '2p' \"$VERDICT_FILE\" | grep -qiE '^(High|Medium|Low)$'","interpreter":"bash","timeout_seconds":5},"required":true}}
```

## Reward Signal

Only reachable after all prior steps are solved.

The phase output has been independently challenged and looped until satisfied. The
resulting verdict is more truthful because it is based on extracted claims,
explicit evidence, contradiction search, requirement-by-requirement coverage, and
a clean boundary between execution and review.
