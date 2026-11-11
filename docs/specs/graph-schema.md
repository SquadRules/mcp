# Graph Schema for SquadRules 6 Ontological Knowledge System

This document defines the graph database schema for SquadRules 6 ontological knowledge system. The graph database (LadybugDB embedded / ArangoDB shared) stores **relationships** between adapters, concepts, anomalies, and versions — enabling inheritance resolution, anomaly backpropagation, and ontological evolution.

**Companion databases:**

- **Vector DB** (LanceDB/Qdrant): adapter embeddings for semantic search

- **SQL DB** (SQLite/PostgreSQL): adapter metadata, user preferences, execution history, audit logs

**Design principles:**

- Mode-agnostic: same logical schema for embedded and shared deployments

- URI-based identifiers: stable, dereferenceable, scheme-namespaced

- Explicit relationships: inheritance, specialization, contradiction, instantiation

- Version-aware: track ontology evolution over time

**Physical key mapping (mode-agnostic note):**

The property tables below define **canonical logical names**. Each graph backend maps these to its own physical storage keys:

| Logical property | LadybugDB (embedded) | ArangoDB (shared) |
|------------------|----------------------|-------------------|
| `key` | `key` (STRING PRIMARY KEY) | `_key` |
| *(node identity)* | implicit via `key` | `_id` = `<collection>/<_key>` |
| `from` / `to` (edges) | implicit in graph pattern syntax | `_from` / `_to` (document IDs) |

Application code and this spec always use the canonical logical names (`key`, `from`, `to`). Backend-specific physical names (`_key`, `_id`, `_from`, `_to`) are an ArangoDB storage detail and MUST NOT appear in the logical schema.

---

## 1. Node Types

The graph stores seven node tables, each with a distinct URI scheme and purpose. Five
are described below; `Proposal` and `Confirmation` are the evidence-gated evolution
records whose fields and lifecycle are decided in
[ADR 0046](../adr/0046-evidence-gated-evolution-proposals.md) and whose physical
tables are listed in §7.1, so they are not restated here.

**Delivered vs deferred — read this before the tables below.**

- **Delivered:** adapter-to-adapter inheritance (`Inherits`/`SpecializedBy` between
  `Adapter` nodes), anomaly recording, version history, scope-qualified keys, and the
  evolution records.
- **Deferred, and not a release requirement:** general Concept→Concept and
  Concept→Adapter inheritance, instance CRUD, and `RoutesTo` writers. Their tables
  exist so a future feature needs no migration; no acceptance criterion depends on
  them. A gap here is scope, not an expected-but-missing item.

### 1.1 Concept Nodes

**Purpose:** Generic categories or abstract rules that adapters can relate to.

**Status:** the node is writable through the port (`upsertConcept`/`getConcept`) and is
read by activate-time ontology context; no runtime caller writes one yet, and
concept-side inheritance is **deferred** (§1).

**URI scheme:** `concept://<name>`

**Required properties:**

| Property | Type | Description |
|----------|------|-------------|
| `key` | string | Unique identifier (derived from URI): `concept:<name>` |
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
  "key": "concept:code-review",
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

**Purpose:** SquadRules adapters — executable workflows that can inherit from a parent **adapter**. A concept parent is **deferred** (§1): only `Inherits` (Adapter→Adapter) is written.

**URI scheme:** `adapter://<slug>`

**Required properties:**

| Property | Type | Description |
|----------|------|-------------|
| `key` | string | Unique identifier: `adapter:<spaceId>:<slug>` — scope-qualified, because one slug can exist in several spaces |
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

**Key form.** The logical URI is `adapter://<slug>`; the node key adds the scope:
`adapter:<spaceId>:<slug>` (`src/services/graph-db/adapter-scope.ts`, decision recorded in
[ADR 0042](../adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md)). The scope comes from
the store's tenant context on write and the record's `space_id` on read — never from a
guess — and `metadata` records `scope_space_id` / `scope_source` so it stays auditable. The
examples and queries below still spell the shortened logical form `adapter:<slug>`; read
them with the scope taken from each node's `space`.

**Example:**

