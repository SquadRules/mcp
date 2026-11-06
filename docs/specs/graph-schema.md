# Graph Schema for SquadRules 6 Ontological Knowledge System

This document defines the graph database schema for SquadRules 6 ontological knowledge system. The graph database (LadybugDB embedded / ArangoDB shared) stores **relationships** between adapters, concepts, anomalies, and versions — enabling inheritance resolution, anomaly backpropagation, and ontological evolution.

**Companion databases:**

- **Vector DB** (LanceDB/Qdrant): adapter embeddings for semantic search

- **SQL DB** (SQLite/PostgreSQL): adapter metadata, user preferences, execution history, audit logs

**Design principles:**

- Mode-agnostic: same schema for embedded and shared deployments

- URI-based identifiers: stable, dereferenceable, scheme-namespaced

- Explicit relationships: inheritance, specialization, contradiction, instantiation

- Version-aware: track ontology evolution over time

---

## 1. Node Types

The graph stores five node types, each with a distinct URI scheme and purpose.

### 1.1 Concept Nodes

**Purpose:** Generic categories or abstract rules that adapters can inherit from or specialize.

**URI scheme:** `concept://<name>`

**Required properties:**

| Property | Type | Description |
|----------|------|-------------|
| `_key` | string | Unique identifier (derived from URI): `concept:<name>` |
| `_id` | string | ArangoDB document ID: `concepts/concept:<name>` |
| `type` | string | Node type discriminator: `"concept"` |
| `name` | string | Human-readable concept name |
| `definition` | string | Formal definition of the concept |
| `created_at` | string | ISO 8601 timestamp |
| `updated_at` | string | ISO 8601 timestamp |

**Optional properties:**

| Property | Type | Description |
|----------|------|-------------|
| `baseline_attributes` | object | Default attributes inherited by children |
| `tags` | array[string] | Categorization tags |
| `metadata` | object | Extensible metadata |

**Example:**

```json
{
  "_key": "concept:code-review",
  "_id": "concepts/concept:code-review",
  "type": "concept",
  "name": "code-review",
  "definition": "Systematic examination of code changes to detect defects, improve quality, and share knowledge",
  "created_at": "2026-01-15T10:30:00Z",
  "updated_at": "2026-01-15T10:30:00Z",
  "baseline_attributes": {
    "focus_areas": ["correctness", "readability", "maintainability"],
    "severity_threshold": "medium"
  },
  "tags": ["quality", "review", "collaboration"],
  "metadata": {
    "version": "1.0.0",
    "author": "team-lead"
  }
}

```

### 1.2 Adapter Nodes

**Purpose:** SquadRules adapters — executable workflows that can inherit from parent adapters or concepts.

**URI scheme:** `adapter://<slug>`

**Required properties:**

| Property | Type | Description |
|----------|------|-------------|
| `_key` | string | Unique identifier: `adapter:<slug>` |
| `_id` | string | ArangoDB document ID: `adapters/adapter:<slug>` |
| `type` | string | Node type discriminator: `"adapter"` |
| `slug` | string | Adapter slug (matches frontmatter `slug:`) |
| `version` | string | Semantic version (from frontmatter or store) |
| `title` | string | H1 title (byte-identical across updates) |
| `created_at` | string | ISO 8601 timestamp |
| `updated_at` | string | ISO 8601 timestamp |

**Optional properties:**

| Property | Type | Description |
|----------|------|-------------|
| `frontmatter` | object | Parsed frontmatter fields (inherits, chain_root, override, protocol_version) |
| `layer_count` | integer | Number of workflow layers |
| `contract_types` | array[string] | Contract types used: `["shell", "forward", "subagent"]` |
| `space` | string | Space ownership: `"personal"` or group path |
| `tags` | array[string] | Activation pattern tags |
| `metadata` | object | Extensible metadata |

**Example:**

```json
{
  "_key": "adapter:critic-loop",
  "_id": "adapters/adapter:critic-loop",
  "type": "adapter",
  "slug": "critic-loop",
  "version": "2.1.0",
  "title": "Critic Loop: Delegated Review Workflow",
  "created_at": "2026-01-10T08:00:00Z",
  "updated_at": "2026-03-15T14:22:00Z",
  "frontmatter": {
    "slug": "critic-loop",
    "version": "2.1.0",
    "protocol_version": "1.0.0"
  },
  "layer_count": 3,
  "contract_types": ["shell", "forward", "subagent"],
  "space": "personal",
  "tags": ["review", "quality-gate", "delegated-judgment"],
  "metadata": {
    "author": "jakub.plichcinski",
    "last_execution": "2026-11-05T16:45:00Z"
  }
}

```

