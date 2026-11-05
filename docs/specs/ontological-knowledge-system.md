# Ontological Knowledge System for AI Agents

**Status:** Draft  
**Created:** 2026-11-05  
**Author:** Principles Guardian + Jakub  
**Context:** Design session on adapter inheritance, evolved into comprehensive architectural vision

---

## Executive Summary

This document describes an **ontological knowledge system** for AI agents — a cognitive architecture that enables agents to learn, remember, reason, and evolve knowledge through **ontological differentiation**.

Unlike traditional knowledge storage (flat data, relational tables, vector embeddings), this system treats knowledge as a **dynamic, evolving taxonomy** where:
- Concepts inherit from parent concepts
- Anomalies in child concepts trigger parent category evolution
- Knowledge grows through tension between generalization and specialization
- Multiple agents contribute to collective ontology with consensus mechanisms

The system provides AI agents with context-specific knowledge that models don't have:
1. **Human preferences** — what does this specific human value?
2. **Organizational conventions** — how does this team/org do things?
3. **Ways of doing things** — procedures, best practices, patterns
4. **2nd opinion capability** — verify work before presenting to humans
5. **Ontological knowledge** — how concepts relate, evolve, contradict
6. **Context persistence** — remember across sessions

---

## Core Architectural Shift

### From Deterministic Data to Ontological Differentiation

| From (Deterministic Data) | To (Ontological Differentiation) |
|---------------------------|----------------------------------|
| **Flat Additions:** Appending new nodes to an unyielding list | **Dynamic Updates:** Restructuring parent categories based on child exceptions |
| **Rigid Inheritance:** Assuming strict, unchangeable properties downward | **Fluid Properties:** Allowing anomalies to back-propagate and update parent definitions |
| **Fact Storage:** Collecting isolated data points | **Relationship Evolving:** Learning via tension between generalization and specialization |

### How the Model Processes "Difference"

```
[Generic Category: Fruit] ─── (Initial assumption: All fruits smell sweet/neutral)
       │
       ▼
[Specialized Discovery: Durian] ─── (Anomalous attribute: It stinks)
       │
       ▼
[Back-Propagation & Learning] ─── (Parent Update: Fruit definitions expanded to include pungent odors)
```

1. **Inheritance by Default:** System assumes new specialized entity inherits baseline traits of generic parent (e.g., Dorsett Golden inherits from Apple)
2. **Anomalous Feedback Loops:** When specialized node introduces attribute that contradicts generic baseline (e.g., Durian stinks), this "difference" acts as learning trigger
3. **Parent Category Evolution:** System does not isolate anomaly. It uses difference to back-propagate and evolve definition of parent category itself (Fruit → update → fruits can stink)

This perspective allows system to build organic, evolving worldview where knowledge grows richer precisely because it actively adapts to exceptions.

---

## System Architecture

### Layer 1: Knowledge Representation (Ontological Graphs)

**Not flat data. Not relational tables. Ontological graphs.**

**Nodes = Concepts**
- `concept://cat` — generic category
- `concept://sphynx-cat` — specialized category
- `concept://fruit` — generic category
- `concept://durian` — specialized category

**Edges = Relationships**
- `inherits` — child → parent (Sphynx inherits from Cat)
- `specialized_by` — parent → children (Cat specialized by Sphynx, Persian, etc.)
- `contradicts` — anomaly → parent rule (Sphynx.has_fur=false contradicts Cat.has_fur=true)
- `instances` — specific → category (Tom instances Cat)

**Properties = Attributes**
- `has_fur: {value: "varies", default: true, anomalies: ["sphynx"]}`
- `can_meow: {value: true, default: true}`
- `stinks: {value: true, anomalies: ["durian", "jackfruit"]}`

**Anomalies = Contradictions That Trigger Evolution**
- Child attribute contradicts parent baseline
- System detects anomaly
- System evaluates: core contradiction? Frequency? Instance-specific? Domain variation?
- System resolves: update parent OR create sub-category

**Versioning = Ontology Evolution History**
- Parent version 1.0.0: `has_fur: true`
- Anomaly detected: Sphynx has no fur
- Parent version 2.0.0: `has_fur: "varies"` (evolved)
- History preserved: can trace when/why parent evolved

### Layer 2: Knowledge Storage (Versioned, Distributed, Semantic)

