---
version: "5.11.0"
slug: contract-rationale
title: Adapter Contract Rationale
---

# Adapter Contract Rationale

This document explains **why** each contract exists in the bundled mem adapters.
It complements the **Contract policy** section in the README and the decision
rules in `challenge-type-guide` and `critic-loop-guide`. Use this when you need
to understand the rationale behind a contract choice, or when authoring a new
adapter and deciding which contracts to include.

## Verification Ladder (preferred order)

Every contract choice follows the verification ladder:

1. **`shell` empirical check** — run a command that observes the real artifact
   (file, git state, command output, exit code). This is the default proof.
2. **`subagent` critic-loop** — when a step's result cannot be shell-verified,
   delegate an adversarial review to the `critic-loop` adapter.
3. **`subagent` instructed to call an MCP tool** — when the only way to complete
   a step is a real MCP call (`train`/`tune`/`export`/`forward`), use a `subagent`
   contract whose `context` instructs the delegate to make that call.
4. **Fallback: a single `comment` ACK** — only for read-only or knowledge-only
   adapters, where no artifact exists to check.

**Key principles:**
- Shell checks are **safety gates, not puzzles** — they verify observable state,
  not agent cleverness.
- Complex shell operations (especially JSON) → attach a **script artifact**
  (node/python3; bash only for light file/text, never JSON in bash).
- Every executable adapter carries **at least one shell gate**; knowledge-only
  adapters carry a single `comment` ACK.
- `user_input` is **emergency-only** — never a routine approval gate.

---

## author-adapter.md (8 contracts)

The author-adapter is an **executable adapter** that creates, reviews, or updates
other adapters. It has 8 contracts because it performs multiple irreversible
operations (drafting, critic-loop review, train/tune calls) that require
objective gates.

### 1. Preflight Dependencies — `shell`
  ```json
  {"contract":{"type":"shell","shell":{"cmd":"command -v git >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && mkdir -p \"${SQUADRULES_LOCAL_ARTIFACT_DIR:-.local/squadrules/work}\"","interpreter":"bash","timeout_seconds":10},"required":true}}
  ```
**Reason:** Verify foundational prerequisites (git, node, artifact directory)
before proceeding. This is a **precondition shell gate** — if the tools aren't
available, the adapter cannot execute later shell steps. Failing fast here
prevents wasted work and unclear error messages downstream.

### 2. Resolve Intent Autonomously — `shell`
  ```json
  {"contract":{"type":"shell","shell":{"cmd":"test -s \"${AUTHORING_INTENT_FILE:-}\" && grep -Eq 'operation=(create|review|update)' \"${AUTHORING_INTENT_FILE}\"","interpreter":"bash","timeout_seconds":5},"required":true}}
  ```
**Reason:** Assert the agent successfully inferred the operation (create/review/update)
and wrote it to the intent file. This is a **state-assertion gate** — the agent
must demonstrate it resolved the user's intent before gathering requirements.
Without this gate, a weaker agent might skip intent resolution and proceed
ambiguously.

### 3. Gather Requirements — `shell`
  ```json
  {"contract":{"type":"shell","shell":{"cmd":"test -s \"${REQUIREMENTS_FILE:-}\"","interpreter":"bash","timeout_seconds":5},"required":true}}
  ```
**Reason:** Assert the agent wrote requirements to the file. This is a
**handoff-verification gate** — the requirements file is the input to the next
phase (drafting). If the file is missing or empty, the draft phase has no input.
This gate prevents the agent from proceeding without gathering requirements.

### 4. Draft Markdown — `shell`
  ```json
  {"contract":{"type":"shell","shell":{"cmd":"test -s \"${DRAFT_FILE:-}\"","interpreter":"bash","timeout_seconds":5},"required":true}}
  ```
**Reason:** Assert the agent drafted the markdown (or findings report for review).
This is a **deliverable-existence gate** — the draft file is the output of the
drafting phase and the input to the critic-loop review. Without this gate, the
agent might skip drafting and proceed directly to critic-loop with no input.