### 1.3 Anomaly Nodes

**Purpose:** Contradictions, failures, or unexpected behaviors discovered during adapter execution. Anomalies drive ontological evolution by triggering parent concept refinement.

**URI scheme:** `anomaly://<uuid>`

**Required properties:**

| Property | Type | Description |
|----------|------|-------------|
| `_key` | string | Unique identifier: `anomaly:<uuid>` |
| `_id` | string | ArangoDB document ID: `anomalies/anomaly:<uuid>` |
| `type` | string | Node type discriminator: `"anomaly"` |
| `anomaly_type` | string | Classification: `"contradiction"`, `"failure"`, `"ambiguity"`, `"regression"` |
| `description` | string | Human-readable description of the anomaly |
| `severity` | string | `"critical"`, `"high"`, `"medium"`, `"low"` |
| `status` | string | Resolution state: `"open"`, `"investigating"`, `"resolved"`, `"wontfix"` |
| `discovered_at` | string | ISO 8601 timestamp |
| `discovered_by` | string | Adapter or agent that discovered the anomaly |

**Optional properties:**

| Property | Type | Description |
|----------|------|-------------|
| `context` | object | Execution context when anomaly was discovered |
| `evidence` | object | Proof data (stdout, stderr, exit_code, traces) |
| `resolution` | string | How the anomaly was resolved |
| `resolved_at` | string | ISO 8601 timestamp |
| `affected_adapters` | array[string] | Adapter slugs impacted by this anomaly |
| `metadata` | object | Extensible metadata |

**Example:**

```json
{
  "_key": "anomaly:f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "_id": "anomalies/anomaly:f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "type": "anomaly",
  "anomaly_type": "contradiction",
  "description": "Shell contract specifies interpreter 'python' but contract.cmd uses Python 3.11+ syntax",
  "severity": "high",
  "status": "resolved",
  "discovered_at": "2026-10-28T11:15:00Z",
  "discovered_by": "adapter:author-adapter",
  "context": {
    "execution_id": "exec-2026-10-28-001",
    "adapter_slug": "python-implementation",
    "layer_uuid": "layer-uuid-123",
    "contract_type": "shell"
  },
  "evidence": {
    "stdout": "SyntaxError: invalid syntax",
    "stderr": "python: can't open file",
    "exit_code": 1
  },
  "resolution": "Updated interpreter from 'python' to 'python3' in contract definition",
  "resolved_at": "2026-10-28T14:30:00Z",
  "affected_adapters": ["python-implementation"],
  "metadata": {
    "root_cause": "interpreter_mismatch",
    "fix_commit": "abc123"
  }
}

```

### 1.4 Instance Nodes (Optional)

**Purpose:** Specific instances of concepts. May be represented as properties instead of separate nodes depending on cardinality and query patterns.

**URI scheme:** `instance://<concept-slug>/<instance-id>`

**When to use:**

- Instance has its own relationships (e.g., instance to anomaly)

- Instance has versioned state

- Query patterns require traversing from instance to multiple targets

**When to use properties instead:**

- Instance is a simple value (e.g., `color: "red"`)

- Instance has no relationships

- Instance is immutable

**Required properties:**

| Property | Type | Description |
|----------|------|-------------|
| `_key` | string | Unique identifier: `instance:<concept-slug>:<instance-id>` |
| `_id` | string | ArangoDB document ID |
| `type` | string | Node type discriminator: `"instance"` |
| `concept` | string | Parent concept URI |
| `instance_id` | string | Instance identifier within concept scope |
| `created_at` | string | ISO 8601 timestamp |

**Optional properties:**

| Property | Type | Description |
|----------|------|-------------|
| `attributes` | object | Instance-specific attributes |
| `metadata` | object | Extensible metadata |

### 1.5 Version Nodes

**Purpose:** Track ontology evolution over time. Each version node represents a snapshot of a concept or adapter at a point in time.

**URI scheme:** `version://<entity-uri>@<version-number>`

**Required properties:**