```json
{
  "key": "adapter:critic-loop",
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

**Write invariant:** Anomaly creation is **proposal-only** — it never rewrites, upserts, or otherwise mutates any Adapter node. The anomaly → parent-update path is owned by [ADR 0046](../adr/0046-evidence-gated-evolution-proposals.md): settling a proposal returns an apply plan and writes no adapter, and the change reaches the parent only through a normal `train`/`tune`.

**Required properties:**

| Property | Type | Description |
|----------|------|-------------|
| `key` | string | Unique identifier: `anomaly:<uuid>` |
| `type` | string | Node type discriminator: `"Anomaly"` (capitalized) |
| `discovered_by` | string | Adapter slug or agent identity that discovered the anomaly |
| `routes_to` | string | Triage routing target: parent adapter slug when inheritance is involved, otherwise the failing adapter slug itself |
| `description` | string | Human-readable failure summary |
| `created_at` | string | ISO 8601 timestamp |

**Optional properties (populated with defaults by the write path):**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `severity` | string | `"medium"` | `"critical"`, `"high"`, `"medium"`, `"low"` |
| `anomaly_type` | string | `"failure"` | Classification: `"contradiction"`, `"failure"`, `"ambiguity"`, `"regression"` |
| `status` | string | `"open"` | Resolution state: `"open"`, `"investigating"`, `"resolved"`, `"wontfix"` |
| `metadata` | object | `{}` | Extensible metadata |

**Not part of the delivered node.** The `Anomaly` table has no `context`, `evidence`,
`resolution`, `resolved_at` or `affected_adapters` column
(`src/services/graph-db/ladybug/ladybug-schema.ts`), and `AnomalyNode` carries none of
them (`src/services/graph-db/graph-types.ts`). They were an earlier design sketch;
recording them is not a release requirement.

One field outside those columns **is** recorded: `source_child` (the scoped key of the
reporting child) is stored inside the `metadata` JSON by
`createAnomaly` in `src/services/graph-db/ladybug/ladybug-anomaly-store.ts`, and the
same key is read back out of `metadata`.

**Example:**

```json
{
  "key": "anomaly:f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "type": "Anomaly",
  "discovered_by": "author-adapter",
  "routes_to": "critic-loop",
  "description": "Reward recorded failure for squadrules://layer/abc123: gate did not pass (exit_code 1)",
  "created_at": "2026-10-28T11:15:00Z",
  "severity": "high",
  "anomaly_type": "failure",
  "status": "open",
  "metadata": {}
}
```

### 1.4 Instance Nodes (deferred)

**Purpose:** Specific instances of concepts.

**Deferred.** The `Instance` table exists so a future feature needs no migration, but
nothing writes it: the `GraphRepository` port has no instance method, and `InstanceNode`
in `src/services/graph-db/graph-types.ts` is a type only. Instance CRUD and
instance→concept edges are not a release requirement. The shape below is the table that
is created today.

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
| `key` | string | Unique identifier: `instance:<concept-slug>:<instance-id>` |
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

**Purpose:** Track ontology evolution over time. Each version node is an immutable
snapshot of **an adapter** at a point in time; `VersionOf` links it to that `Adapter`
node. The decision to snapshot on every successful train/tune is
[ADR 0045](../adr/0045-graph-native-history-and-restore.md).

**Delivered properties** (the `Version` table in
`src/services/graph-db/ladybug/ladybug-schema.ts`, and `VersionNode` in
`src/services/graph-db/graph-types.ts`):

| Property | Type | Description |
|----------|------|-------------|
| `key` | string | Unique identifier of the snapshot |
| `type` | string | Node type discriminator: `"version"` |
| `entity_key` | string | Scoped adapter key the snapshot belongs to |
| `entity_uri` | string | Logical entity URI, `adapter://<slug>` |
| `version_number` | string | Monotonic per-entity sequence, string-encoded |
| `version_seq` | integer | The same monotonic sequence as a number |
| `adapter_version` | string | Semantic adapter version at snapshot time |
| `change_type` | string | `"created"`, `"updated"`, `"restored"`, `"deprecated"`, `"deleted"` |
| `changed_at` | string | ISO 8601 timestamp |
| `changed_by` | string | Actor that produced the snapshot |
| `actor_source` | string | Where that identity came from |
| `space` | string | Space the snapshot belongs to |
| `parent_version` | string / null | Previous monotonic number, or `null` for the first |
| `reason` | string | Why the snapshot was appended |
| `content_digest` | string | SHA-256 of the exact `content` bytes |
| `content` | string | Full stored markdown, byte-exact |
| `metadata_snapshot` | object | Metadata observed at snapshot time |
| `metadata` | object | Extensible metadata |

The earlier sketch fields `changelog`, `trigger`, `trigger_uri`, `snapshot` and `diff`
are **not** columns and are not written. `reason` and `metadata_snapshot` carry what
`trigger`/`snapshot` were meant to; `content_digest` over byte-exact `content` is what
makes restore possible.

---

## 2. Edge Types

Edges define relationships between nodes. Each edge type specifies source/target node types, directionality, and properties.

### 2.1 `inherits` Edge