### 5. Critic-Loop Review — `shell` FAIL gate
  ```json
  {"contract":{"type":"shell","shell":{"cmd":"head -1 \"$VERDICT_FILE\" | grep -qi '^PASS$'","interpreter":"bash","timeout_seconds":5},"required":true}}
  ```
**Reason:** This is the **critic-loop FAIL gate** — the mechanical guard that
prevents weaker agents from proceeding after a FAIL verdict. The critic-loop
adapter writes `PASS` or `FAIL` to the verdict file; this shell command fails
when the verdict is not PASS. Without this gate, protocol wording alone does not
stop determined agents from ignoring a FAIL and continuing. This is the
**objective enforcement** of the critic-loop's subjective review.

### 6. Critic-Loop Review — `comment` ACK
  ```json
  {"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
  ```
**Reason:** This is the **agent's acknowledgment** that it captured the critic
verdict and is ready to proceed. The `min_length: 80` ensures the agent writes
a substantive acknowledgment (not a one-word "ok"). This is a **handoff-acknowledgment
gate** — the agent must demonstrate it understood the critic's output before
finalizing. For `review` operations (read-only), this is the only contract after
the draft phase.

### 7. Autonomous Review Gate — `comment` ACK
  ```json
  {"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
  ```
**Reason:** Assert the agent recorded the outcome (adapter URIs for create/update,
findings summary for review) and is ready to finalize. This is a
**pre-finalization acknowledgment** — the agent must demonstrate it captured
the results before calling `train`/`tune`. The `min_length: 80` ensures a
substantive summary, not a placeholder.

### 8. FinaliseOperation — `comment` ACK
  ```json
  {"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
  ```
**Reason:** Assert the agent called `train`/`tune` and received the adapter URI(s)
or saved the findings. This is the **completion-acknowledgment gate** — the agent
must demonstrate it finalized the operation and can report the outcome. The
`min_length: 80` ensures the agent reports the actual result (URI, findings),
not a generic "done".

**Why 8 contracts?** The author-adapter performs multiple phases (preflight, intent,
requirements, draft, critic-loop, review, finalize), each with a handoff artifact.
Each shell gate verifies the artifact exists; each comment ACK verifies the agent
understood the handoff. The critic-loop FAIL gate is the objective enforcement
of the subjective review. This is the **executable-adapter pattern**: multiple
shell gates for observable artifacts, comment ACKs for handoff acknowledgments.

---

## critic-loop.md (4 contracts)

The critic-loop adapter is an **executable adapter** that performs adversarial
review. It has 4 contracts: 2 shell gates (precondition, verdict verification)
and 2 comment ACKs (intermediate acknowledgments).

### 1. Precondition Check — `shell`
  ```json
  {"contract":{"type":"shell","shell":{"cmd":"test -f \"${WORK_MANIFEST:-}\" || test -f \"${INPUT_FILE:-}\"","interpreter":"bash","timeout_seconds":3},"required":true}}
  ```
**Reason:** Verify a submission handoff is present before deep investigation.
This is a **precondition shell gate** — if the work manifest or input file is
missing, the critic cannot review anything. Failing fast here prevents wasted
work and unclear error messages. The critic-loop adapter writes a FAIL verdict
with `failure_class: verification_blocked` if this gate fails.

### 2. Resolve Submission — `comment` ACK
  ```json
  {"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
  ```
**Reason:** Assert the agent resolved the work inventory (read files, fetched URLs,
ran commands) before auditing. This is a **handoff-acknowledgment gate** — the
agent must demonstrate it turned the submission into reviewable material. The
`min_length: 80` ensures a substantive inventory report, not a placeholder.

### 3. Audit — `comment` ACK
  ```json
  {"contract":{"type":"comment","comment":{"min_length":120},"required":true}}
  ```
