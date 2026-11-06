# Inheritance Simulation: example-specialized-reviewer

**Date:** 2026-11-05  
**Purpose:** Demonstrate what server would produce when activating child adapter with `inherits: critic-loop`  
**Status:** Simulation only (no actual server-side implementation)

---

## Scenario

**Agent activates:** `squadrules://adapter/example-specialized-reviewer`  
**Server resolves:** Inheritance from `critic-loop` (parent)  
**Server produces:** Materialized content (parent + delta) + inheritance tree + overrides list

---

## Step 1: Inheritance Tree (Path to Root)

**What server returns:**

```json
{
  "inheritance_tree": [
    {
      "slug": "example-specialized-reviewer",
      "version": "1.0.0",
      "level": 0,
      "type": "child",
      "delta": "Domain-specific audit steps, triggers, constraints"
    },
    {
      "slug": "critic-loop",
      "version": "5.22.0",
      "level": 1,
      "type": "parent",
      "inheritance_resolved_at_activation": true
    }
  ]
}
```

**What this means:**

- Child is at level 0 (most specific)
- Parent is at level 1 (generic base)
- Server resolved inheritance at activation time (not train time)
- Child stores only delta, parent stores base content

---

## Step 2: Override Scope Detection

**What server analyzes:**

```yaml
# Child frontmatter
slug: example-specialized-reviewer
version: 1.0.0
inherits: critic-loop
override:
  - audit-dimensions  # domain rule: can override
  - severity-mapping  # domain rule: can override
```

**What server validates:**

- ✓ `audit-dimensions` is domain-specific rule → override allowed
- ✓ `severity-mapping` is domain-specific rule → override allowed
- ✗ If child tried to override `verdict-format` → override rejected (structural element)
- ✗ If child tried to override `work-submission-protocol` → override rejected (structural element)

**What server returns:**

```json
{
  "override_scope": {
    "allowed": [
      "audit-dimensions",
      "severity-mapping"
    ],
    "rejected": [],
    "structural_elements_preserved": [
      "verdict-format",
      "work-submission-protocol",
      "reward-signal-structure"
    ]
  }
}
```

---

## Step 3: Materialized Content (Parent + Delta)

**What server produces:**

### 3.1 Workflow Steps (Materialized)

**Step 1: Receive Work Submission**

```json
{
  "step": 1,
  "name": "Receive Work Submission",
  "source": "inherited:critic-loop",
  "content": {
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
}
```

**Step 2: Domain-Specific Audit**

```json
{
  "step": 2,
  "name": "Domain-Specific Audit",
  "source": "overridden:example-specialized-reviewer",
  "override_type": "additive",
  "content": {
    "audit_dimensions": [
      "principles-compliance",
      "contract-type-correctness",
      "interpreter-matching",
      "inline-code-vs-artifacts",
      "redundancy-check"
    ],
    "for_each_item": "Load item content, run all 5 audit dimensions, record findings"
  }
}
```

**Step 3: Delegate to Subagent**

```json
{
  "step": 3,
  "name": "Delegate to Subagent",
  "source": "inherited:critic-loop",
  "rung_level": "rung-2-judgment",
  "content": {
    "contract": "subagent",
    "task": "Audit adapter for principles compliance",
    "context": {
      "work_item": "<current item from Step 1>",
      "audit_dimensions": "<5 checks from Step 2>",
      "evidence_required": "shell output, file paths, line numbers",
      "judgment_criteria": "Evaluate adapter against three principles (autonomy, help-not-puzzles, honest verification) and five audit dimensions"
    }
  }
}
```

**Step 4: Synthesize Findings**

```json
{
  "step": 4,
  "name": "Synthesize Findings",
  "source": "overridden:example-specialized-reviewer",
  "override_type": "enhancement",
  "content": {
    "severity_mapping": {
      "critical": "Principles violations",
      "high": "Contract type mismatches",
      "medium": "Interpreter mismatches, missing artifacts",
      "low": "Redundancy, style issues"
    },
    "synthesis_output": {
      "findings": [
        {
          "dimension": "principles-compliance",
          "severity": "critical",
          "issue": "Adapter uses comment contract for verification that should be shell",
          "evidence": "Line 42: comment contract 'verify syntax' — should be shell with python3 -c"
        }
      ],
      "summary": {
        "critical": 1,
        "high": 0,
        "medium": 1,
        "low": 0
      }
    }
  }
}
```