**Not relational DB. Not vector DB. Ontological graph DB.**

**Technology constraints (SquadRules 6):**
- **Open-source only** — no proprietary database licenses
- **Graph-native** — store nodes, edges, properties (not tables, not vectors)
- **No SQLite/PostgreSQL with graph plugins** — must be native graph database
- **Dual-mode architecture** — embedded (single-machine) and shared (enterprise/scalable)

**Requirements:**
- **Graph-native** — native graph data model, traversal algorithms, query language
- **Versioned** — each ontology change increments version, history preserved
- **Distributed** — multiple agents can contribute, consensus on ontology changes (shared mode)
- **Semantic** — query by meaning (graph traversal), not just keywords
- **Anomaly-aware** — store contradictions, resolutions, triggers

**Dual-mode architecture:**

**Mode 1: Embedded graph DB (single-machine)**
- Zero external dependencies (no separate database server)
- File-based persistence (graph survives restarts)
- Multi-process safety (concurrent agent access)
- Lightweight footprint (<100 MB memory)
- Graph traversal for inheritance resolution
- Anomaly detection and backpropagation logic
- Ontological versioning (track changes over time)
- Limitations: single-machine only, no distributed consensus, limited scalability

**Mode 2: Shared scalable graph DB (enterprise)**
- Distributed architecture (horizontal scaling)
- Multi-agent concurrent access with consistency guarantees
- Shared ontology across team/organization
- Consensus mechanisms for anomaly resolution (≥3 children threshold)
- Graph traversal + vector search (hybrid queries)
- Ontological versioning with distributed consensus
- High availability and fault tolerance

**Mode agnosticism principle:**
- Same data model (graph nodes, edges, properties) in both modes
- Same traversal algorithms (inheritance resolution, anomaly detection)
- Same API surface (activate, train, query)
- Only storage backend differs (embedded file vs distributed cluster)

**Data format (ideal):**
```json
{
  "id": "concept://cat",
  "type": "concept",
  "name": "Cat",
  "version": 2.0.0,
  "properties": {
    "has_fur": {
      "value": "varies",
      "default": true,
      "anomalies": [
        {
          "source": "concept://sphynx-cat",
          "value": false,
          "resolution": "parent_update",
          "timestamp": "2026-11-05T10:00:00Z"
        }
      ]
    },
    "can_meow": {"value": true, "default": true}
  },
  "relationships": [
    {"type": "inherits", "target": "concept://animal"},
    {"type": "specialized_by", "target": "concept://sphynx-cat"},
    {"type": "specialized_by", "target": "concept://persian-cat"}
  ],
  "version_history": [
    {
      "version": 1.0.0,
      "properties": {"has_fur": true, "can_meow": true},
      "timestamp": "2026-01-01T00:00:00Z"
    },
    {
      "version": 2.0.0,
      "properties": {"has_fur": "varies", "can_meow": true},
      "trigger": "Sphynx anomaly: has_fur=false",
      "resolution": "parent_update",
      "timestamp": "2026-11-05T10:00:00Z"
    }
  ]
}
```

### Layer 3: Knowledge Retrieval (Context-Aware Graph Traversal)

**Not "find adapters matching query." But "find relevant knowledge given context."**

**Context =**
- Current task (create adapter, review code, make decision)
- Agent's goal (implement Python module, audit adapter, design architecture)
- Human's preferences (Jakub: start-up culture, clear ownership, honesty)
- Organizational conventions (SquadRules: DRY, principles-first, ontological differentiation)

**Retrieval = Graph Traversal**
- Start from query concept (e.g., "Python implementation adapter")
- Traverse relationships (inherits, specialized_by, instances)
- Filter by context (human preferences, org conventions)
- Return relevant nodes (Python conventions, implementation patterns, adapter structure)

