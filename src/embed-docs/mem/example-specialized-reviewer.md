---
slug: example-specialized-reviewer
version: 1.0.0
inherits: critic-loop
title: Example Specialized Reviewer (Inheritance Demo)
---

# Example Specialized Reviewer

This adapter demonstrates the **inheritance mechanism** — it inherits from `critic-loop` (generic reviewer) and adds domain-specific checks.

## Activation Patterns

**Typically invoked by:** `author-adapter` when reviewing specialized work (e.g., adapter principles compliance, code quality, security audit).

**Trigger pattern:** **specialized review** / **domain review** / **compliance check** + (adapter / code / security).

**Must Never:**
- Replace generic `critic-loop` — this is a specialized extension, not a replacement.
- Override parent's verdict format — structural elements are inherited, not changed.

**Must Always:**
- Inherit parent's work submission format (how to receive `work` with `kind`, `items`, `root`).
- Inherit parent's subagent delegation pattern.
- Add domain-specific audit steps (e.g., principles compliance checks, security scanning).

## Prerequisites

- **Inheritance:** This adapter inherits from `critic-loop` (generic reviewer). All parent contracts, workflows, and structural elements apply unless explicitly overridden below.
- **Override scope:** Domain-specific rules (audit steps, triggers, constraints) can be overridden; structural elements (verdict format, work submission protocol) cannot.

## Artifact Contract

```json
{
  "contract": "shell",
  "interpreter": "bash",
  "command": "echo 'Verifying specialized reviewer artifacts exist' && ls -la work/*.md 2>/dev/null | wc -l"
}
```

## Workflow

### Step 1: Receive Work Submission

**Inherited from parent:** Work arrives with `kind`, `items`, `root` structure.

```json
{
  "work": {
    "kind": "adapter-review",
    "items": [
      {
        "path": "python-implementation.md",
        "type": "adapter",
        "claims": ["shell contracts are empirical", "verdict is structural"]
      }
    ],
    "root": "/path/to/work/dir"
  }
}
```

### Step 2: Domain-Specific Audit (OVERRIDE — adds to parent)

**This is new:** Specialized reviewer adds domain-specific checks that generic parent doesn't have.

**Audit dimensions:**
1. **Principles compliance** — does adapter follow three principles (autonomy, help-not-puzzles, honest verification)?
2. **Contract type correctness** — shell contracts have empirical commands, comment contracts are last resort, forward contracts link only.
3. **Interpreter matching** — shell command interpreter matches code type (python3 for Python, bash for shell).
4. **Inline code vs artifacts** — code snippets are extracted to artifacts, not inline.
5. **Redundancy check** — no duplicate rules, no verbose restatement.

**For each item in work.items:**
- Load item content
- Run all 5 audit dimensions
- Record findings as `pass`, `fail`, or `warning`

### Step 3: Delegate to Subagent (INHERITED from parent)

**Inherited from parent:** Complex audits delegate to subagent with MCP tool access.

**Rung level:** Rung 2 (delegated judgment) — subagent uses its own judgment to evaluate adapter against principles, no explicit MCP tool calls required.

```json
{
  "contract": "subagent",
  "task": "Audit adapter for principles compliance",
  "context": {
    "work_item": "<current item from Step 1>",
    "audit_dimensions": "<5 checks from Step 2>",
    "evidence_required": "shell output, file paths, line numbers",
    "judgment_criteria": "Evaluate adapter against three principles (autonomy, help-not-puzzles, honest verification) and five audit dimensions"
  }
}
```

### Step 4: Synthesize Findings (OVERRIDE — enhances parent)

**This is enhanced:** Specialized reviewer synthesizes findings with domain-specific severity mapping.

**Severity mapping (domain-specific):**
- **Critical:** Principles violations (autonomy, help-not-puzzles, honest verification)
- **High:** Contract type mismatches (shell without empirical command, comment without fail-closed)
- **Medium:** Interpreter mismatches, missing artifacts
- **Low:** Redundancy, style issues