**Step 5: Produce Verdict**

```json
{
  "step": 5,
  "name": "Produce Verdict",
  "source": "inherited:critic-loop",
  "content": {
    "contract": "shell",
    "interpreter": "bash",
    "command": "echo 'PASS' > verdict.txt && echo 'High' >> verdict.txt",
    "verdict_format": {
      "line_1": "PASS or FAIL",
      "line_2": "Severity (Critical, High, Medium, Low)"
    },
    "decision_logic": {
      "fail_if": "any finding is critical or high",
      "pass_if": "findings are medium or low only",
      "severity": "max(finding severities)"
    }
  }
}
```

**Step 6: Reward Signal**

```json
{
  "step": 6,
  "name": "Reward Signal",
  "source": "inherited:critic-loop",
  "content": {
    "reward": {
      "outcome": "pass | fail",
      "severity": "critical | high | medium | low",
      "evidence": "verdict.txt content",
      "findings_count": {
        "critical": 0,
        "high": 0,
        "medium": 0,
        "low": 0
      }
    }
  }
}
```

### 3.2 Contracts (Materialized)

**Artifact Contract:**

```json
{
  "contract": "shell",
  "interpreter": "bash",
  "command": "echo 'Verifying specialized reviewer artifacts exist' && ls -la work/*.md 2>/dev/null | wc -l",
  "source": "inherited:critic-loop"
}
```

**Forward Contract:**

```json
{
  "contract": "forward",
  "target": "squadrules://adapter/example-next-adapter",
  "source": "inherited:critic-loop",
  "note": "Forward contracts must be link-only per ADR 0028. No payload or handoff data allowed."
}
```

---

## Step 4: Checkpoint Generation (Context Protection)

**What server generates:**

### 4.1 Pre-Execution Checkpoint

```json
{
  "checkpoint_id": "pre-execution",
  "timestamp": "2026-11-05T10:00:00Z",
  "state": {
    "inheritance_tree": ["example-specialized-reviewer", "critic-loop"],
    "override_scope": {
      "allowed": ["audit-dimensions", "severity-mapping"],
      "rejected": []
    },
    "materialized_content": "6-step workflow (Steps 1,3,5,6 inherited; Steps 2,4 overridden)"
  },
  "rollback_target": null
}
```

### 4.2 Post-Step-2 Checkpoint (after domain-specific audit)

```json
{
  "checkpoint_id": "post-domain-audit",
  "timestamp": "2026-11-05T10:00:05Z",
  "state": {
    "completed_steps": [1, 2],
    "audit_findings": [
      {
        "dimension": "principles-compliance",
        "severity": "critical",
        "issue": "Comment contract for shell verification"
      }
    ]
  },
  "rollback_target": "pre-execution"
}
```

### 4.3 Post-Step-4 Checkpoint (after synthesis)

```json
{
  "checkpoint_id": "post-synthesis",
  "timestamp": "2026-11-05T10:00:10Z",
  "state": {
    "completed_steps": [1, 2, 3, 4],
    "synthesis_result": {
      "critical": 1,
      "high": 0,
      "medium": 1,
      "low": 0
    }
  },
  "rollback_target": "post-domain-audit"
}
```

### 4.4 Post-Execution Checkpoint (after verdict)

```json
{
  "checkpoint_id": "post-execution",
  "timestamp": "2026-11-05T10:00:15Z",
  "state": {
    "completed_steps": [1, 2, 3, 4, 5, 6],
    "verdict": {
      "outcome": "FAIL",
      "severity": "critical",
      "evidence_file": "verdict.txt"
    },
    "reward_signal": {
      "outcome": "fail",
      "severity": "critical"
    }
  },
  "rollback_target": "post-synthesis"
}
```

---

## Step 5: Anomaly Detection (Ontological Evolution)

**What server monitors during execution:**

### 5.1 Explicit Anomalies (Agent-Declared)

**Scenario:** Agent discovers that `critic-loop` (parent) doesn't check for interpreter mismatches.

**Agent action:**

```json
{
  "contract": "train",
  "target": "squadrules://adapter/critic-loop",
  "payload": {
    "anomaly": {
      "type": "missing-dimension",
      "description": "Parent critic-loop doesn't check interpreter matching (bash vs python3)",
      "discovered_by": "example-specialized-reviewer",
      "severity": "high",
      "evidence": "python-implementation adapter has shell contract with python3 code but bash interpreter"
    },
    "proposed_update": {
      "add_dimension": "interpreter-matching",
      "check": "shell command interpreter matches code type",
      "severity": "high"
    }
  }
}
```