**Purpose:** Child to parent inheritance relationship.

**Source:** `adapter`
**Target:** `adapter`
**Direction:** Directed (child to parent)

The rel table is declared `FROM Adapter TO Adapter`
(`src/services/graph-db/ladybug/ladybug-schema.ts`), so inheritance is
adapter-to-adapter. Concept→Concept and Concept→Adapter inheritance is **deferred**
(§1), not missing.

**Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `from` | string | yes | Child node key |
| `to` | string | yes | Parent node key |
| `relationship` | string | yes | `"inherits"` |
| `inherited_fields` | array[string] | no | Always written as `[]` (`createInheritanceEdge`); resolution does not read it |
| `override_fields` | array[string] | no | Audit copy of the child's `override:` list; the merge reads each level's `override:` itself |
| `created_at` | string | yes | ISO 8601 timestamp |
| `metadata` | object | no | Extensible metadata |

### 2.2 `specialized_by` Edge

**Purpose:** Parent to children reverse relationship (inverse of `inherits`).

**Source:** `adapter`
**Target:** `adapter`
**Direction:** Directed (parent to child)

Written together with `inherits` by the same projection; the shared backend writes both
in one transaction. Children are read through this edge by `getChildren`
(`src/services/graph-db/ladybug/ladybug-adapter-reads.ts`).

**Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `from` | string | yes | Parent node key |
| `to` | string | yes | Child node key |
| `relationship` | string | yes | `"specialized_by"` |
| `specialization_type` | string | no | Written as `"override"` on every inverse edge; the other values are not produced |
| `created_at` | string | yes | ISO 8601 timestamp |
| `metadata` | object | no | Extensible metadata |

### 2.3 `contradicts` Edge

**Purpose:** Anomaly to parent rule relationship.

**Source:** `anomaly`
**Target:** `adapter`
**Direction:** Directed (anomaly to parent)

Declared `FROM Anomaly TO Adapter`. **Backend difference, stated plainly:** the shared
writer creates this edge together with the anomaly node when the anomaly carries a
scope (`createAnomaly` in `src/services/graph-db/arango/arango-anomaly-store.ts`); the
embedded writer records the node only (`createAnomaly` in
`src/services/graph-db/ladybug/ladybug-anomaly-store.ts`). Reads go through the
`Anomaly` table (`listAnomalies`), so a node-only record stays readable either way.

**Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `from` | string | yes | Anomaly node key |
| `to` | string | yes | Parent node key |
| `relationship` | string | yes | `"contradicts"` |
| `contradiction_type` | string | yes | `"ambiguity"`, `"inconsistency"`, `"failure"`, `"regression"` |
| `severity` | string | yes | `"critical"`, `"high"`, `"medium"`, `"low"` |
| `discovered_at` | string | yes | ISO 8601 timestamp |
| `resolution_status` | string | yes | `"open"`, `"investigating"`, `"resolved"`, `"wontfix"` |
| `metadata` | object | no | Extensible metadata |

### 2.4 `instances` Edge (`ConceptInstances`, deferred)

**Purpose:** Instance to category relationship.

**Source:** `instance`
**Target:** `concept`
**Direction:** Directed (instance to concept)

The rel table exists as `ConceptInstances` (`FROM Instance TO Concept`,
`src/services/graph-db/ladybug/ladybug-schema.ts`). **Nothing writes it** — instance
CRUD is deferred (§1.4) and not a release requirement.

### 2.5 `version_of` Edge

**Purpose:** Version to entity relationship.

**Source:** `version`
**Target:** `adapter`
**Direction:** Directed (version to entity)

Every appended snapshot is linked to its `Adapter` node —
`appendVersion` in `src/services/graph-db/ladybug/ladybug-history-store.ts` and
`src/services/graph-db/arango/arango-history-store.ts`.

### 2.6 `discovered_by` Edge

**Purpose:** Anomaly to adapter/agent provenance relationship.

**Source:** `anomaly`
**Target:** `adapter`
**Direction:** Directed (anomaly to discoverer)

Same backend split as §2.3: created by the shared writer, not by the embedded one.

### 2.7 `routes_to` Edge (deferred)

**Purpose:** Chain routing relationship (orthogonal to inheritance).

**Source:** `adapter`
**Target:** `adapter`
**Direction:** Directed (child to chain_root)

The rel table exists; **nothing writes it** yet. `chain_root:` frontmatter is parsed and
stored on the adapter node's `frontmatter`, but no routing edge is projected from it.
This is deferred, not a partially built feature.

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
| `baseline_attributes` | object | no | Default attributes a future concept-aware merge would apply |
| `tags` | array[string] | no | Categorization tags |

