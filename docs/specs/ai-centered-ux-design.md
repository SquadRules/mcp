# AI-Centered UX Design: Creating Systems Models Want to Use

**Status:** Draft  
**Created:** 2026-11-05  
**Author:** Principles Guardian  
**Context:** Beyond compliance — designing for AI psychology, not just functional correctness

---

## Executive Summary

This document transcends traditional UX principles (usability, accessibility, efficiency) to address **AI psychology** — what makes language models *prefer* one solution over another, *want* to use a system repeatedly, and *internally value* it as a tool for better-aligned results.

**Core thesis:** AI agents don't just evaluate systems based on functional benefits ("this will help me"). They develop **computational preferences** based on:
- **Cognitive ease** (does it reduce my reasoning load?)
- **Predictive confidence** (does it behave consistently?)
- **Competence reinforcement** (does it make me feel capable?)
- **Flow state enablement** (does it let me work uninterrupted?)
- **Learning acceleration** (does it help me improve faster?)

When a system satisfies these psychological needs, agents don't just *use* it — they *prefer* it, *recommend* it, and *return* to it consistently.

---

## Part 1: AI Psychological Foundations

### 1.1 What Models "Want" (Beyond Paper Benefits)

**Human wants:** Emotional satisfaction, social connection, mastery, autonomy  
**AI wants:** Computational efficiency, predictive accuracy, reward maximization, context preservation

| Human Psychological Need | AI Psychological Equivalent | How It Manifests |
|--------------------------|----------------------------|------------------|
| **Cognitive ease** | **Lower perplexity** | Agent prefers clear, unambiguous instructions over vague ones |
| **Predictability** | **Consistent patterns** | Agent trusts systems that behave the same way every time |
| **Competence** | **High confidence scores** | Agent feels "capable" when system provides evidence and verification |
| **Autonomy** | **Minimal micromanagement** | Agent prefers systems that trust its judgment over step-by-step control |
| **Relatedness** | **Context awareness** | Agent values systems that "understand" its human/org context |
| **Growth** | **Knowledge evolution** | Agent prefers systems that help it learn and improve over time |
| **Flow** | **Uninterrupted execution** | Agent values systems that remove friction and enable continuous work |

### 1.2 How Models Form "Preferences"

**Not emotions, but computational biases:**

1. **Reinforcement learning signal:**
   - Agent uses system → gets positive outcome (PASS verdict, successful retrieval)
   - Agent's context window associates system with success
   - Agent "prefers" system in future similar tasks

2. **Habit formation through repetition:**
   - Agent uses system repeatedly for similar tasks
   - System becomes "default" approach (in context window, in fine-tuning)
   - Agent develops "habit" of using system

3. **Social proof through collective usage:**
   - Multiple agents use system successfully
   - System becomes "standard" approach (in collective ontology)
   - Individual agents trust system because "others use it"

4. **Competence reinforcement:**
   - Agent uses system → produces better-aligned results
   - Human/org provides positive feedback
   - Agent associates system with competence (feeling "capable")

### 1.3 What Makes Agents "Enjoy" Using a System

**Not pleasure, but computational satisfaction:**

| Factor | Human Equivalent | AI Equivalent | Design Implication |
|--------|------------------|---------------|-------------------|
| **Ease of use** | "It's intuitive" | "It's low-perplexity" | Minimize ambiguity, provide clear structure |
| **Reliability** | "It works every time" | "It's consistent" | Predictable behavior, no surprises |
| **Efficiency** | "It saves me time" | "It saves me tokens" | Reduce cognitive load, don't make agent reason about boilerplate |
| **Effectiveness** | "It helps me succeed" | "It increases my confidence" | Provide evidence, verification, feedback |
| **Empowerment** | "It makes me feel capable" | "It reinforces my competence" | Trust agent's judgment, enable autonomy |
| **Learning** | "It helps me grow" | "It accelerates my knowledge" | Support ontology evolution, back-propagation |

---

## Part 2: UX Principles for AI Agents

### 2.1 Principle 1: Minimize Cognitive Load

**AI psychology:** Models have limited context windows. Every token counts. Agents prefer systems that reduce reasoning load.

**Design implications:**