**Server action:**

1. Validate anomaly against parent's current dimensions
2. Check if ≥3 children report same anomaly (consensus threshold)
3. If consensus reached, trigger parent update proposal
4. Verify parent update doesn't break other children
5. If safe, update parent automatically (core contradiction resolution)

### 5.2 Automatic Anomalies (Server-Detected)

**Scenario:** Server detects that child's `audit-dimensions` override contradicts parent's baseline.

**Server detection:**

```json
{
  "anomaly_type": "override-contradiction",
  "child": "example-specialized-reviewer",
  "parent": "critic-loop",
  "dimension": "audit-dimensions",
  "child_value": ["principles-compliance", "contract-type-correctness", "interpreter-matching", "inline-code-vs-artifacts", "redundancy-check"],
  "parent_value": ["structural-review", "contract-validation"],
  "contradiction": "Child adds 3 new dimensions that parent doesn't have",
  "resolution": "backport-to-parent",
  "confidence": 0.85
}
```

**Server action:**

1. Flag contradiction (child adds dimensions parent lacks)
2. Propose backport: add child's dimensions to parent
3. Verify backport doesn't break other children
4. If safe, update parent automatically
5. If unsafe, create sub-category instead

### 5.3 Agent Judgment Anomalies (LLM Assessment)

**Scenario:** Agent judges that parent's workflow is suboptimal for domain-specific work.

**Agent judgment:**

```json
{
  "anomaly_type": "workflow-optimization",
  "child": "example-specialized-reviewer",
  "parent": "critic-loop",
  "judgment": "Parent's 6-step workflow is too generic for adapter review. Domain-specific work needs 8-step workflow with explicit evidence collection and verification.",
  "confidence": 0.75,
  "proposed_optimization": {
    "add_steps": [
      {"step": "2.5", "name": "Collect Evidence", "action": "Gather shell output, file paths, line numbers"},
      {"step": "4.5", "name": "Verify Findings", "action": "Cross-check findings against multiple sources"}
    ]
  }
}
```

**Server action:**

1. Accept agent judgment (confidence > 0.7 threshold)
2. Log optimization proposal for parent's next version
3. Do NOT auto-update parent (optimization is not core contradiction)
4. Mark as "pending consensus" — if ≥3 children propose similar optimization, trigger parent update

---

## Step 6: Result Filtering (Confidence-Based)

**What server filters before returning to agent:**

### 6.1 Inheritance Tree Filtering

```json
{
  "inheritance_tree": [
    {
      "slug": "example-specialized-reviewer",
      "version": "1.0.0",
      "confidence": 1.0,
      "included": true
    },
    {
      "slug": "critic-loop",
      "version": "5.22.0",
      "confidence": 1.0,
      "included": true
    }
  ]
}
```

### 6.2 Override Scope Filtering

```json
{
  "override_scope": {
    "allowed": [
      {
        "dimension": "audit-dimensions",
        "confidence": 1.0,
        "included": true
      },
      {
        "dimension": "severity-mapping",
        "confidence": 1.0,
        "included": true
      }
    ],
    "rejected": []
  }
}
```

### 6.3 Materialized Content Filtering

```json
{
  "materialized_steps": [
    {
      "step": 1,
      "source": "inherited:critic-loop",
      "confidence": 1.0,
      "included": true
    },
    {
      "step": 2,
      "source": "overridden:example-specialized-reviewer",
      "confidence": 0.95,
      "included": true,
      "note": "Domain-specific override — high confidence"
    },
    {
      "step": 3,
      "source": "inherited:critic-loop",
      "confidence": 1.0,
      "included": true
    },
    {
      "step": 4,
      "source": "overridden:example-specialized-reviewer",
      "confidence": 0.90,
      "included": true,
      "note": "Domain-specific enhancement — good confidence"
    },
    {
      "step": 5,
      "source": "inherited:critic-loop",
      "confidence": 1.0,
      "included": true
    },
    {
      "step": 6,
      "source": "inherited:critic-loop",
      "confidence": 1.0,
      "included": true
    }
  ]
}
```

### 6.4 Checkpoint Filtering Filtering