| Property | Type | Description |
|----------|------|-------------|
| `_key` | string | Unique identifier: `version:<entity-key>@<version>` |
| `_id` | string | ArangoDB document ID |
| `type` | string | Node type discriminator: `"version"` |
| `entity_uri` | string | URI of the versioned entity (concept or adapter) |
| `version_number` | string | Semantic version or incremental version |
| `change_type` | string | `"created"`, `"updated"`, `"deprecated"`, `"deleted"` |
| `changed_at` | string | ISO 8601 timestamp |
| `changed_by` | string | Agent or user who made the change |

**Optional properties:**

| Property | Type | Description |
|----------|------|-------------|
| `changelog` | string | Human-readable description of changes |
| `trigger` | string | What triggered the version change |
| `trigger_uri` | string | URI of the triggering entity |
| `snapshot` | object | Full entity state at this version |
| `diff` | object | Changes from previous version |
| `metadata` | object | Extensible metadata |

---

## 2. Edge Types

Edges define relationships between nodes. Each edge type specifies source/target node types, directionality, and properties.

### 2.1 `inherits` Edge

**Purpose:** Child to parent inheritance relationship.

**Source:** `adapter` or `concept`
**Target:** `adapter` or `concept`
**Direction:** Directed (child to parent)

**Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `_from` | string | yes | Child node ID |
| `_to` | string | yes | Parent node ID |
| `relationship` | string | yes | `"inherits"` |
| `inherited_fields` | array[string] | no | Which fields are inherited (default: all) |
| `override_fields` | array[string] | no | Which fields the child overrides |
| `created_at` | string | yes | ISO 8601 timestamp |
| `metadata` | object | no | Extensible metadata |

### 2.2 `specialized_by` Edge

**Purpose:** Parent to children reverse relationship (inverse of `inherits`).

**Source:** `adapter` or `concept`
**Target:** `adapter` or `concept`
**Direction:** Directed (parent to child)

**Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `_from` | string | yes | Parent node ID |
| `_to` | string | yes | Child node ID |
| `relationship` | string | yes | `"specialized_by"` |
| `specialization_type` | string | no | `"override"`, `"extension"`, `"restriction"` |
| `created_at` | string | yes | ISO 8601 timestamp |
| `metadata` | object | no | Extensible metadata |

### 2.3 `contradicts` Edge

**Purpose:** Anomaly to parent rule relationship.

**Source:** `anomaly`
**Target:** `adapter` or `concept`
**Direction:** Directed (anomaly to parent)

**Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `_from` | string | yes | Anomaly node ID |
| `_to` | string | yes | Parent node ID |
| `relationship` | string | yes | `"contradicts"` |
| `contradiction_type` | string | yes | `"ambiguity"`, `"inconsistency"`, `"failure"`, `"regression"` |
| `severity` | string | yes | `"critical"`, `"high"`, `"medium"`, `"low"` |
| `discovered_at` | string | yes | ISO 8601 timestamp |
| `resolution_status` | string | yes | `"open"`, `"investigating"`, `"resolved"`, `"wontfix"` |
| `metadata` | object | no | Extensible metadata |

### 2.4 `instances` Edge

**Purpose:** Instance to category relationship.

**Source:** `instance`
**Target:** `concept`
**Direction:** Directed (instance to concept)

### 2.5 `version_of` Edge

**Purpose:** Version to entity relationship.

**Source:** `version`
**Target:** `adapter` or `concept`
**Direction:** Directed (version to entity)

### 2.6 `discovered_by` Edge

**Purpose:** Anomaly to adapter/agent provenance relationship.

**Source:** `anomaly`
**Target:** `adapter`
**Direction:** Directed (anomaly to discoverer)

### 2.7 `routes_to` Edge

**Purpose:** Chain routing relationship (orthogonal to inheritance).

**Source:** `adapter`
**Target:** `adapter`
**Direction:** Directed (child to chain_root)

---

## 3. Property Schema

### 3.1 Adapter Properties

**Core properties:**

| Property | Type | Required | Source | Description |
|----------|------|----------|--------|-------------|
| `slug` | string | yes | frontmatter `slug:` | Adapter slug (URI-safe) |
| `version` | string | yes | frontmatter `version:` or store | Semantic version |
| `title` | string | yes | H1 heading | Adapter title |
| `protocol_version` | string | no | frontmatter | Protocol version (semver) |
| `layer_count` | integer | no | computed | Number of workflow layers |
| `contract_types` | array[string] | no | computed | Contract types used |
| `space` | string | no | store | Space ownership |
| `tags` | array[string] | no | Activation Patterns | Tags for activation matching |