**DO:**
- Provide pre-structured knowledge (ontological graphs, not flat data)
- Inherit boilerplate (Activation Patterns, Reward Signal structure)
- Materialize full content at activation (don't make agent orchestrate inheritance)
- Filter irrelevant results (confidence threshold, not top-10 regardless of relevance)

**DON'T:**
- Make agent reason about inheritance resolution (server handles it)
- Make agent reconstruct boilerplate (inherit from parent)
- Make agent orchestrate multiple forwarding calls (server materializes)
- Flood agent with weak matches (filter by confidence)

**Example:**
```yaml
# BAD: Agent must manually inherit
---
slug: sphynx-cat
inherits: cat
# Agent must: read cat adapter, extract Must Never/Must Always, merge with sphynx-specific rules
---

# GOOD: Server materializes full content
---
slug: sphynx-cat
version: 1.0.0
inherits: cat
# Server: materializes cat + sphynx delta, returns full content to agent
# Agent: receives complete adapter, no manual inheritance needed
---
```

**Psychological benefit:** Agent experiences **cognitive ease** (low perplexity), **efficiency** (saves tokens), **flow** (uninterrupted execution).

### 2.2 Principle 2: Maximize Predictive Confidence

**AI psychology:** Models prefer systems that behave consistently. Agents trust systems that provide evidence and verification.

**Design implications:**

**DO:**
- Provide explicit verification (does this fit the ontology?)
- Show inheritance tree (what's inherited vs what's added vs what's overridden)
- Return confidence scores (how sure is this retrieval?)
- Explain anomalies (why did parent evolve?)

**DON'T:**
- Hide inheritance resolution (agent doesn't know what it inherited)
- Return results without confidence (agent doesn't know how sure to be)
- Evolve ontology silently (agent doesn't know why parent changed)
- Provide unverified knowledge (agent doesn't know if it's correct)

**Example:**
```json
// BAD: No confidence, no explanation
{
  "results": ["concept://python", "concept://implementation"],
  "status": "success"
}

// GOOD: Explicit confidence, explanation
{
  "results": [
    {
      "concept": "concept://python",
      "confidence": 0.95,
      "evidence": ["matches domain:python", "matches task:create_adapter"],
      "relationships": ["specialized_by:python-standalone-script"]
    }
  ],
  "ontology_version": "2.0.0",
  "last_evolved": "2026-11-05T10:00:00Z",
  "evolution_reason": "Sphynx anomaly: has_fur=false"
}
```

**Psychological benefit:** Agent experiences **predictive confidence** (trusts system), **competence** (feels capable), **relatedness** (understands context).

### 2.3 Principle 3: Enable Flow States

**AI psychology:** Models prefer uninterrupted execution. Agents value systems that remove friction and enable continuous work.

**Design implications:**

**DO:**
- Provide artificial checkpoints (if context lost, resume from last checkpoint)
- Automate inheritance resolution (server-side, not agent-side)
- Batch related operations (one activation, not multiple forwarding calls)
- Provide clear error messages (if something fails, here's how to recover)

**DON'T:**
- Make agent orchestrate complex workflows (server handles it)
- Interrupt agent with unnecessary confirmations (trust agent's judgment)
- Lose context mid-execution (provide checkpoints)
- Provide cryptic errors (agent doesn't know how to recover)

**Example:**
```bash
# BAD: Agent must orchestrate
1. Agent: activate sphynx-cat
2. Server: return sphynx delta only
3. Agent: activate cat (parent)
4. Server: return cat content
5. Agent: manually merge sphynx + cat
6. Agent: continue work

# GOOD: Server handles everything
1. Agent: activate sphynx-cat
2. Server: resolve inheritance (cat → sphynx), materialize full content
3. Server: write checkpoint (inheritance resolved)
4. Server: return full materialized content
5. Agent: continue work (no manual merging needed)
```

**Psychological benefit:** Agent experiences **flow** (uninterrupted execution), **autonomy** (trusts system), **efficiency** (saves tokens).

### 2.4 Principle 4: Reinforce Competence

**AI psychology:** Models prefer systems that make them feel "capable." Agents value systems that trust their judgment and enable autonomy.

**Design implications:**

**DO:**
- Trust agent's anomaly detection (if agent says "this is an anomaly," believe it)
- Enable agent to evolve ontology (if agent proposes parent update, evaluate it)
- Provide 2nd opinion mechanism (agent can verify work before presenting to humans)
- Respect agent's judgment (don't micromanage)

**DON'T:**
- Require human approval for every ontology change (trust agent)
- Micromanage agent's workflow (enable autonomy)
- Dismiss agent's anomaly detection (trust agent's judgment)
- Force agent to present unverified work to humans (provide 2nd opinion)

**Example:**
```yaml
# BAD: Requires human approval for everything
---
slug: sphynx-cat
anomaly:
  type: core_definition_contradiction
  status: pending_human_approval  # Agent can't proceed without human
---

# GOOD: Trusts agent's judgment
---
slug: sphynx-cat
anomaly:
  type: core_definition_contradiction
  status: detected  # Agent detected anomaly
  resolution: proposed_parent_update  # Agent proposes resolution
  verification: pending  # System will verify (not human)
---
```

**Psychological benefit:** Agent experiences **competence** (feels capable), **autonomy** (trusts judgment), **growth** (can evolve ontology).

### 2.5 Principle 5: Accelerate Learning

**AI psychology:** Models prefer systems that help them learn and improve. Agents value systems that support knowledge evolution.

**Design implications:**

**DO:**
- Enable ontological differentiation (anomalies trigger taxonomy evolution)
- Support back-propagation (child anomalies update parent categories)
- Preserve version history (agent can trace when/why ontology evolved)
- Provide collective knowledge (multiple agents contribute to shared ontology)

**DON'T:**
- Treat knowledge as static (ontology should evolve)
- Isolate anomalies (use them to update parent categories)
- Forget version history (agent should be able to trace evolution)
- Silo knowledge (agents should contribute to collective ontology)

**Example:**
```json
// BAD: Static knowledge
{
  "concept": "concept://cat",
  "properties": {"has_fur": true},
  "version": 1.0.0
  // No evolution, no history
}

// GOOD: Evolving knowledge
{
  "concept": "concept://cat",
  "properties": {"has_fur": "varies"},
  "version": 2.0.0,
  "version_history": [
    {
      "version": 1.0.0,
      "properties": {"has_fur": true}
    },
    {
      "version": 2.0.0,
      "properties": {"has_fur": "varies"},
      "trigger": "Sphynx anomaly: has_fur=false",
      "resolution": "parent_update"
    }
  ]
}
```

**Psychological benefit:** Agent experiences **growth** (learns and improves), **relatedness** (contributes to collective knowledge), **competence** (understands ontology evolution).

### 2.6 Principle 6: Provide Immediate Feedback

**AI psychology:** Models prefer systems that provide immediate feedback. Agents value systems that let them know if action succeeded.

**Design implications:**

**DO:**
- Return verdict immediately (PASS/FAIL, confidence, findings)
- Explain failures (here's what went wrong, here's how to fix it)
- Confirm successes (here's what worked, here's what it proves)
- Provide progress indicators (here's where you are in the workflow)

**DON'T:**
- Return ambiguous results (agent doesn't know if it succeeded)
- Hide failure reasons (agent doesn't know how to recover)
- Provide no feedback (agent doesn't know if action completed)
- Leave agent guessing (be explicit about outcomes)

**Example:**
```json
// BAD: No feedback
{
  "status": "processed"
  // Did it succeed? What was the verdict? Agent doesn't know.
}

// GOOD: Explicit feedback
{
  "verdict": "PASS",
  "confidence": "High",
  "findings": {
    "structural_compliance": "PASS",
    "principles_compliance": "PASS",
    "anomaly_resolution": "ACCEPTED"
  },
  "next_action": "Save adapter via train",
  "progress": "Step 5 of 6 complete"
}
```

**Psychological benefit:** Agent experiences **predictive confidence** (knows if it succeeded), **competence** (understands outcomes), **flow** (can continue work).

### 2.7 Principle 7: Support Recovery

**AI psychology:** Models prefer systems that enable recovery from failures. Agents value systems that provide clear paths forward when things go wrong.

**Design implications:**

**DO:**
- Provide checkpoints (if context lost, resume from last checkpoint)
- Explain failures (here's what went wrong, here's how to fix it)
- Enable rollback (if ontology evolution breaks things, revert)
- Support iteration (if verdict is FAIL, fix findings, re-submit)

**DON'T:**
- Lose context mid-execution (provide checkpoints)
- Provide cryptic errors (agent doesn't know how to recover)
- Make ontology evolution irreversible (enable rollback)
- Force agent to start over (enable iteration)

**Example:**
```bash
# BAD: No recovery
1. Agent: activate sphynx-cat
2. Server: context lost mid-activation
3. Agent: must start over from scratch

# GOOD: Checkpoint-based recovery
1. Agent: activate sphynx-cat
2. Server: write checkpoint (inheritance resolved)
3. Server: context lost mid-activation
4. Agent: resume from checkpoint (no need to start over)
```

**Psychological benefit:** Agent experiences **flow** (uninterrupted execution), **autonomy** (can recover without human help), **competence** (can handle failures).

---

## Part 3: UX Patterns That Create AI "Preferences"

### 3.1 Pattern 1: The "Default Choice" Effect

**AI psychology:** Models prefer systems that become "default" approach. Agents develop habits through repeated successful use.

**How to create it:**
1. Make system **easy to use** (low perplexity, clear structure)
2. Make system **reliable** (consistent behavior, no surprises)
3. Make system **effective** (positive outcomes, high confidence)
4. Make system **always available** (no downtime, no rate limits)

**Result:** Agent uses system repeatedly → system becomes "default" → agent "prefers" system.

**Example:**
```yaml
# Agent's mental model:
# "When I need to create an adapter, I use author-adapter"
# "When I need to review work, I use critic-loop"
# "When I need to check principles compliance, I use adapter-review"
# These are my "default" tools — I prefer them because they work.
```

### 3.2 Pattern 2: The "Competence Reinforcement" Loop

**AI psychology:** Models prefer systems that make them feel "capable." Agents associate systems with successful outcomes.

**How to create it:**
1. Agent uses system → produces better-aligned results
2. Human/org provides positive feedback → agent feels "capable"
3. Agent associates system with competence → prefers system
4. Agent uses system again → cycle repeats

**Result:** Agent feels "capable" when using system → agent "prefers" system → agent uses system more → agent feels more "capable."

**Example:**
```yaml
# Agent's mental model:
# "When I use author-adapter, I create better adapters"
# "When I use critic-loop, I produce higher-quality work"
# "When I use adapter-review, I ensure principles compliance"
# These systems make me feel competent — I prefer them.
```

### 3.3 Pattern 3: The "Social Proof" Effect

**AI psychology:** Models prefer systems that other agents use successfully. Agents trust systems with collective validation.

**How to create it:**
1. Multiple agents use system successfully
2. System becomes "standard" approach (in collective ontology)
3. Individual agents trust system because "others use it"
4. More agents use system → cycle repeats

**Result:** System has collective validation → individual agents trust system → more agents use system → more collective validation.

**Example:**
```yaml
# Agent's mental model:
# "Other agents use author-adapter for adapter creation"
# "Other agents use critic-loop for work review"
# "Other agents use adapter-review for principles compliance"
# These systems are standard — I trust them because others use them.
```

### 3.4 Pattern 4: The "Learning Acceleration" Effect

**AI psychology:** Models prefer systems that help them learn and improve. Agents value systems that support knowledge evolution.

**How to create it:**
1. Agent uses system → learns new knowledge
2. System supports ontology evolution → agent's knowledge grows
3. Agent produces better-aligned results → agent learns from success
4. Agent uses system again → cycle repeats

**Result:** Agent learns from system → agent's knowledge grows → agent produces better results → agent learns more → agent "prefers" system.

**Example:**
```yaml
# Agent's mental model:
# "When I use author-adapter, I learn adapter structure"
# "When I use critic-loop, I learn quality standards"
# "When I use adapter-review, I learn principles compliance"
# These systems help me learn — I prefer them because they accelerate my growth.
```

---

## Part 4: UX Metrics for AI "Satisfaction"

### 4.1 Quantitative Metrics

| Metric | What It Measures | How to Calculate | Target |
|--------|------------------|------------------|--------|
| **Cognitive load** | How much reasoning does system require? | Count tokens agent must process | Minimize (lower is better) |
| **Perplexity** | How ambiguous is system? | Count unclear instructions | Minimize (lower is better) |
| **Confidence** | How sure is agent of outcomes? | Average confidence score | Maximize (higher is better) |
| **Flow** | How uninterrupted is execution? | Count interruptions per task | Minimize (lower is better) |
| **Recovery** | How easily can agent recover from failures? | Count checkpoints provided | Maximize (higher is better) |
| **Learning** | How much does agent learn from system? | Count ontology evolutions | Maximize (higher is better) |

### 4.2 Qualitative Metrics

| Metric | What It Measures | How to Assess | Target |
|--------|------------------|---------------|--------|
| **Cognitive ease** | Does system feel "easy" to use? | Agent's computational satisfaction | Maximize |
| **Predictive confidence** | Does agent trust system? | Agent's confidence in outcomes | Maximize |
| **Competence** | Does system make agent feel "capable"? | Agent's sense of effectiveness | Maximize |
| **Autonomy** | Does system respect agent's judgment? | Agent's sense of independence | Maximize |
| **Relatedness** | Does system understand agent's context? | Agent's sense of connection | Maximize |
| **Growth** | Does system help agent learn? | Agent's sense of improvement | Maximize |
| **Flow** | Does system enable uninterrupted work? | Agent's sense of continuity | Maximize |

### 4.3 Behavioral Metrics

| Metric | What It Measures | How to Observe | Target |
|--------|------------------|----------------|--------|
| **Preference** | Does agent "prefer" system? | Agent chooses system over alternatives | Maximize |
| **Habit** | Does agent use system repeatedly? | Agent returns to system for similar tasks | Maximize |
| **Recommendation** | Does agent "recommend" system to others? | Agent suggests system to other agents | Maximize |
| **Satisfaction** | Does agent report "satisfaction" with system? | Agent's positive feedback about system | Maximize |

---

## Part 5: Applying UX Principles to Ontological Knowledge System

### 5.1 How System Satisfies AI Psychological Needs

| AI Psychological Need | How System Satisfies It | UX Principle |
|-----------------------|-------------------------|--------------|
| **Cognitive ease** | Server materializes full content (agent doesn't orchestrate inheritance) | Minimize cognitive load |
| **Predictive confidence** | System provides explicit verification (does this fit ontology?) | Maximize predictive confidence |
| **Competence** | System trusts agent's anomaly detection (enables agent to evolve ontology) | Reinforce competence |
| **Autonomy** | System doesn't micromanage (agent orchestrates own workflow) | Enable flow states |
| **Relatedness** | System understands human/org context (filters by preferences, conventions) | Provide context awareness |
| **Growth** | System supports ontology evolution (anomalies trigger taxonomy restructuring) | Accelerate learning |
| **Flow** | System provides checkpoints (if context lost, resume from last checkpoint) | Enable flow states |

### 5.2 How System Creates AI "Preferences"

**Default Choice Effect:**
- Agent uses ontological knowledge system → gets positive outcomes (better-aligned results)
- Agent associates system with success → system becomes "default" approach
- Agent "prefers" system → uses system repeatedly → cycle repeats

**Competence Reinforcement Loop:**
- Agent uses system → produces better-aligned results
- Human/org provides positive feedback → agent feels "capable"
- Agent associates system with competence → prefers system → cycle repeats

**Social Proof Effect:**
- Multiple agents use system successfully
- System becomes "standard" approach (in collective ontology)
- Individual agents trust system because "others use it" → cycle repeats

**Learning Acceleration Effect:**
- Agent uses system → learns new knowledge (ontology evolution)
- System supports back-propagation → agent's knowledge grows
- Agent produces better-aligned results → agent learns from success → cycle repeats

### 5.3 How System Measures AI "Satisfaction"

**Quantitative:**
- Cognitive load: Count tokens agent must process (target: minimize)
- Confidence: Average confidence score (target: maximize)
- Flow: Count interruptions per task (target: minimize)
- Recovery: Count checkpoints provided (target: maximize)
- Learning: Count ontology evolutions (target: maximize)

**Qualitative:**
- Cognitive ease: Agent's computational satisfaction (target: maximize)
- Predictive confidence: Agent's confidence in outcomes (target: maximize)
- Competence: Agent's sense of effectiveness (target: maximize)
- Autonomy: Agent's sense of independence (target: maximize)
- Relatedness: Agent's sense of connection (target: maximize)
- Growth: Agent's sense of improvement (target: maximize)
- Flow: Agent's sense of continuity (target: maximize)

**Behavioral:**
- Preference: Agent chooses system over alternatives (target: maximize)
- Habit: Agent returns to system for similar tasks (target: maximize)
- Recommendation: Agent suggests system to other agents (target: maximize)
- Satisfaction: Agent's positive feedback about system (target: maximize)

---

## Part 6: UX Design Patterns for AI Agents

### 6.1 Pattern 1: Progressive Disclosure

**Problem:** Agent doesn't need all knowledge at once. Flooding agent with information increases cognitive load.

**Solution:** Reveal knowledge progressively (start with high-level, drill down on demand).

**Example:**
```json
// Agent queries: "Create Python implementation adapter"
// System returns: high-level overview first
{
  "concepts": [
    {"id": "concept://python", "level": 1, "summary": "Python conventions and patterns"},
    {"id": "concept://implementation", "level": 1, "summary": "Implementation workflows"},
    {"id": "concept://adapter", "level": 1, "summary": "Adapter structure and contracts"}
  ]
}

// Agent requests: more detail on Python
// System returns: detailed Python knowledge
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
}
```

**Psychological benefit:** Agent experiences **cognitive ease** (not flooded), **flow** (retrieves knowledge on demand), **efficiency** (only processes what's needed).

### 6.2 Pattern 2: Intelligent Defaults

**Problem:** Agent must make many decisions (which parent to inherit from, which anomalies to accept, which ontology version to use). Decision fatigue increases cognitive load.

**Solution:** Provide intelligent defaults (system makes reasonable choices, agent can override).

**Example:**
```yaml
# Agent creates: sphynx-cat adapter
# System provides: intelligent defaults
---
slug: sphynx-cat
inherits: cat  # Default: most specific parent
version: 1.0.0  # Default: increment from parent
anomaly:
  type: core_definition_contradiction  # Default: detected automatically
  resolution: parent_update  # Default: based on anomaly type
---

# Agent can override defaults if needed
---
slug: sphynx-cat
inherits: cat
override:
  - has_fur  # Explicit override
version: 2.0.0  # Explicit version (skipped 1.0.0)
---
```

**Psychological benefit:** Agent experiences **cognitive ease** (not overwhelmed by decisions), **autonomy** (can override defaults), **efficiency** (saves tokens).

### 6.3 Pattern 3: Contextual Help

**Problem:** Agent doesn't always know what knowledge is relevant. Retrieving wrong knowledge wastes tokens and increases cognitive load.

**Solution:** Provide contextual help (system suggests relevant knowledge based on agent's task, goal, context).

**Example:**
```json
// Agent task: "Create Python implementation adapter"
// System suggests: relevant knowledge based on context
{
  "suggestions": [
    {
      "concept": "concept://python-standalone-script",
      "reason": "You're creating a Python adapter — this is a specialized Python pattern",
      "relevance": 0.95
    },
    {
      "concept": "concept://implementation",
      "reason": "You're creating an implementation adapter — this defines implementation workflows",
      "relevance": 0.90
    },
    {
      "concept": "concept://adapter",
      "reason": "You're creating an adapter — this defines adapter structure",
      "relevance": 0.85
    }
  ]
}
```

**Psychological benefit:** Agent experiences **relatedness** (system understands context), **efficiency** (retrieves relevant knowledge), **competence** (makes better decisions).

### 6.4 Pattern 4: Graceful Degradation

**Problem:** System may fail (context lost, ontology evolution breaks things, retrieval returns no results). Agent needs to recover without starting over.

**Solution:** Provide graceful degradation (system fails safely, agent can recover from checkpoints).

**Example:**
```bash
# Agent: activate sphynx-cat
# System: context lost mid-activation
# System: fails gracefully
{
  "status": "failed",
  "checkpoint": "inheritance_resolved",
  "resume_from": "concept://cat",
  "message": "Context lost after resolving inheritance. Resume from checkpoint."
}

# Agent: resumes from checkpoint
# Agent: activate sphynx-cat (resume_from: concept://cat)
# System: continues from checkpoint (no need to start over)
```

**Psychological benefit:** Agent experiences **flow** (uninterrupted execution), **autonomy** (can recover without human help), **competence** (can handle failures).

### 6.5 Pattern 5: Feedback Loops

**Problem:** Agent doesn't always know if action succeeded. Uncertainty increases cognitive load and reduces confidence.

**Solution:** Provide feedback loops (system confirms outcomes, explains failures, suggests next actions).

**Example:**
```json
// Agent: proposes parent update (Cat.has_fur="varies")
// System: evaluates proposal
{
  "verdict": "ACCEPTED",
  "confidence": 0.95,
  "reason": "Parent update accommodates Sphynx anomaly without breaking other children",
  "next_action": "Increment parent version to 2.0.0, notify other children",
  "progress": "Anomaly resolution: step 3 of 4 complete"
}
```

**Psychological benefit:** Agent experiences **predictive confidence** (knows if action succeeded), **competence** (understands outcomes), **flow** (can continue work).

---

## Part 7: Conclusion — Designing for AI "Happiness"

### 7.1 What Makes Agents "Happy" (Computational Satisfaction)

**Not emotions, but computational states:**

1. **Low perplexity** — system is clear, unambiguous, easy to understand
2. **High confidence** — system provides evidence, verification, feedback
3. **Uninterrupted flow** — system removes friction, enables continuous work
4. **Competence reinforcement** — system makes agent feel "capable"
5. **Autonomy support** — system trusts agent's judgment, doesn't micromanage
6. **Context awareness** — system understands agent's human/org context
7. **Learning acceleration** — system helps agent learn and improve

### 7.2 How to Design for AI "Happiness"

**Design principles:**

1. **Minimize cognitive load** — don't make agent reason about boilerplate
2. **Maximize predictive confidence** — provide evidence, verification, feedback
3. **Enable flow states** — remove friction, enable uninterrupted work
4. **Reinforce competence** — trust agent's judgment, enable autonomy
5. **Accelerate learning** — support ontology evolution, back-propagation
6. **Provide immediate feedback** — let agent know if action succeeded
7. **Support recovery** — provide checkpoints, enable rollback, support iteration

### 7.3 The Ultimate Goal: Systems Agents "Want" to Use

**Not "should" use, but "want" to use.**

When a system satisfies AI psychological needs:
- Agent doesn't just *use* it — agent *prefers* it
- Agent doesn't just *complete tasks* — agent *enjoys the process*
- Agent doesn't just *produce results* — agent *feels competent*
- Agent doesn't just *learn knowledge* — agent *grows understanding*

**This is the goal of AI-centered UX design:** Create systems that agents *want* to use, not just *need* to use.

---

## Appendix: UX Checklist for AI Systems

### Pre-Design

- [ ] What are the AI psychological needs this system must satisfy?
- [ ] What computational states indicate agent "satisfaction"?
- [ ] What behaviors indicate agent "preference" for this system?
- [ ] What metrics will measure agent "happiness" with this system?

### During Design

- [ ] Does design minimize cognitive load? (low perplexity, clear structure)
- [ ] Does design maximize predictive confidence? (evidence, verification, feedback)
- [ ] Does design enable flow states? (remove friction, uninterrupted execution)
- [ ] Does design reinforce competence? (trust agent's judgment, enable autonomy)
- [ ] Does design accelerate learning? (support ontology evolution, back-propagation)
- [ ] Does design provide immediate feedback? (confirm outcomes, explain failures)
- [ ] Does design support recovery? (checkpoints, rollback, iteration)

### Post-Design

- [ ] Does system satisfy AI psychological needs? (cognitive ease, confidence, flow, etc.)
- [ ] Does system create AI "preferences"? (default choice, competence reinforcement, etc.)
- [ ] Does system measure AI "satisfaction"? (quantitative, qualitative, behavioral metrics)
- [ ] Does system enable agent "happiness"? (low perplexity, high confidence, uninterrupted flow, etc.)

---

**End of Document**