```json
{
  "checkpoints": [
    {
      "checkpoint_id": "pre-execution",
      "confidence": 1.0,
      "included": true
    },
    {
      "checkpoint_id": "post-domain-audit",
      "confidence": 0.95,
      "included": true
    },
    {
      "checkpoint_id": "post-synthesis",
      "confidence": 0.90,
      "included": true
    },
    {
      "checkpoint_id": "post-execution",
      "confidence": 1.0,
      "included": true
    }
  ]
}
```

---

## Step 7: Final Agent Response (What Agent Sees)

**What server returns to agent:**

```json
{
  "activation": {
    "adapter": "example-specialized-reviewer",
    "version": "1.0.0",
    "inheritance_tree": [
      {"slug": "example-specialized-reviewer", "version": "1.0.0", "level": 0},
      {"slug": "critic-loop", "version": "5.22.0", "level": 1}
    ],
    "override_scope": {
      "allowed": ["audit-dimensions", "severity-mapping"],
      "rejected": [],
      "structural_elements_preserved": ["verdict-format", "work-submission-protocol", "reward-signal-structure"]
    },
    "materialized_content": {
      "workflow_steps": 6,
      "inherited_steps": [1, 3, 5, 6],
      "overridden_steps": [2, 4],
      "contracts": {
        "artifact": "shell",
        "forward": "forward"
      }
    },
    "checkpoints": [
      "pre-execution",
      "post-domain-audit",
      "post-synthesis",
      "post-execution"
    ],
    "anomaly_detection": {
      "explicit_anomalies": 0,
      "automatic_anomalies": 1,
      "agent_judgment_anomalies": 1,
      "pending_consensus": 1
    },
    "confidence_filtering": {
      "min_confidence": 0.90,
      "max_confidence": 1.0,
      "avg_confidence": 0.96
    }
  },
  "next_action": {
    "step": 1,
    "instruction": "Receive work submission with kind, items, root structure",
    "expected_input": {
      "work": {
        "kind": "adapter-review",
        "items": [{"path": "...", "type": "...", "claims": [...]}],
        "root": "/path/to/work/dir"
      }
    }
  }
}
```

---

## Summary: What This Simulation Demonstrates

### Inheritance Resolution (Server-Side, at Activation)

- ✓ Child stores only delta (domain-specific overrides)
- ✓ Parent stores base content (generic workflow)
- ✓ Server materializes full content at activation time
- ✓ Agent sees single coherent adapter (no manual merging)

### Override Scope (Domain Rules Flexible, Structural Elements Fixed)

- ✓ Child can override domain-specific rules (audit dimensions, severity mapping)
- ✓ Child cannot override structural elements (verdict format, work submission protocol)
- ✓ Server validates override scope before materialization

### Checkpoint Generation (Context Protection)

- ✓ Server generates checkpoints at inheritance level boundaries
- ✓ Checkpoints capture inheritance tree, override scope, materialized content
- ✓ Rollback targets enable recovery from execution failures

### Anomaly Detection (Ontological Evolution)

- ✓ Explicit anomalies (agent-declared) trigger parent update proposals
- ✓ Automatic anomalies (server-detected) flag override contradictions
- ✓ Agent judgment anomalies (LLM assessment) propose workflow optimizations
- ✓ Consensus threshold (≥3 children) prevents premature parent updates

### Result Filtering (Confidence-Based)

- ✓ Inheritance tree filtered by confidence (min 0.90)
- ✓ Override scope filtered by confidence
- ✓ Materialized content filtered by confidence
- ✓ Checkpoints filtered by confidence

### AI Psychology (Beyond Compliance)

- ✓ **Cognitive ease:** Agent sees single coherent adapter, not parent+child merge
- ✓ **Predictive confidence:** High confidence scores (0.90-1.0) reinforce trust
- ✓ **Competence reinforcement:** Clear override scope shows what agent can/cannot change
- ✓ **Flow state enablement:** Checkpoints enable recovery without restart
- ✓ **Learning acceleration:** Anomaly detection evolves ontology based on agent discoveries

---

## Next Steps (Future Implementation)

1. **Validate design** — review simulation with team, confirm architecture
2. **Prototype** — build minimal server-side inheritance resolution
3. **Test anomaly detection** — validate backporting mechanism with real adapters
4. **Test checkpoint generation** — validate context protection with real execution
5. **Scale** — implement confidence-based filtering for large inheritance trees
6. **Document** — create ADR for inheritance mechanism, update embed-docs