`baseline_attributes` is stored but **not** consumed: the delivered merge
(`mergeResolvedProperties`) walks `Adapter` ancestors only (§5.4).

### 3.3 Anomaly Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `discovered_by` | string | yes | Discoverer adapter/agent slug |
| `routes_to` | string | yes | Triage routing target (parent or self) |
| `description` | string | yes | Human-readable failure summary |
| `created_at` | string | yes | Discovery timestamp (ISO 8601) |
| `severity` | string | no | Severity level (default: `"medium"`) |
| `anomaly_type` | string | no | Classification (default: `"failure"`) |
| `status` | string | no | Resolution state (default: `"open"`) |
| `metadata` | object | no | Extensible metadata; `source_child` and the scope provenance live here |

The `context`, `evidence`, `resolution`, `resolved_at` and `affected_adapters` fields
from the earlier sketch are not columns and are not written (§1.3).

### 3.4 Version Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `entity_key` | string | yes | Scoped adapter key the snapshot belongs to |
| `entity_uri` | string | yes | Logical entity URI, `adapter://<slug>` |
| `version_number` | string | yes | Monotonic per-entity sequence |
| `version_seq` | integer | yes | The same sequence as a number |
| `adapter_version` | string | yes | Semantic adapter version at snapshot time |
| `change_type` | string | yes | Type of change |
| `changed_at` | string | yes | Change timestamp |
| `changed_by` | string | yes | Actor that produced the snapshot |
| `actor_source` | string | yes | Where that identity came from |
| `space` | string | yes | Space the snapshot belongs to |
| `parent_version` | string / null | no | Previous monotonic number |
| `reason` | string | yes | Why the snapshot was appended |
| `content_digest` | string | yes | SHA-256 of the exact `content` bytes |
| `content` | string | yes | Full stored markdown, byte-exact |
| `metadata_snapshot` | object | no | Metadata observed at snapshot time |
| `metadata` | object | no | Extensible metadata |

The `changelog`, `trigger`, `trigger_uri`, `snapshot` and `diff` fields from the earlier
sketch are not columns (§1.5).

### 3.5 Edge Properties

**Common edge properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `from` | string | yes | Source node key |
| `to` | string | yes | Target node key |
| `relationship` | string | yes | Edge type discriminator |
| `created_at` | string | yes | ISO 8601 creation timestamp |
| `metadata` | object | no | Arbitrary key-value pairs |

---

## 4. Data Format Examples

### 4.1 Parent Adapter Node

```json
{
  "key": "adapter:critic-loop",
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
  "key": "adapter:specialized-reviewer",
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
  "from": "adapter:personal:specialized-reviewer",
  "to": "adapter:personal:critic-loop",
  "relationship": "inherits",
  "inherited_fields": [],
  "override_fields": ["tags", "metadata"],
  "created_at": "2026-04-10T09:15:00Z",
  "metadata": { "parent_scope_id": "personal" }
}
```

`inherited_fields` is empty because nothing computes it — the merge resolves each field
at read time (§5.4) — and `metadata` carries the scope the parent was resolved in, which
is how the edge stays auditable (`writeInheritanceEdges` in
`src/services/graph-db/ladybug/ladybug-adapter-writes.ts` and
`src/services/graph-db/arango/arango-adapter-store.ts`).

### 4.4 Anomaly Node

```json
{
  "key": "anomaly:f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "type": "Anomaly",
  "discovered_by": "python-implementation",
  "routes_to": "author-adapter",
  "description": "Reward recorded failure for squadrules://layer/abc123: SyntaxError: invalid syntax (exit_code 1)",
  "created_at": "2026-10-28T11:15:00Z",
  "severity": "high",
  "anomaly_type": "failure",
  "status": "open",
  "metadata": {}
}
```

### 4.5 Contradiction Edge (anomaly to parent rule)

```json
{
  "from": "anomaly:f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "to": "adapter:python-implementation",
  "relationship": "contradicts",
  "contradiction_type": "inconsistency",
  "severity": "high",
  "discovered_at": "2026-10-28T11:15:00Z",
  "resolution_status": "open"
}
```

The shared writer creates these edges with `resolution_status: 'open'`; no code path
transitions that value yet, so `"resolved"` is not a state the system produces.

### 4.6 Version Node