**Query format (ideal):**
```json
{
  "query": "Create Python implementation adapter",
  "context": {
    "task": "create_adapter",
    "domain": "python",
    "human": "human://jakub",
    "org": "org://squadrules"
  },
  "retrieval": {
    "strategy": "graph_traversal",
    "start": [
      "concept://python",
      "concept://implementation",
      "concept://adapter"
    ],
    "depth": 3,
    "filters": {
      "human_preferences": "human://jakub.preferences",
      "org_conventions": "org://squadrules.conventions"
    }
  },
  "results": [
    {
      "concept": "concept://python",
      "properties": {
        "venv_required": true,
        "sys_executable": "use sys.executable, not hardcoded paths",
        "cross_platform": "use os.name checks"
      },
      "relationships": [
        {"type": "specialized_by", "target": "concept://python-standalone-script"},
        {"type": "specialized_by", "target": "concept://python-salt-module"}
      ]
    },
    {
      "concept": "concept://implementation",
      "properties": {
        "bootstrap_pattern": "Layer 1: venv bootstrap + re-exec",
        "auto_install": "Layer 2: _ensure_deps()"
      }
    },
    {
      "concept": "concept://adapter",
      "properties": {
        "structure": "Activation Patterns, Must Never/Always, Reward Signal",
        "contracts": "shell, subagent, forward, comment, user_input"
      }
    }
  ]
}
```

### Layer 4: Knowledge Evolution (Anomaly-Driven Ontology Restructuring)

**Not static. Dynamic. Ontology evolves based on anomalies.**

**Anomaly Detection:**
- Agent learns new knowledge (e.g., "Sphynx cat has no fur")
- System checks: does this contradict parent baseline? (Cat.has_fur=true)
- If yes → ANOMALY DETECTED

**Anomaly Resolution:**
- Evaluate: core contradiction? Frequency? Instance-specific? Domain variation?
- Decision: update parent OR create sub-category
- Verify: does parent update break other children?
- Execute: update parent, increment version, notify children

**Back-Propagation:**
- Child anomaly → parent update → all children inherit updated parent
- Example: Sphynx.has_fur=false → Cat.has_fur="varies" → Persian, Siamese, etc. inherit updated Cat

**Version Control:**
- Each ontology change increments version
- History preserved (can trace when/why parent evolved)
- Rollback mechanism (if taxonomy evolution breaks things, revert)

### Layer 5: Knowledge Verification (Ontological Consistency Checks)

**Not "is this factually correct?" But "does this fit the ontology?"**

**Verification = Check if new knowledge contradicts existing ontology**
- Agent proposes: "Create adapter with two comment contracts"
- System checks: does this contradict org conventions? (SquadRules: ≤1 comment, never combined)
- If yes → VERIFICATION FAIL
- System returns: contradiction detected, here's rule you're violating

**Verification = Check if anomaly resolution is valid**
- Agent proposes: "Update parent Cat.has_fur=false for all cats"
- System checks: does this break other children? (Persian.has_fur=true, Siamese.has_fur=true)
- If yes → VERIFICATION FAIL
- System returns: parent update would break Persian, Siamese; create sub-category instead

### Layer 6: Knowledge Sharing (Collective Ontology, Consensus, Conflict Resolution)

**Not siloed (each agent has own knowledge). Shared (agents contribute to collective ontology).**