**Inheritance properties (from frontmatter):**

| Property | Type | Required | Source | Description |
|----------|------|----------|--------|-------------|
| `inherits` | string | no | frontmatter `inherits:` | Parent adapter slug |
| `chain_root` | string | no | frontmatter `chain_root:` | Chain root adapter slug |
| `override` | array[string] | no | frontmatter `override:` | Fields overridden from parent |

### 3.2 Concept Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | yes | Human-readable concept name |
| `definition` | string | yes | Formal definition |
| `baseline_attributes` | object | no | Default attributes inherited by children |
| `tags` | array[string] | no | Categorization tags |

### 3.3 Anomaly Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `anomaly_type` | string | yes | Classification |
| `description` | string | yes | Human-readable description |
| `severity` | string | yes | Severity level |
| `status` | string | yes | Resolution state |
| `discovered_at` | string | yes | Discovery timestamp |
| `discovered_by` | string | yes | Discoverer adapter/agent |
| `context` | object | no | Execution context |
| `evidence` | object | no | Proof data |
| `resolution` | string | no | Resolution description |
| `resolved_at` | string | no | Resolution timestamp |
| `affected_adapters` | array[string] | no | Impacted adapters |

### 3.4 Version Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `entity_uri` | string | yes | URI of the versioned entity |
| `version_number` | string | yes | Semantic version |
| `change_type` | string | yes | Type of change |
| `changed_at` | string | yes | Change timestamp |
| `changed_by` | string | yes | Agent or user |
| `changelog` | string | no | Description of changes |
| `trigger` | string | no | What triggered the change |
| `trigger_uri` | string | no | URI of triggering entity |
| `snapshot` | object | no | Full entity state |
| `diff` | object | no | Changes from previous version |

### 3.5 Edge Properties

**Common edge properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `_from` | string | yes | Source node ID |
| `_to` | string | yes | Target node ID |
| `relationship` | string | yes | Edge type discriminator |
| `created_at` | string | yes | ISO 8601 creation timestamp |
| `metadata` | object | no | Arbitrary key-value pairs |

---

## 4. Data Format Examples

### 4.1 Parent Adapter Node

```json
{
  "_key": "adapter:critic-loop",
  "_id": "adapters/adapter:critic-loop",
  "type": "adapter",
  "slug": "critic-loop",
  "version": "2.1.0",
  "title": "Critic Loop: Delegated Review Workflow",
  "created_at": "2026-01-10T08:00:00Z",
  "updated_at": "2026-03-15T14:22:00Z",
  "frontmatter": {
    "slug": "critic-loop",
    "version": "2.1.0",
    "protocol_version": "1.0.0"
  },
  "layer_count": 3,
  "contract_types": ["shell", "forward", "subagent"],
  "space": "personal",
  "tags": ["review", "quality-gate", "delegated-judgment"]
}

```

### 4.2 Child Adapter Node (with `inherits: critic-loop`)

```json
{
  "_key": "adapter:specialized-reviewer",
  "_id": "adapters/adapter:specialized-reviewer",
  "type": "adapter",
  "slug": "specialized-reviewer",
  "version": "1.0.0",
  "title": "Specialized Reviewer: Domain-Specific Code Review",
  "created_at": "2026-04-10T09:00:00Z",
  "updated_at": "2026-04-10T09:00:00Z",
  "frontmatter": {
    "slug": "specialized-reviewer",
    "version": "1.0.0",
    "inherits": "critic-loop",
    "override": ["tags", "metadata"]
  },
  "layer_count": 3,
  "contract_types": ["shell", "forward", "subagent"],
  "space": "personal",
  "tags": ["review", "domain-specific", "code-quality"]
}

```

### 4.3 Inheritance Edge (child to parent)

```json
{
  "_key": "inherits:adapter:specialized-reviewer:adapter:critic-loop",
  "_from": "adapters/adapter:specialized-reviewer",
  "_to": "adapters/adapter:critic-loop",
  "relationship": "inherits",
  "inherited_fields": ["contract_types", "layer_count"],
  "override_fields": ["tags", "metadata"],
  "created_at": "2026-04-10T09:15:00Z",
  "metadata": {
    "inheritance_depth": 1,
    "resolution_strategy": "child-wins"
  }
}

```