**Synthesis output:**
```json
{
  "findings": [
    {
      "dimension": "principles-compliance",
      "severity": "critical",
      "issue": "Adapter uses comment contract for verification that should be shell",
      "evidence": "Line 42: comment contract 'verify syntax' — should be shell with python3 -c"
    },
    {
      "dimension": "interpreter-matching",
      "severity": "medium",
      "issue": "Shell command is Python code but interpreter is bash",
      "evidence": "Line 15: interpreter=bash, command=python3 -c '...'"
    }
  ],
  "summary": {
    "critical": 1,
    "high": 0,
    "medium": 1,
    "low": 0
  }
}
```

### Step 5: Produce Verdict (INHERITED from parent)

**Inherited from parent:** Verdict format is structural — cannot be overridden.

```json
{
  "contract": "shell",
  "interpreter": "bash",
  "command": "echo 'PASS' > verdict.txt && echo 'High' >> verdict.txt"
}
```

**Verdict file format (2 lines):**
- Line 1: `PASS` or `FAIL`
- Line 2: Severity (`Critical`, `High`, `Medium`, `Low`)

**Decision logic:**
- **FAIL** if any finding is `critical` or `high`
- **PASS** if findings are `medium` or `low` only
- Severity = max(finding severities)

### Step 6: Reward Signal (INHERITED from parent)

**Inherited from parent:** Reward signal communicates outcome to invoking agent.

```json
{
  "reward": {
    "outcome": "pass" | "fail",
    "severity": "critical" | "high" | "medium" | "low",
    "evidence": "verdict.txt content",
    "findings_count": {
      "critical": 0,
      "high": 0,
      "medium": 0,
      "low": 0
    }
  }
}
```

## Override Summary

**What this child adapter overrides:**
- ✓ **Step 2:** Added domain-specific audit dimensions (5 checks)
- ✓ **Step 4:** Enhanced synthesis with severity mapping (critical/high/medium/low)

**What this child adapter inherits unchanged:**
- ✓ Step 1: Work submission format
- ✓ Step 3: Subagent delegation pattern
- ✓ Step 5: Verdict format (2-line file)
- ✓ Step 6: Reward signal structure

**Override scope validation:**
- ✓ Domain rules overridden (audit dimensions, severity mapping)
- ✓ Structural elements preserved (work format, verdict format, reward structure)

## Forward Contract (INHERITED from parent)

**Inherited from parent:** If this adapter is part of a chain, forward contract links to next adapter.

**Note:** Forward contracts must be link-only per ADR 0028. No payload or handoff data allowed.

```json
{
  "contract": "forward",
  "target": "squadrules://adapter/example-next-adapter"
}
```

**Handoff data (if needed):** Express as separate shell checks on artifact files (rung 1) or as workflow instructions, not as forward contract payload.

## Design Notes

**Why this demonstrates inheritance:**
1. **Clear override points** — Steps 2 and 4 are domain-specific additions
2. **Clear inheritance points** — Steps 1, 3, 5, 6 are structural, unchanged
3. **Override scope respected** — domain rules flexible, structural elements fixed
4. **Verdict format preserved** — child cannot change parent's 2-line verdict structure
5. **Work submission protocol preserved** — child cannot change how work arrives

**What server would do at activation:**
1. Load child adapter (`example-specialized-reviewer`)
2. Load parent adapter (`critic-loop`)
3. Materialize full content: parent base + child deltas
4. Return inheritance tree: [child, parent, root]
5. Return overrides list: [Step 2, Step 4]
6. Return materialized content: 6-step workflow with inherited + overridden steps

**What agent sees:**
- Single coherent adapter (no need to manually merge parent + child)
- Clear markers showing which steps are inherited vs overridden
- Full audit trail (inheritance tree, override scope, version lineage)