**Reason:** Assert the agent performed the adversarial review (extracted claims,
gathered evidence, checked requirement coverage). This is a
**review-completion acknowledgment** — the agent must demonstrate it completed
the audit before producing the verdict. The `min_length: 120` (higher than usual)
ensures a substantive findings report, because the audit is the core work of
the critic-loop.

### 4. Verdict — `shell`
  ```json
  {"contract":{"type":"shell","shell":{"cmd":"test -f \"$VERDICT_FILE\" && head -1 \"$VERDICT_FILE\" | grep -qiE '^(PASS|FAIL)$' && sed -n '2p' \"$VERDICT_FILE\" | grep -qiE '^(High|Medium|Low)$'","interpreter":"bash","timeout_seconds":5},"required":true}}
  ```
**Reason:** Verify the verdict file exists and has the correct structure (PASS/FAIL
on line 1, confidence on line 2). This is a **deliverable-structure gate** —
the calling adapter's FAIL gate expects line 1 to be PASS/FAIL, so this gate
ensures the critic wrote the verdict in the expected format. Without this gate,
a malformed verdict file would cause the calling adapter's FAIL gate to fail
with an unclear error.

**Why 4 contracts?** The critic-loop is a review adapter, not a mutation adapter.
It has 2 shell gates (precondition, verdict structure) and 2 comment ACKs
(resolution, audit completion). The shell gates verify observable artifacts
(work manifest, verdict file); the comment ACKs verify the agent completed the
review phases. This is the **review-adapter pattern**: fewer shell gates than
executable adapters, but still at least one shell precondition and one shell
deliverable gate.

---

## challenge-type-guide.md (1 real contract)

The challenge-type-guide is a **knowledge-only adapter** — it teaches decision
rules for choosing contract types. It has 1 real contract (a single `comment`
ACK at the end). The indented example fences below document the contract JSON
formats but are not counted as real layer contracts.

### Real contract (column-0 fence):
### 1. Reward Signal — `comment` ACK
  ```json
  {"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
  ```
**Reason:** This is the **single comment ACK** for a knowledge-only adapter.
The guide teaches decision rules; it does not produce an observable artifact.
The `comment` ACK is the fallback for read-only adapters. The `min_length: 30`
ensures the agent writes a substantive acknowledgment (not a one-word "ok").