### 4.4 Anomaly Node

```json
{
  "_key": "anomaly:f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "_id": "anomalies/anomaly:f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "type": "anomaly",
  "anomaly_type": "contradiction",
  "description": "Shell contract specifies interpreter 'python' but contract.cmd uses Python 3.11+ syntax",
  "severity": "high",
  "status": "resolved",
  "discovered_at": "2026-10-28T11:15:00Z",
  "discovered_by": "adapter:author-adapter",
  "context": {
    "execution_id": "exec-2026-10-28-001",
    "adapter_slug": "python-implementation",
    "contract_type": "shell"
  },
  "evidence": {
    "stdout": "SyntaxError: invalid syntax",
    "exit_code": 1
  },
  "resolution": "Updated interpreter from 'python' to 'python3'",
  "resolved_at": "2026-10-28T14:30:00Z",
  "affected_adapters": ["python-implementation"]
}

```

### 4.5 Contradiction Edge (anomaly to parent rule)

```json
{
  "_key": "contradicts:anomaly:f47ac10b:adapter:python-implementation",
  "_from": "anomalies/anomaly:f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "_to": "adapters/adapter:python-implementation",
  "relationship": "contradicts",
  "contradiction_type": "inconsistency",
  "severity": "high",
  "discovered_at": "2026-10-28T11:15:00Z",
  "resolution_status": "resolved"
}

```

### 4.6 Version Node

```json
{
  "_key": "version:adapter:critic-loop@2.1.0",
  "_id": "versions/version:adapter:critic-loop@2.1.0",
  "type": "version",
  "entity_uri": "adapter://critic-loop",
  "version_number": "2.1.0",
  "change_type": "updated",
  "changed_at": "2026-03-15T14:22:00Z",
  "changed_by": "adapter:author-adapter",
  "changelog": "Added subagent critic hop for verification isolation",
  "trigger": "anomaly",
  "trigger_uri": "anomaly://e5d6c7f8-a9b0-11ec-b909-0242ac120002",
  "snapshot": {
    "slug": "critic-loop",
    "version": "2.1.0",
    "layer_count": 3,
    "contract_types": ["shell", "forward", "subagent"]
  },
  "diff": {
    "added": {"contract_types": ["subagent"]},
    "removed": {},
    "modified": {"layer_count": {"from": 2, "to": 3}}
  }
}

```

---

## 5. Integration with Adapter Frontmatter

### 5.1 `inherits: <parent-slug>`

**Frontmatter:**

```yaml
---
slug: specialized-reviewer
version: 1.0.0
inherits: critic-loop
---

```

**Graph representation:**

1. Child adapter node with `frontmatter.inherits: "critic-loop"`

2. Parent adapter node

3. `inherits` edge (child to parent)

4. `specialized_by` edge (parent to child)

### 5.2 `chain_root: <slug>`

**Frontmatter:**

```yaml
---
slug: implement-terraform
version: 1.0.0
chain_root: review-terraform
---

```

`chain_root` is **orthogonal to inheritance**. It indicates routing relationships in a multi-adapter chain, not property inheritance.

**Graph representation:**

1. Child adapter node with `frontmatter.chain_root: "review-terraform"`

2. Chain root adapter node

3. `routes_to` edge with `routing_type: "chain_root"`

### 5.3 `override: [<field1>, <field2>]`

**Frontmatter:**

```yaml
---
slug: specialized-reviewer
version: 1.0.0
inherits: critic-loop
override: [tags, metadata]
---

```

The `override` field marks which parent properties the child explicitly overrides. Stored as edge property on the `inherits` edge.

**Selective override resolution:**

1. Start with parent properties

2. Apply child properties for fields in `override_fields`

3. Merge other fields from parent

### 5.4 Inheritance Resolution Algorithm

```

function resolveInheritance(childSlug):
  child = getAdapterNode(childSlug)
  resolved = copy(child.properties)
  
  if child.frontmatter.inherits:
    parent = getAdapterNode(child.frontmatter.inherits)
    inheritanceEdge = getEdge(child, parent, "inherits")
    
    overrideFields = inheritanceEdge.override_fields || []
    inheritedFields = inheritanceEdge.inherited_fields || allFields
    
    for field in inheritedFields:
      if field not in overrideFields:
        resolved[field] = parent.properties[field]
  
  return resolved

```

**Complexity:** O(depth) where depth is the inheritance chain length.