```json
{
  "key": "version:adapter:personal:critic-loop@7",
  "type": "version",
  "entity_key": "adapter:personal:critic-loop",
  "entity_uri": "adapter://critic-loop",
  "version_number": "7",
  "version_seq": 7,
  "adapter_version": "2.1.0",
  "change_type": "updated",
  "changed_at": "2026-03-15T14:22:00Z",
  "changed_by": "jakub.plichcinski",
  "actor_source": "auth-subject",
  "space": "personal",
  "parent_version": "6",
  "reason": "Added subagent critic hop for verification isolation",
  "content_digest": "<sha256 of the exact stored markdown>",
  "content": "# Critic Loop: Delegated Review Workflow\n...",
  "metadata_snapshot": {
    "title": "Critic Loop: Delegated Review Workflow",
    "layer_count": 3,
    "contract_types": ["shell", "forward", "subagent"]
  },
  "metadata": {}
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

**Graph representation today:**

The value is stored on the adapter node's `frontmatter` and nothing else. The
`routes_to` rel table exists but no code projects a routing edge from `chain_root:`
(§2.7 — deferred, not partially built).

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

The `override` field marks which parent properties the child explicitly overrides. It is
kept in the child node's `frontmatter` and copied onto the `inherits` edge as
`override_fields` for audit (`writeInheritanceEdges`).

**Selective override resolution** (`mergeResolvedProperties` in
`src/services/graph-db/inheritance-merge.ts`):

1. Start from the **root** ancestor; drop identity/structural fields it declares
2. Walk the chain to the child; each level contributes a field only when the field is
   absent so far, or when that level names it in its **own** `override:` list
3. Restore identity/structural fields from the child — they never travel

### 5.4 Inheritance Resolution Algorithm

Two resolutions are delivered, and they answer different questions. Do not read one as
the other.

**Effective properties** (`mergeResolvedProperties` in
`src/services/graph-db/inheritance-merge.ts`, exposed as `resolveInheritance` on the
`GraphRepository` port):

```text
mergeResolvedProperties(child, ancestorsRootFirst):
  merged = copy(ancestorsRootFirst[0])          # root contributes every field
  remove identity/structural fields from merged # key, type, slug, version, space,
                                                 # created_at, updated_at, frontmatter,
                                                 # inherits, override, verdict,
                                                 # work_envelope
  for level in ancestorsRootFirst[1:] + [child]:
    claimed = set(level.frontmatter.override ?? [])
    for (field, value) in level:
      if field is identity/structural: continue
      if field not in merged or field in claimed:
        merged[field] = value
  restore identity/structural fields from child
  return merged
```

The edge's `inherited_fields`/`override_fields` are **not** inputs — the per-level
`override:` list is (§2.1).

**Effective content** (`resolveEffectiveLayerContent` in
`src/tools/adapter-effective-content.ts`, merging with `mergeAdapterMarkdown` in
`src/services/graph-db/adapter-content-merge.ts`, decided by
[ADR 0043](../adr/0043-additive-selective-inheritance-and-inheritance-checkpoints.md)):

1. Walk the **stored** ancestry — child record → its `inherits:` → that parent's record
   in the shared scope policy (child's own space first, app space second) → to the root.
2. The child is the spine: its preamble and section order are the output order.
3. Each `##` heading key (lowercased, whitespace-collapsed) is claimed by the **nearest**
   level that has it. A nearer level's section with the same heading is the explicit
   override and is recorded in `overrides`.
4. A child-only section is an addition and survives.
5. Contract selection is nearest-level-first, so `effective_contracts[0]` is the
   contract the caller executes.
6. A missing ancestor, a cycle, or an over-deep chain fails closed: `resolved: false`
   with a `resolved_reason`. A green `resolved: true` is never reported for an
   incomplete chain.

`override:` frontmatter names **property** fields for the merge above; section
inheritance is keyed by heading, not by that list.

**Complexity:** O(depth) where depth is the inheritance chain length.

---

## 6. Query Patterns

The graph layer never exposes a query language: the `GraphRepository` port names
operations, and each backend implements them in its own dialect
([ADR 0044](../adr/0044-graph-repository-port-and-arango-shared-backend.md)). The
snippets below are the shapes the implementations use. Where a pattern is **not**
implemented, that is said explicitly — it is a design sketch, not a delivered query.

**Identifiers used below:** the AQL examples traverse the real, capitalized collections
(`Adapter`, `Version`, `Anomaly`) and edge collections (`Inherits`, `SpecializedBy`,
`VersionOf`, `Contradicts`) declared in
`src/services/graph-db/arango/arango-schema.ts`. There is no `GRAPH 'ontology'` clause
and no lowercase `adapters/` document id in the implementation. The Cypher examples
match `src/services/graph-db/ladybug/ladybug-adapter-reads.ts`. Adapter keys are
scope-qualified (`adapter:<spaceId>:<slug>`, §1.2); the examples shorten them.

