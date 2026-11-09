/**
 * LadybugDB schema for the adapter ontology graph.
 *
 * Node tables and rel tables follow docs/specs/graph-schema.md §1–2 and §7.1.
 * Every table is created with `IF NOT EXISTS`, so opening an older graph adds the
 * newer tables without a migration step; new columns on existing tables are not
 * added here because the embedded graph holds derived topology plus append-only
 * history, and the owned-record shape is read through JSON columns.
 */
import type { Connection } from '@ladybugdb/core';

/**
 * Default database size cap (256 MB). LadybugDB 0.22.2 reserves an 8 TB mmap
 * address space when `maxDBSize` is 0, which fails on macOS and other systems
 * that cannot overcommit that much virtual memory — especially when several
 * Database instances are opened and closed in rapid succession (tests).
 */
export const MAX_DB_SIZE_BYTES = 256 * 1024 * 1024;

export async function createSchema(connection: Connection): Promise<void> {
  const statements: string[] = [
    `CREATE NODE TABLE IF NOT EXISTS Adapter(
      key STRING PRIMARY KEY,
      type STRING,
      slug STRING,
      version STRING,
      title STRING,
      created_at STRING,
      updated_at STRING,
      frontmatter STRING,
      layer_count INT64,
      contract_types STRING,
      space STRING,
      tags STRING,
      metadata STRING
    )`,
    `CREATE NODE TABLE IF NOT EXISTS Concept(
      key STRING PRIMARY KEY,
      type STRING,
      name STRING,
      definition STRING,
      created_at STRING,
      updated_at STRING,
      baseline_attributes STRING,
      tags STRING,
      metadata STRING
    )`,
    // Instance nodes are optional per spec §1.4; the table exists so a concept
    // instance with its own relationships can be recorded without a migration.
    `CREATE NODE TABLE IF NOT EXISTS Instance(
      key STRING PRIMARY KEY,
      type STRING,
      concept STRING,
      instance_id STRING,
      created_at STRING,
      attributes STRING,
      metadata STRING
    )`,
    // Proposal-only anomaly bookkeeping (Touchpoint 4). `source_child` and the
    // scope provenance live in the metadata JSON: an older graph already has this
    // table without those columns, and no column migration is required to read it.
    `CREATE NODE TABLE IF NOT EXISTS Anomaly(
      key STRING PRIMARY KEY,
      type STRING,
      discovered_by STRING,
      routes_to STRING,
      description STRING,
      created_at STRING,
      severity STRING,
      anomaly_type STRING,
      status STRING,
      metadata STRING
    )`,
    // Immutable, append-only history. `version_seq` is the monotonic ordering key;
    // `version_number` is the same value rendered for readers.
    `CREATE NODE TABLE IF NOT EXISTS Version(
      key STRING PRIMARY KEY,
      type STRING,
      entity_key STRING,
      entity_uri STRING,
      version_number STRING,
      version_seq INT64,
      adapter_version STRING,
      change_type STRING,
      changed_at STRING,
      changed_by STRING,
      actor_source STRING,
      space STRING,
      parent_version STRING,
      reason STRING,
      content_digest STRING,
      content STRING,
      metadata_snapshot STRING,
      metadata STRING
    )`,
    // Evidence-gated evolution proposals. Never mutate their target adapter.
    `CREATE NODE TABLE IF NOT EXISTS Proposal(
      key STRING PRIMARY KEY,
      type STRING,
      target_key STRING,
      target_slug STRING,
      space STRING,
      change_type STRING,
      field STRING,
      from_value STRING,
      to_value STRING,
      reason STRING,
      source_child STRING,
      source_anomaly STRING,
      evidence STRING,
      evidence_digest STRING,
      status STRING,
      created_at STRING,
      created_by STRING,
      actor_source STRING,
      required_confirmations INT64,
      metadata STRING
    )`,
    `CREATE NODE TABLE IF NOT EXISTS Confirmation(
      key STRING PRIMARY KEY,
      type STRING,
      proposal_key STRING,
      actor STRING,
      actor_kind STRING,
      actor_source STRING,
      distinct_child STRING,
      decision STRING,
      evidence STRING,
      created_at STRING
    )`,
    `CREATE REL TABLE IF NOT EXISTS Inherits(
      FROM Adapter TO Adapter,
      relationship STRING,
      inherited_fields STRING,
      override_fields STRING,
      created_at STRING,
      metadata STRING
    )`,
    `CREATE REL TABLE IF NOT EXISTS SpecializedBy(
      FROM Adapter TO Adapter,
      relationship STRING,
      specialization_type STRING,
      created_at STRING,
      metadata STRING
    )`,
    `CREATE REL TABLE IF NOT EXISTS Contradicts(
      FROM Anomaly TO Adapter,
      relationship STRING,
      contradiction_type STRING,
      severity STRING,
      discovered_at STRING,
      resolution_status STRING,
      metadata STRING
    )`,
    `CREATE REL TABLE IF NOT EXISTS VersionOf(
      FROM Version TO Adapter,
      relationship STRING,
      changed_at STRING,
      metadata STRING
    )`,
    `CREATE REL TABLE IF NOT EXISTS DiscoveredBy(
      FROM Anomaly TO Adapter,
      relationship STRING,
      created_at STRING
    )`,
    `CREATE REL TABLE IF NOT EXISTS RoutesTo(
      FROM Adapter TO Adapter,
      relationship STRING,
      routing_type STRING,
      created_at STRING
    )`,
    `CREATE REL TABLE IF NOT EXISTS ProposedFor(
      FROM Proposal TO Adapter,
      relationship STRING,
      created_at STRING
    )`,
    `CREATE REL TABLE IF NOT EXISTS ConceptInstances(
      FROM Instance TO Concept,
      relationship STRING,
      created_at STRING
    )`
  ];

  for (const statement of statements) {
    await connection.query(statement);
  }
}