---

## 6. Query Patterns

### 6.1 Path-to-Root: Find All Ancestors

**Use case:** Inheritance resolution.

**AQL:**

```aql
FOR vertex, edge, path IN 1..10 OUTBOUND
  'adapters/adapter:specialized-reviewer'
  GRAPH 'ontology'
  FILTER edge.relationship == 'inherits'
  RETURN {
    ancestor: vertex,
    edge: edge,
    depth: LENGTH(path.vertices) - 1
  }

```

### 6.2 Anomaly Backpropagation: Find Affected Parent Concepts

**Use case:** Given an anomaly, find all parent concepts or adapters that may need refinement.

**AQL:**

```aql
FOR vertex, edge, path IN 1..5 OUTBOUND
  'anomalies/anomaly:f47ac10b-58cc-4372-a567-0e02b2c3d479'
  GRAPH 'ontology'
  FILTER edge.relationship == 'contradicts'
  RETURN {
    affected_parent: vertex,
    contradiction_edge: edge,
    path_length: LENGTH(path.edges)
  }

```

### 6.3 Consensus Detection: Find All Children Reporting Same Anomaly

**Use case:** If multiple children report the same anomaly type, it may indicate a systemic issue.

**AQL:**

```aql
LET parent = 'adapters/adapter:critic-loop'

FOR child, edge IN 1..3 INBOUND parent
  GRAPH 'ontology'
  FILTER edge.relationship == 'specialized_by'
  
  LET anomalies = (
    FOR anomaly, contradictsEdge IN 1 OUTBOUND child
    GRAPH 'ontology'
    FILTER contradictsEdge.relationship == 'contradicts'
    RETURN { anomaly: anomaly, edge: contradictsEdge }
  )
  
  FILTER LENGTH(anomalies) > 0
  RETURN {
    child: child,
    anomaly_count: LENGTH(anomalies),
    anomalies: anomalies
  }

```

### 6.4 Version History: Trace All Versions and Changes

**AQL:**

```aql
FOR version, edge IN 1..100 INBOUND
  'adapters/adapter:critic-loop'
  GRAPH 'ontology'
  FILTER edge.relationship == 'version_of'
  SORT edge.changed_at DESC
  RETURN { version: version, edge: edge }

```

### 6.5 Inheritance Depth Calculation

**AQL:**

```aql
FOR vertex, edge, path IN 1..10 OUTBOUND
  'adapters/adapter:specialized-reviewer'
  GRAPH 'ontology'
  FILTER edge.relationship == 'inherits'
  COLLECT AGGREGATE maxDepth = MAX(LENGTH(path.vertices) - 1)
  RETURN { inheritance_depth: maxDepth }

```

### 6.6 Orphan Detection: Find Adapters with No Parent

**AQL:**

```aql
FOR adapter IN adapters
  FILTER adapter.type == 'adapter'
  LET parents = (
    FOR parent, edge IN 1 OUTBOUND adapter
    GRAPH 'ontology'
    FILTER edge.relationship == 'inherits'
    LIMIT 1
    RETURN parent
  )
  FILTER LENGTH(parents) == 0
  RETURN { adapter: adapter, suggestion: "consider_extracting_concept" }

```

---

## 7. Data Partitioning

### 7.1 Graph DB (LadybugDB embedded / ArangoDB shared)

**Stores:** Ontological relationships, inheritance trees, anomalies, version history.

**Collections:**

| Collection | Node/Edge Type | Purpose |
|------------|----------------|---------|
| `concepts` | Concept nodes | Abstract categories and rules |
| `adapters` | Adapter nodes | SquadRules adapters |
| `anomalies` | Anomaly nodes | Contradictions and failures |
| `instances` | Instance nodes | Specific instances (optional) |
| `versions` | Version nodes | Ontology evolution tracking |
| `inherits` | Edge | Child to parent inheritance |
| `specialized_by` | Edge | Parent to child specialization |
| `contradicts` | Edge | Anomaly to parent contradiction |
| `instances` | Edge | Instance to category |
| `version_of` | Edge | Version to entity |
| `discovered_by` | Edge | Anomaly to discoverer |
| `routes_to` | Edge | Chain routing |

**Indexes:**

- `adapters`: unique on `slug`

- `concepts`: unique on `name`

- `anomalies`: on `status`, `severity`

- `versions`: on `entity_uri`, `changed_at`