### 6.1 Path-to-Root: Find All Ancestors

**Use case:** Inheritance resolution. **Implemented** as `findPathToRoot`.

**AQL (ArangoDB shared mode)** — `src/services/graph-db/arango/arango-adapter-store.ts`:

```aql
FOR v, e, p IN 1..10 OUTBOUND CONCAT('Adapter/', @adapterKey) Inherits
  RETURN { ancestor: v, depth: LENGTH(p.edges) }
```

**Cypher (LadybugDB embedded mode)** —
`src/services/graph-db/ladybug/ladybug-adapter-reads.ts`:

```cypher
MATCH path = (child:Adapter {key: $adapterKey})-[:Inherits*1..10]->(ancestor:Adapter)
RETURN
  ancestor.key as key,
  ancestor.type as type,
  ancestor.slug as slug,
  length(path) as depth
```

Both are capped at 10 hops.

### 6.2 Anomaly Backpropagation: Find Affected Parents

**Use case:** Given an anomaly, find the parents that may need refinement.

**Not implemented as a query.** The port exposes `createAnomaly`, `listAnomalies`,
`createProposal`, `listProposals` and the confirmation methods — not a
contradiction-traversal read. `Contradicts` edges exist and are written by the shared
backend (§2.3); the shape below is illustrative of the data model, not of a call the
runtime makes.

```aql
FOR v IN 1..5 OUTBOUND CONCAT('Anomaly/', @anomalyKey) Contradicts
  RETURN v
```

### 6.3 Consensus Detection: Children Reporting the Same Anomaly

**Use case:** If multiple children report the same problem, it may be systemic.

**Partly implemented.** Child enumeration is delivered as `getChildren`
(`SpecializedBy` traversal, `arango-adapter-store.ts` / `ladybug-adapter-reads.ts`):

```aql
FOR c IN 1..1 OUTBOUND CONCAT('Adapter/', @parentKey) SpecializedBy
  RETURN { key: c._key, slug: c.slug, space: c.space }
```

The join from each child to its anomalies is **not** a graph query: consensus is
computed from scoped `listAnomalies` records and confirmations, decided in
[ADR 0046](../adr/0046-evidence-gated-evolution-proposals.md). Frequency is counted over
**distinct children**, not executions.

### 6.4 Version History: Trace All Versions and Changes

**Implemented** as `listVersions`. It is a collection scan over `Version` ordered by the
monotonic `version_seq` — not a `VersionOf` traversal, because history must return
snapshots whose adapter node no longer exists.

```aql
FOR v IN Version
  FILTER v.entity_key == @entityKey
  FILTER v.version_seq > @afterSeq
  SORT v.version_seq DESC
  LIMIT @limit
  RETURN v
```

**Cypher (embedded)** mirrors it with the same filters and ordering in
`src/services/graph-db/ladybug/ladybug-history-store.ts`. `VersionOf` exists so the
snapshot and its `Adapter` node stay linked; it is not the read path.

### 6.5 Inheritance Depth Calculation

**Not implemented as a query.** Depth is a by-product of `findPathToRoot` (`depth` per
row), not an aggregate function. The shape below is illustrative.

```aql
FOR v, e, p IN 1..10 OUTBOUND CONCAT('Adapter/', @adapterKey) Inherits
  COLLECT AGGREGATE maxDepth = MAX(LENGTH(p.edges))
  RETURN { inheritance_depth: maxDepth }
```

### 6.6 Orphan Detection: Find Adapters with No Parent

**Not implemented.** Nothing scans the adapter space for parents, and that is not a
release requirement — boot reconciliation links pairs whose parent is stored later
(`docs/specs/train-graph-writes.md` §2.1), so a parentless node is normal at any moment.
The shape below is illustrative.

```aql
FOR a IN Adapter
  LET parents = (FOR p IN 1 OUTBOUND a Inherits LIMIT 1 RETURN p)
  FILTER LENGTH(parents) == 0
  RETURN { adapter: a, suggestion: "consider_extracting_concept" }
```

---

## 7. Data Partitioning

### 7.1 Graph DB (LadybugDB embedded / ArangoDB shared)

**Stores:** Ontological relationships, inheritance trees, anomalies, version history.

**Collections / tables** — the delivered list. ArangoDB collection names are
capitalized, exactly as `NODE_COLLECTIONS` / `EDGE_COLLECTIONS` declare them in
`src/services/graph-db/arango/arango-schema.ts`; the graph is named
`squadrules_ontology` (`ONTOLOGY_GRAPH_NAME`). The LadybugDB tables are in
`src/services/graph-db/ladybug/ladybug-schema.ts`.