### Indented example fences (not real contracts):
The guide documents the JSON formats for `shell`, `user_input`, `comment`, and
`subagent` contracts. These fences are **indented two spaces** (`  ```json`) so
the parser does not count them as real layer contracts. They are documentation
examples, not executable contracts.

**Why 1 real contract?** The challenge-type-guide is a knowledge-only adapter —
it teaches decision rules, not execution steps. Knowledge-only adapters carry
a single `comment` ACK and no shell gates.

---

## critic-loop-guide.md (1 real contract)

The critic-loop-guide is a **knowledge-only adapter** — it teaches integration
rules for critic-loop. It has 1 real contract (a single `comment` ACK at the
end). The indented example fences document the contract patterns but are not
counted as real layer contracts.

### Real contract (column-0 fence):
### 1. Reward Signal — `comment` ACK
  ```json
  {"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
  ```
**Reason:** This is the **single comment ACK** for a knowledge-only adapter.
The guide teaches integration rules; it does not produce an observable artifact.
The `comment` ACK is the fallback for read-only adapters. The `min_length: 80`
ensures a substantive acknowledgment.

### Indented example fences (not real contracts):
The guide documents the contract patterns for critic-loop integration (subagent
delegation, FAIL gate, aggregate shell proof, boundary precondition). These
fences are **indented two spaces** so the parser does not count them as real
layer contracts. They are documentation examples, not executable contracts.

**Why 1 real contract?** The critic-loop-guide is a knowledge-only adapter —
it teaches integration rules, not execution steps. Knowledge-only adapters
carry a single `comment` ACK and no shell gates.

---

## protocol-linking-guide.md (1 real contract)

The protocol-linking-guide is a **knowledge-only adapter** — it teaches decision
rules for linking adapters. It has 1 real contract (a single `comment` ACK at
the end). The indented example fence documents the subagent delegation pattern
but is not counted as a real layer contract.

### Real contract (column-0 fence):
### 1. Reward Signal — `comment` ACK
  ```json
  {"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
  ```
**Reason:** This is the **single comment ACK** for a knowledge-only adapter.
The guide teaches linking rules; it does not produce an observable artifact.
The `comment` ACK is the fallback for read-only adapters.

### Indented example fence (not a real contract):
The guide documents the subagent delegation pattern for chain links. This fence
is **indented two spaces** so the parser does not count it as a real layer
contract. It is a documentation example, not an executable contract.

**Why 1 real contract?** The protocol-linking-guide is a knowledge-only adapter —
it teaches linking rules, not execution steps. Knowledge-only adapters carry
a single `comment` ACK and no shell gates.

---

## skill-format-guide.md (1 contract)

The skill-format-guide is a **knowledge-only adapter** — it teaches decision
rules for authoring SKILL.md files. It has 1 real contract (a single `comment`
ACK at the end).

### 1. Reward Signal — `comment` ACK
  ```json
  {"contract":{"type":"comment","comment":{"min_length":30},"required":true}}
  ```
**Reason:** This is the **single comment ACK** for a knowledge-only adapter.
The guide teaches skill format rules; it does not produce an observable artifact.
The `comment` ACK is the fallback for read-only adapters.

**Why 1 real contract?** The skill-format-guide is a knowledge-only adapter —
it teaches format rules, not execution steps. Knowledge-only adapters carry
a single `comment` ACK and no shell gates.

---

## Summary: Contract Patterns by Adapter Type

### Executable Adapters (author-adapter, critic-loop)
- **At least one shell gate** for observable artifacts (preflight, deliverables,
  FAIL gates)
- **Comment ACKs** for handoff acknowledgments (between phases, before finalization)
- **Critic-loop FAIL gate** (shell) after every critic-loop invocation
- **Multiple contracts** because multiple phases have observable artifacts

### Knowledge-Only Adapters (challenge-type-guide, critic-loop-guide,
protocol-linking-guide, skill-format-guide)
- **Single `comment` ACK** at the Reward Signal
- **No shell gates** because the adapter does not produce observable artifacts
- **Indented example fences** document contract formats but are not counted as
  real contracts

### Why the Difference?
Executable adapters **do work** (draft, review, train, tune) and produce
**observable artifacts** (files, verdicts, adapter URIs). Shell gates verify
the artifacts exist and have the correct structure. Comment ACKs verify the
agent understood the handoffs.

Knowledge-only adapters **teach rules** and do not produce observable artifacts.
A single `comment` ACK is the fallback for read-only adapters. The verification
ladder's bottom rung is "pure knowledge, no observable artifact → a single
`comment` ACK".

### The Verification Ladder in Practice
1. **Shell empirical check** — default for executable adapters
2. **Critic-loop subagent** — when a step cannot be shell-verified
3. **Subagent instructed to call an MCP tool** — when the only way to complete
   a step is a real MCP call
4. **Single `comment` ACK** — fallback for knowledge-only adapters

Every bundled adapter self-complies with this ladder. Executable adapters have
shell gates; knowledge-only adapters have a single comment ACK. The bundle
teaches by example.

## Reward Signal

Only reachable after all prior steps are solved.

The agent can now:
1. Explain why each contract exists in the bundled mem adapters
2. Distinguish executable adapters (shell gates + comment ACKs) from knowledge-only
   adapters (single comment ACK)
3. Apply the verification ladder when authoring new adapters
4. Understand the executable-adapter pattern (multiple phases, handoff artifacts,
   FAIL gates) and the knowledge-only pattern (teaching rules, no observable artifacts)

```json
{"contract":{"type":"comment","comment":{"min_length":80},"required":true}}
```