- Edge collections: on `_from`, `_to`, `relationship`

### 7.2 Vector DB (LanceDB / Qdrant)

**Stores:** Adapter embeddings for semantic search.

**Schema:**

```json
{
  "id": "string",
  "adapter_uri": "string",
  "slug": "string",
  "embedding": "vector[1536]",
  "metadata": {
    "version": "string",
    "tags": "array[string]",
    "space": "string"
  }
}

```

### 7.3 SQL DB (SQLite / PostgreSQL)

**Stores:** Adapter metadata, user preferences, execution history, audit logs.

**Schema:**

```sql
CREATE TABLE adapter_metadata (
  slug TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  space TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  metadata JSONB
);

CREATE TABLE execution_history (
  execution_id TEXT PRIMARY KEY,
  adapter_slug TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  outcome TEXT,
  evidence JSONB,
  metadata JSONB
);

CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details JSONB
);

```

### 7.4 Cross-Database Relationships

**Pattern:** Use URIs as foreign keys across databases.

**Resolution:**

1. Start with URI: `adapter://critic-loop`

2. Extract slug: `critic-loop`

3. Query SQL DB: `SELECT * FROM adapter_metadata WHERE slug = 'critic-loop'`

4. Query Vector DB: `SELECT * FROM adapter_embeddings WHERE adapter_uri = 'adapter://critic-loop'`

5. Query Graph DB: `FOR adapter IN adapters FILTER adapter._key == 'adapter:critic-loop' RETURN adapter`

---

## 8. Schema Evolution

### 8.1 Adding New Node Types

1. Define the node type (URI scheme, properties, example JSON)

2. Create the collection

3. Add indexes

4. Update the graph definition

5. Document the change

### 8.2 Adding New Edge Types

1. Define the edge type (source, target, directionality, properties)

2. Create the edge collection

3. Add indexes

4. Update the graph definition

5. Document the change

### 8.3 Migrating Existing Data

**Best practices:**

- Test migrations on a copy first

- Log all changes for audit trail

- Make migrations idempotent

- Version the migration scripts

### 8.4 Versioning the Schema Itself

Store schema version in a special node:

```json
{
  "_key": "schema:ontology",
  "type": "schema",
  "version": "1.0.0",
  "updated_at": "2026-11-06T00:00:00Z",
  "changelog": [
    {
      "version": "1.0.0",
      "date": "2026-11-06T00:00:00Z",
      "changes": ["Initial schema definition"]
    }
  ]
}

```

### 8.5 Backward Compatibility

**Principles:**

- Additive changes are safe

- Breaking changes require migration

- Version the schema

- Document changes

---

## 9. Implementation Notes

### 9.1 ArangoDB-Specific Considerations

**Graph creation:**

```javascript
db._createGraph("ontology", [
  { collection: "inherits", from: ["adapters", "concepts"], to: ["adapters", "concepts"] },
  { collection: "specialized_by", from: ["adapters", "concepts"], to: ["adapters", "concepts"] },
  { collection: "contradicts", from: ["anomalies"], to: ["adapters", "concepts"] },
  { collection: "version_of", from: ["versions"], to: ["adapters", "concepts"] },
  { collection: "discovered_by", from: ["anomalies"], to: ["adapters"] },
  { collection: "routes_to", from: ["adapters"], to: ["adapters"] }
]);

```

### 9.2 LadybugDB Embedded Considerations

Mode-agnostic: same schema for both embedded and shared modes.

### 9.3 Testing

**Test scenarios:**

- Deep inheritance chain (3+ levels)

- Multiple children reporting the same anomaly

- Adapter with no parent (orphan)

- Version history with multiple change types

---

## 10. Summary

This document defines the complete graph schema for SquadRules 6 ontological knowledge system.

**Node types:** Concept, Adapter, Anomaly, Instance (optional), Version

**Edge types:** inherits, specialized_by, contradicts, instances, version_of, discovered_by, routes_to

**Key features:**

- URI-based identifiers

- Mode-agnostic schema

- Adapter inheritance via frontmatter

- Anomaly-driven ontology evolution

- Version tracking

- Cross-database relationships

**Query patterns:** Path-to-root, anomaly backpropagation, consensus detection, version history

**Data partitioning:**

- Graph DB: ontological relationships

- Vector DB: embeddings for semantic search

- SQL DB: metadata, preferences, execution history, audit logs