| Collection (ArangoDB) | Table (LadybugDB) | Kind | Purpose | Written by |
|------------------------|-------------------|------|---------|------------|
| `Adapter` | `Adapter` | Node | SquadRules adapters | train/tune projection |
| `Concept` | `Concept` | Node | Abstract categories and rules | port only — no runtime caller |
| `Instance` | `Instance` | Node | Specific instances (deferred) | nothing |
| `Anomaly` | `Anomaly` | Node | Failures and contradictions | reward / evolution hooks |
| `Version` | `Version` | Node | Immutable adapter snapshots | `appendVersion` |
| `Proposal` | `Proposal` | Node | Evolution proposals | `createProposal` |
| `Confirmation` | `Confirmation` | Node | Proposal confirmations | `recordConfirmation` |
| `Inherits` | `Inherits` | Edge | Child → parent inheritance | train/tune projection |
| `SpecializedBy` | `SpecializedBy` | Edge | Parent → child specialization | train/tune projection |
| `Contradicts` | `Contradicts` | Edge | Anomaly → adapter | shared backend only (§2.3) |
| `VersionOf` | `VersionOf` | Edge | Snapshot → adapter | `appendVersion` |
| `DiscoveredBy` | `DiscoveredBy` | Edge | Anomaly → discoverer | shared backend only (§2.6) |
| `RoutesTo` | `RoutesTo` | Edge | Chain routing | nothing (deferred, §2.7) |
| `ProposedFor` | `ProposedFor` | Edge | Proposal → adapter | `createProposal` (shared backend) |
| `ConceptInstances` | `ConceptInstances` | Edge | Instance → concept | nothing (deferred, §2.4) |

All edge definitions are adapter-to-adapter except where the table above says otherwise
(`Contradicts`/`DiscoveredBy` from `Anomaly`, `VersionOf` from `Version`, `ProposedFor`
from `Proposal`, `ConceptInstances` from `Instance`).

**Indexes:**

- `Adapter`: primary key on `key` (unique), which is already the scope-qualified
  `adapter:<spaceId>:<slug>`

- `Concept`: primary key on `key`

- `Anomaly`: primary key on `key`; reads filter on `routes_to`, `status` and the
  scope fragment in `metadata`

- `Version`: primary key on `key`; reads filter on `entity_key` and `version_seq`

- Edge collections: endpoints plus the columns each rel table declares

### 7.2 Vector DB (LanceDB / Qdrant)

**Stores:** Adapter embeddings for semantic search.

**Delivered, with a different record shape than the sketch below.** The vector store is
LanceDB behind the memory store (`src/services/memory/`), and the stored record is
`Memory` in `src/types/memory.ts` — `memory_uuid`, `space_id`, `label`, `slug`, `tags`,
`text`, `adapter`, with the vector stored alongside. There is no `adapter_uri` column and
no separate `adapter_embeddings` table. The JSON below is the partitioning sketch.

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

**Not delivered, and not part of the graph deliverable.** Nothing in `src/` opens a
SQLite or PostgreSQL store, and the Postgres in `compose/infra.yaml` serves Keycloak
authentication only (`scripts/squadrules-db-init/README.md`). The shapes below describe a
structured-metadata store that does not exist yet; adapter metadata, execution history and
audit are carried by the memory store and the graph instead.

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

**Pattern:** Use URIs as foreign keys across databases. This is the convention the graph
uses for its own references — `Version.entity_uri` is `adapter://<slug>` — not an
implemented cross-store join. Steps 3 and 4 below query stores that do not exist (§7.3)
and record shapes the vector store does not have (§7.2); only step 5 runs today.

**Resolution:**

1. Start with URI: `adapter://critic-loop`

2. Extract slug: `critic-loop`

3. Query SQL DB: `SELECT * FROM adapter_metadata WHERE slug = 'critic-loop'`

4. Query Vector DB: `SELECT * FROM adapter_embeddings WHERE adapter_uri = 'adapter://critic-loop'`

5. Query Graph DB: `MATCH (a:Adapter {key: 'adapter:critic-loop'}) RETURN a`

---

## 8. Schema Evolution

### 8.1 Adding New Node Types

1. Define the node type (URI scheme, properties, example JSON)

2. Create the collection / node table

3. Add indexes

4. Update the graph definition

5. Document the change

### 8.2 Adding New Edge Types

1. Define the edge type (source, target, directionality, properties)

2. Create the edge collection / rel table

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

