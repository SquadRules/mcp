/**
 * LadybugDB anomaly records.
 *
 * Anomalies are evidence, never an edit: writing one must not change the adapter
 * it describes (docs/specs/graph-schema.md, Touchpoint 4 invariant). The table
 * predates the scoped fields, so `source_child` and scope provenance are carried
 * in the metadata JSON — no column migration is needed for an older graph.
 */
import type { Connection } from '@ladybugdb/core';
import type { AnomalyFilter, AnomalyNode } from '../graph-types.js';
import { executeStatement, parseJson, readRows } from './ladybug-exec.js';

const ANOMALY_COLUMNS = `a.key as key, a.type as type, a.discovered_by as discovered_by,
  a.routes_to as routes_to, a.description as description, a.created_at as created_at,
  a.severity as severity, a.anomaly_type as anomaly_type, a.status as status,
  a.metadata as metadata`;

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toAnomalyNode(row: Record<string, unknown>): AnomalyNode {
  const metadata = parseJson<Record<string, unknown>>(row['metadata'], {});
  const node: AnomalyNode = {
    key: String(row['key'] ?? ''),
    type: 'Anomaly',
    discovered_by: String(row['discovered_by'] ?? ''),
    routes_to: String(row['routes_to'] ?? ''),
    description: String(row['description'] ?? ''),
    created_at: String(row['created_at'] ?? ''),
    metadata
  };
  const severity = optionalString(row['severity']);
  if (severity) node.severity = severity;
  const anomalyType = optionalString(row['anomaly_type']);
  if (anomalyType) node.anomaly_type = anomalyType;
  const status = optionalString(row['status']);
  if (status) node.status = status;
  if (typeof metadata['source_child'] === 'string') node.source_child = metadata['source_child'];
  return node;
}

/** Insert one anomaly record. Insert-only: a duplicated key is an error. */
export async function createAnomaly(connection: Connection, anomaly: AnomalyNode): Promise<void> {
  const metadata: Record<string, unknown> = { ...(anomaly.metadata || {}) };
  if (anomaly.source_child) metadata['source_child'] = anomaly.source_child;

  await executeStatement(
    connection,
    `CREATE (a:Anomaly {
       key: $key, type: 'Anomaly', discovered_by: $discoveredBy, routes_to: $routesTo,
       description: $description, created_at: $createdAt,
       severity: $severity, anomaly_type: $anomalyType, status: $status,
       metadata: $metadata
     })`,
    {
      key: anomaly.key,
      discoveredBy: anomaly.discovered_by,
      routesTo: anomaly.routes_to,
      description: anomaly.description,
      createdAt: anomaly.created_at,
      severity: anomaly.severity ?? null,
      anomalyType: anomaly.anomaly_type ?? null,
      status: anomaly.status ?? 'open',
      metadata: JSON.stringify(metadata)
    }
  );
}

/** Anomalies filtered by routing target, status, or reporting child. */
export async function listAnomalies(
  connection: Connection,
  filter: AnomalyFilter = {}
): Promise<AnomalyNode[]> {
  const rows = await readRows<Record<string, unknown>>(
    connection,
    `MATCH (a:Anomaly)
     WHERE ($routesTo = '' OR a.routes_to = $routesTo)
       AND ($status = '' OR a.status = $status)
     RETURN ${ANOMALY_COLUMNS}
     ORDER BY a.created_at DESC
     LIMIT $limit`,
    {
      routesTo: filter.routesTo ?? '',
      status: filter.status ?? '',
      limit: filter.limit && filter.limit > 0 ? filter.limit : 200
    }
  );
  const nodes = rows.map(toAnomalyNode);
  if (!filter.sourceChild) return nodes;
  return nodes.filter((node) => node.source_child === filter.sourceChild);
}