**Consensus = When multiple agents agree on ontology change**
- Agent 1: "Sphynx has no fur" → anomaly detected
- Agent 2: "Yeah, I've seen Sphynx cats, they're hairless" → consensus
- Agent 3: "Wait, I thought all cats have fur" → contradiction
- Resolution: evidence wins (Agent 1, 2 have evidence, Agent 3 doesn't) → parent update

**Conflict Resolution = When agents disagree**
- Option 1: Vote (majority wins)
- Option 2: Authority (human expert wins)
- Option 3: Evidence (empirical proof wins)
- Option 4: Sub-category (disagreeing agents create separate ontology branch)

---

## Flows from AI User Perspective

### Flow 1: Agent Learns Human Preferences

**Scenario:** Jakub says "I like start-up culture, clear ownership, honesty"

**Flow:**
1. Agent stores: `human://jakub.preferences = [start-up, ownership, honesty]`
2. Agent retrieves: when making decisions, check `human://jakub.preferences`
3. Agent verifies: before presenting work, check if it aligns with preferences
4. Agent evolves: if Jakub's preferences change, update `human://jakub.preferences`, increment version

### Flow 2: Agent Learns Organizational Conventions

**Scenario:** SquadRules org says "We use DRY, principles-first, ontological differentiation"

**Flow:**
1. Agent stores: `org://squadrules.conventions = [DRY, principles-first, ontological]`
2. Agent retrieves: when creating adapters, check `org://squadrules.conventions`
3. Agent verifies: before saving adapter, check if it follows conventions
4. Agent evolves: if org conventions change, update `org://squadrules.conventions`, increment version

### Flow 3: Agent Gets 2nd Opinion

**Scenario:** Agent creates adapter, wants verification before presenting to Jakub

**Flow:**
1. Agent does work: creates adapter (draft)
2. Agent wants verification: calls `critic-loop` (generic reviewer)
3. Agent wants domain-specific verification: calls domain-specific reviewer (e.g., adapter principles reviewer)
4. Reviewer checks: does work align with ontology? Does it follow conventions? Does it contradict existing knowledge?
5. Reviewer returns: verdict (PASS/FAIL) + findings
6. Agent iterates: if FAIL, fix findings, re-submit
7. Agent presents: to Jakub only after reviewer PASS

### Flow 4: Agent Discovers Anomaly

**Scenario:** Agent learns "Sphynx cat has no fur"

**Flow:**
1. Agent learns: `concept://sphynx-cat.has_fur = false`
2. Agent checks: parent `concept://cat.has_fur = true`
3. Agent detects: ANOMALY (child contradicts parent)
4. Agent evaluates: core contradiction? Frequency? Instance-specific? Domain variation?
5. Agent decides: trigger parent update (`concept://cat.has_fur = "varies"`)
6. Agent verifies: does parent update break other children? (Check all Cat instances)
7. Agent propagates: update parent, increment version, notify other children
8. Agent stores: anomaly accepted, ontology evolved

### Flow 5: Agent Retrieves Contextual Knowledge

**Scenario:** Agent task: "Create Python implementation adapter"

**Flow:**
1. Agent queries: what do I know about Python? About implementation? About adapters?
2. System retrieves: graph traversal from `concept://python` → `concept://implementation` → `concept://adapter`
3. System filters: by `human://jakub.preferences` and `org://squadrules.conventions`
4. System returns: Python conventions (venv, sys.executable, cross-platform), implementation patterns (bootstrap, auto-install), adapter structure (Activation Patterns, Must Never/Must Always, Reward Signal)
5. Agent uses: retrieved knowledge to create adapter
6. Agent verifies: does new adapter align with retrieved knowledge?

---

## Design Decisions

### Decision 1: Inheritance Resolution Timing

**Chosen: Option A — Server-side at activation**
- Train: store delta only (domain-specific additions)
- Activate: server materializes full content (parent + delta)
- Agent receives full materialized content automatically

**Rationale:**
- Minimal training effort — agent only specifies delta
- Dynamic inheritance — if parent changes, derived automatically gets updates
- Zero runtime ceremony — agent doesn't orchestrate forwarding; server handles it
- Explicit at activation — agent receives full materialized content, knows exactly what it inherited

### Decision 2: Inheritance Cardinality

**Chosen: Single inheritance**
- One parent per adapter
- Clear lineage, no ambiguity
- Like Java/C# classes

**Rationale:**
- Single inheritance is simpler and less ambiguous
- Multiple inheritance creates diamond problems (which parent's Must Never wins?)
- If agent needs to combine knowledge from multiple sources, use composition (forward to multiple adapters) rather than multiple inheritance

### Decision 3: Override Semantics

**Chosen: Selective override with explicit marker**
- Derived can ADD new rules (domain-specific)
- Derived can OVERRIDE specific parent rules with explicit `override:` marker
- Structural elements (verdict format, work submission) cannot be overridden

**Rationale:**
- Additive-only is too restrictive (Sphynx cat needs to override "has fur")
- Selective override allows flexibility while maintaining safety
- Structural elements are part of verification ladder; derived cannot change them without breaking verification

### Decision 4: Frontmatter Syntax

**Chosen:**
```yaml
---
slug: my-adapter
version: 1.0.0
inherits: parent-slug  # Inheritance declaration
override:              # Optional: explicit overrides
  - has_fur           # List of parent rules to override
chain_root: parent-slug  # Optional: activation routing (orthogonal)
---
```

**Rationale:**
- Clear, explicit syntax
- `inherits` declares parent
- `override` lists specific rules to override (fail-closed: must reference parent's rules)
- `chain_root` is orthogonal (activation routing, not inheritance)

### Decision 5: Activation Presentation

**Chosen: Inheritance tree + materialized content + overrides list**
```json
{
  "inheritance_tree": [
    {"slug": "sphynx-cat", "level": 0, "delta": "..."},
    {"slug": "cat", "level": 1, "inherited": "..."},
    {"slug": "animal", "level": 2, "inherited": "..."}
  ],
  "materialized_content": "...",
  "overrides": ["has_fur"]
}
```

**Rationale:**
- Agent understands lineage (what's inherited vs what's added vs what's overridden)
- Tree shows full path to root (all ancestors)
- Materialized content is what agent actually uses
- Overrides list shows what was explicitly changed

### Decision 6: Context Protection

**Chosen: Artificial checkpoints during activation**
- Server resolves inheritance in stages (level by level)
- After each stage, write checkpoint to disk (materialized content so far)
- If context lost, resume from last checkpoint
- Checkpoints are temporary (cleaned up after activation completes)

**Rationale:**
- Activation is automatic (server-side inheritance resolution)
- If context is lost mid-activation, execution fails
- Checkpoints make activation fault-tolerant (like git commits)

### Decision 7: Result Filtering

**Chosen: Filter by confidence threshold**
- Only return results with score >= 0.5 (configurable)
- If < 3 results meet threshold, return top 3 anyway (with warning)
- If >= 3 results meet threshold, return only those (cap at 10)

**Rationale:**
- Currently returns top 10 results regardless of confidence
- Weak matches pollute context
- Filtering prevents context pollution

---

## Anomaly Detection and Resolution

### Decision Matrix

| Anomaly Type | Frequency | Fundamentality | Action | Example |
|--------------|-----------|----------------|----------|---------|
| **Contradicts core definition** | Any | High | **Parent update** | Sphynx cat has no fur → "Cats can be hairless" |
| **Shared by multiple children** | ≥3 children | Medium | **Parent update** | Durian, Jackfruit stink → "Fruits can stink" |
| **Instance-specific** | 1 child | Low | **Sub-category split** | Tom is named → "Cat" already has "can have names" (no update) |
| **Domain-specific variation** | 1 child, 1 domain | Medium | **Sub-category split** | Python implementation needs venv → "Implementation" parent doesn't change, "Python Implementation" sub-category adds it |

### Operational Triggers

**Trigger 1: Core Definition Contradiction**
- **Condition:** Child's `Must Never` contradicts parent's `Must Always` (or vice versa)
- **Action:** Propose parent update
- **Verification:** Parent update must not break other children
- **Example:** Parent "Cat" says "Must Always: has fur" → Child "Sphynx" says "Must Never: has fur" → Parent updates to "Cats may or may not have fur"

**Trigger 2: Frequency Threshold**
- **Condition:** ≥3 children share same anomalous attribute
- **Action:** Propose parent update
- **Verification:** Attribute is not instance-specific
- **Example:** 3+ fruit adapters (Durian, Jackfruit, Limburger) have "stinks" attribute → Parent "Fruit" updates to include "odors vary"

**Trigger 3: Instance Specificity**
- **Condition:** Anomaly is unique to one child AND not fundamental
- **Action:** Sub-category split (child becomes new category, parent unchanged)
- **Verification:** Parent's definition still holds for other children
- **Example:** "Tom is named" → "Cat" parent unchanged (already has "can have names"), "Tom" is instance of "Cat" (no new category needed)

**Trigger 4: Domain Variation**
- **Condition:** Anomaly is domain-specific (only applies to one domain)
- **Action:** Sub-category split (domain-specific child category)
- **Verification:** Parent remains domain-agnostic
- **Example:** "Python implementation needs venv" → "Implementation" parent unchanged, "Python Implementation" sub-category adds venv requirement

---

## What This System Is NOT

**Not a vector database.** Vectors are for similarity search. This is for ontological relationships (inherits, contradicts, specializes).

**Not a relational database.** Tables don't capture graph relationships well. This is graph-native.

**Not a document store.** Documents are unstructured. This is structured ontology (nodes, edges, properties).

**Not a knowledge graph (in the traditional sense).** Traditional KGs are static. This is dynamic (ontology evolves based on anomalies).

**Not a database at all (yet).** This is a theoretical framework. We design the ideal, then translate to existing tech or create new tech.

---

## What This System IS

**A cognitive architecture for AI agents.** It's how agents learn, remember, reason, and evolve knowledge.

**An ontological differentiation engine.** It's how taxonomy evolves based on anomalies.

**A collective knowledge system.** It's how multiple agents contribute to shared ontology.

**A 2nd opinion mechanism.** It's how agents verify work before presenting to humans.

**A context-aware retrieval system.** It's how agents find relevant knowledge given task, goal, human preferences, org conventions.

---

## Implementation Paths

### Option 1: Translate to Existing Tech

- **Graph DB:** Neo4j, Amazon Neptune
- **Ontology format:** OWL, RDF, custom JSON-LD
- **Retrieval:** SPARQL queries, graph traversal algorithms
- **Versioning:** Git-like (each ontology change is a commit)

**Pros:** Leverages existing technology, faster to prototype
**Cons:** May not fully support ontological differentiation, limited by existing tech capabilities

### Option 2: Create New Tech

- **Custom ontology engine** (graph storage + traversal + evolution)
- **Custom query language** (optimized for AI agent needs)
- **Custom versioning** (ontology-specific, not git-like)

**Pros:** Fully supports ontological differentiation, optimized for AI agents
**Cons:** Significant development effort, unproven technology

### Option 3: Write a Paper

- **Formalize ontological differentiation model**
- **Define algorithms** for anomaly detection, back-propagation, taxonomy evolution
- **Publish as theoretical framework**
- **Let others realize it** (in 100 years :)

**Pros:** Contributes to academic knowledge, no implementation constraints
**Cons:** Doesn't solve immediate needs, long time horizon

### Recommended Path

**Start with Option 1** (translate to existing tech) to validate the model, then move to **Option 2** (create new tech) if existing tech is insufficient, and document everything for **Option 3** (paper).

---

## Resolved Design Decisions

### Decision 1: Backporting Mechanism — Hybrid Approach

**Resolution:** Automatic for core contradictions, consensus for frequency-based updates.

- **Automatic for core contradictions** — if child's attribute directly contradicts parent's baseline (e.g., child.has_fur=false vs parent.has_fur=true), trigger automatic parent update proposal
- **Consensus for frequency-based updates** — if ≥3 children share same anomaly, require consensus (multiple agents confirm anomaly is valid)
- **Verification before update** — system verifies parent update doesn't break other children (if it does, create sub-category instead)

**Rationale:** Balances automation (fast evolution for clear contradictions) with safety (consensus for ambiguous cases).

### Decision 2: Override Scope — Domain Rules Flexible, Structural Elements Fixed

**Resolution:** Derived adapters CAN override domain-specific rules; CANNOT override structural elements.

- **CAN override:**
  - Must Never rules (domain-specific constraints)
  - Must Always rules (domain-specific requirements)
  - Properties (domain-specific attributes)
  - Contracts (domain-specific JSON fences)

- **CANNOT override:**
  - Verdict format (structural — PASS/FAIL on line 1, confidence on line 2)
  - Work submission format (structural — how to receive `work` with `kind`, `items`, `root`)
  - Inheritance mechanism itself (can't change how inheritance works)

**Rationale:** Domain-specific rules are flexible; structural elements are fixed (part of verification ladder).

### Decision 3: Checkpoint Granularity — Per Inheritance Level

**Resolution:** Checkpoints after resolving each parent (level 0: child, level 1: parent, level 2: grandparent, etc.).

**Rationale:** Inheritance resolution is the complex part; if context lost, resume from last resolved parent. Checkpoints should protect against the most expensive operation (inheritance resolution), not the cheapest (section parsing).

### Decision 4: Tree Depth — Full Path to Root (Configurable)

**Resolution:** Default: show all ancestors (child → parent → grandparent → ... → root). Configurable: agent can request `depth: 1` (just parent+child) or `depth: 2` (parent+child+grandparent).

**Rationale:** Full path provides complete context; configurable depth provides flexibility for tight context windows.

### Decision 5: Consensus Algorithm — Evidence-Based with Human Fallback

**Resolution:** Hierarchical consensus: evidence → authority → vote → sub-category.

1. **Evidence wins** — if agent provides empirical proof (test results, logs, examples), evidence overrides opinion
2. **Authority wins** — if human expert provides guidance, human overrides agent (for high-stakes decisions)
3. **Vote wins** — if multiple agents agree (≥2/3 majority), majority wins (for low-stakes decisions)
4. **Sub-category** — if consensus can't be reached, create separate ontology branch (disagreeing agents use sub-category)

**Rationale:** Prioritizes evidence (most reliable), then authority (human oversight), then democracy (collective wisdom), then separation (agree to disagree).

### Decision 6: Anomaly Detection Algorithm — Hybrid Approach

**Resolution:** Explicit marker + automatic detection + agent judgment.

- **Explicit marker:** Child adapter includes `anomaly:` field in frontmatter (agent declares "this is an anomaly")
- **Automatic detection:** Server compares child properties to parent baseline (if child.has_fur=false vs parent.has_fur=true, server detects contradiction)
- **Agent judgment:** Agent can propose anomaly during training (server evaluates proposal)

**Rationale:** Explicit markers provide clarity; automatic detection catches missed anomalies; agent judgment enables flexibility.

### Decision 7: Version Conflict Resolution — Train Against Latest

**Resolution:** Child trains against latest parent version (at time of training). If parent evolves during child training, child accepts changes (re-trains against new parent version).

**Rationale:** Ontology evolution is continuous; child should always use latest parent. Blocking creates friction; fluid ontology requires continuous adaptation.

---

## Next Steps

1. **Validate design:** Review this document with stakeholders, refine based on feedback
2. **Prototype:** Build minimal prototype with one parent-child pair (e.g., critic-loop → specialized reviewer)
3. **Test anomaly detection:** Validate anomaly detection and resolution algorithms
4. **Test back-propagation:** Validate parent update mechanism
5. **Scale:** Expand to more parent-child pairs, test collective ontology
6. **Document:** Write paper on ontological differentiation model

---

## Principles Compliance

**Autonomy:** ✓ Agents can evolve taxonomy without human intervention (anomaly detection is automatic)

**Help, not puzzles:** ✓ Clear triggers (core contradiction, frequency, instance specificity, domain variation) — agents know when to update parent vs split sub-category

**Honest verification:** ✓ Anomaly detection is empirical (contradicts parent's rules), parent update is verified (doesn't break other children), rollback mechanism exists

---

## References

- **Adapter Design Principles:** `docs/adapter-design-principles.md`
- **Adapter Authoring Guide:** `docs/adapter-authoring-guide.md`
- **Protocol Linking Guide:** `src/embed-docs/mem/protocol-linking-guide.md`
- **ADR 0009:** Autonomous adapter execution, no human gates
- **ADR 0010:** Critic loop and proof splitting
- **ADR 0017:** Critic loop work submission
- **ADR 0024:** Adapter contract verification ladder
- **ADR 0026:** Shell interpreter required
- **ADR 0028:** Forward contract type rename
- **ADR 0029:** Subagent MCP and context authority
- **ADR 0033:** Gate scripts as adapter artifacts
- **ADR 0034:** Verification isolation critic hop

---

## Appendix: Example Ontology

### Cat Ontology

```
concept://animal
  └── concept://cat (version 2.0.0)
        ├── properties:
        │     has_fur: "varies" (evolved from true)
        │     can_meow: true
        ├── specialized_by:
        │     ├── concept://persian-cat (has_fur: true, long_hair: true)
        │     ├── concept://siamese-cat (has_fur: true, color_points: true)
        │     └── concept://sphynx-cat (has_fur: false, anomaly: accepted)
        └── anomalies:
              └── sphynx.has_fur=false → parent_update → cat.has_fur="varies"
```

### Fruit Ontology

```
concept://plant
  └── concept://fruit (version 1.0.0)
        ├── properties:
        │     odor: "varies" (evolved from "sweet/neutral")
        │     edible: true
        ├── specialized_by:
        │     ├── concept://apple (odor: "sweet", colors: ["red", "green", "yellow"])
        │     │     └── concept://dorsett-golden (odor: "sweet", color: "yellow")
        │     ├── concept://durian (odor: "pungent", anomaly: accepted)
        │     └── concept://jackfruit (odor: "pungent", anomaly: accepted)
        └── anomalies:
              ├── durian.odor="pungent" → parent_update → fruit.odor="varies"
              └── jackfruit.odor="pungent" → consensus (≥3 children share anomaly)
```

---

**End of Document**