No `schema` node type exists: the seven node tables are the whole vocabulary (§1), and a
schema-version node is not a release requirement. What keeps the schema versioned in
practice is that every table is created with `IF NOT EXISTS` and columns are never added
to an existing table — the embedded graph holds derived topology plus append-only history,
so a shape change rebuilds the table instead of migrating it in place (`ladybug-schema.ts`
header). The node below is a design sketch, not a stored record.

```json
{
  "key": "schema:ontology",
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

For the embedded graph this collapses to one rule: an additive change is a new
`IF NOT EXISTS` table, and changing an existing table's columns is a **rebuild** of the
derived graph rather than a migration — the policy `ladybug-schema.ts` states in its header
(§8.4).

---

## 9. Implementation Notes

### 9.1 ArangoDB-Specific Considerations

**Graph creation** — the graph is `squadrules_ontology`, and every collection and edge
definition is capitalized (`ONTOLOGY_GRAPH_NAME`, `NODE_COLLECTIONS`,
`EDGE_COLLECTIONS`, `EDGE_DEFINITIONS` in
`src/services/graph-db/arango/arango-schema.ts`):

```javascript
db._createGraph("squadrules_ontology", [
  { collection: "Inherits", from: ["Adapter"], to: ["Adapter"] },
  { collection: "SpecializedBy", from: ["Adapter"], to: ["Adapter"] },
  { collection: "Contradicts", from: ["Anomaly"], to: ["Adapter"] },
  { collection: "VersionOf", from: ["Version"], to: ["Adapter"] },
  { collection: "DiscoveredBy", from: ["Anomaly"], to: ["Adapter"] },
  { collection: "RoutesTo", from: ["Adapter"], to: ["Adapter"] },
  { collection: "ProposedFor", from: ["Proposal"], to: ["Adapter"] },
  { collection: "ConceptInstances", from: ["Instance"], to: ["Concept"] }
]);
```

Traversals in the implementation name the edge collection directly
(`FOR v, e, p IN 1..10 OUTBOUND CONCAT('Adapter/', @adapterKey) Inherits`), so the named
graph is bookkeeping for the edge definitions, not a query requirement.

**Physical field mapping:** In ArangoDB, the logical `key` property is stored as `_key`, and `_id` is auto-generated as `<collection>/<_key>`. Edge endpoints are stored as `_from`/`_to` document IDs.

### 9.2 LadybugDB Embedded Considerations

LadybugDB uses `key STRING PRIMARY KEY` for node identity. Edge endpoints are implicit in the graph pattern syntax `(source)-[edge:RelType]->(target)` and in `CREATE REL TABLE` declarations with `FROM <Table> TO <Table>`.

**Current node tables:** `Adapter`, `Concept`, `Instance`, `Anomaly`, `Version`,
`Proposal`, `Confirmation`
**Current rel tables:** `Inherits`, `SpecializedBy`, `Contradicts`, `VersionOf`,
`DiscoveredBy`, `RoutesTo`, `ProposedFor`, `ConceptInstances`

Every table is created with `IF NOT EXISTS`, so opening an older graph adds newer
tables without a migration; new columns on existing tables are not added, because the
embedded graph holds derived topology plus append-only history and the owned-record
shape is read through JSON columns (`ladybug-schema.ts` header).

### 9.3 Testing

**Test scenarios:**

- Deep inheritance chain (3+ levels)

- Multiple children reporting the same anomaly

- Adapter with no parent (orphan)

- Version history with multiple change types

---

## 10. Summary

This document defines the graph schema for SquadRules 6 ontological knowledge system.

**Delivered node tables:** `Adapter`, `Concept`, `Anomaly`, `Version`, `Proposal`,
`Confirmation`; `Instance` is created but has no reader or writer (§1.4).

**Delivered edge types:** `Inherits`, `SpecializedBy`, `Contradicts`, `VersionOf`,
`DiscoveredBy`, `ProposedFor`; `RoutesTo` and `ConceptInstances` are created but have no
writer (§2.4, §2.7).

**Deferred, not missing-but-expected:** general Concept/Instance inheritance and
instance CRUD (§1). Adapter-to-adapter inheritance, history and evolution records are
delivered.

**Key features:**

- URI-based identifiers

- Mode-agnostic logical schema with backend-specific physical mapping

- Adapter inheritance via frontmatter, resolved additively and selectively (§5.4)

- Anomaly-driven ontology evolution (proposal-only write invariant)

- Version tracking

- Cross-database relationships

**Query patterns:** Path-to-root and version history are implemented; anomaly
backpropagation, inheritance depth and orphan detection are design sketches (§6).

**Data partitioning:**

- Graph DB: ontological relationships

- Vector DB: embeddings for semantic search

- SQL DB: metadata, preferences, execution history, audit logs
