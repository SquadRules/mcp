/**
 * ArangoDB anomaly records (evidence only, never an adapter edit).
 *
 * One stream transaction inserts the anomaly and, when the record carries a scope,
 * links it to the adapter that discovered it (`DiscoveredBy`) and to the adapter it
 * contradicts (`Contradicts`) — so contradiction evidence is queryable as a graph
 * relationship instead of a text column.
 */
import { ArangoHttpClient } from './arango-http.js';
import type { AnomalyFilter, AnomalyNode } from '../graph-types.js';
import { adapterGraphKey } from '../adapter-scope.js';
import { anomalyFromDoc, type ArangoDoc } from './arango-rows.js';

const ANOMALY_COLLECTION = 'Anomaly';

function anomalyDoc(anomaly: AnomalyNode): ArangoDoc {
  const metadata: Record<string, unknown> = { ...(anomaly.metadata || {}) };
  if (anomaly.source_child) metadata['source_child'] = anomaly.source_child;
  return {
    _key: anomaly.key,
    type: 'Anomaly',
    discovered_by: anomaly.discovered_by,
    routes_to: anomaly.routes_to,
    description: anomaly.description,
    created_at: anomaly.created_at,
    severity: anomaly.severity ?? null,
    anomaly_type: anomaly.anomaly_type ?? null,
    status: anomaly.status ?? 'open',
    metadata
  };
}

/**
 * Insert one anomaly record. Insert-only: a duplicated key is an error.
 *
 * When `metadata.scope_space_id` is present, the discovered-by / contradicts edges
 * are written in the same transaction as the node.
 */
export async function createAnomaly(
  client: ArangoHttpClient,
  anomaly: AnomalyNode
): Promise<void> {
  const doc = anomalyDoc(anomaly);
  const scopeSpace =
    typeof (doc['metadata'] as Record<string, unknown>)['scope_space_id'] === 'string'
      ? String((doc['metadata'] as Record<string, unknown>)['scope_space_id'])
      : '';

  await client.withTransaction(
    { write: [ANOMALY_COLLECTION, 'Contradicts', 'DiscoveredBy'], read: ['Adapter'] },
    async (transactionId) => {
      await client.queryInTransaction(transactionId, 'INSERT @doc INTO Anomaly', { doc });
      if (!scopeSpace || !anomaly.discovered_by) return;

      const adapterKey = adapterGraphKey(scopeSpace, anomaly.discovered_by);
      await client.queryInTransaction(
        transactionId,
        `FOR a IN Adapter
           FILTER a._key == @adapterKey
           LIMIT 1
           INSERT { _from: CONCAT('Anomaly/', @anomalyKey), _to: CONCAT('Adapter/', @adapterKey),
                    relationship: 'contradicts', contradiction_type: @contradictionType,
                    severity: @severity, discovered_at: @discoveredAt,
                    resolution_status: 'open', metadata: {} }
           INTO Contradicts`,
        {
          adapterKey,
          anomalyKey: anomaly.key,
          contradictionType: anomaly.anomaly_type ?? 'failure',
          severity: anomaly.severity ?? 'medium',
          discoveredAt: anomaly.created_at
        }
      );
      await client.queryInTransaction(
        transactionId,
        `FOR a IN Adapter
           FILTER a._key == @adapterKey
           LIMIT 1
           INSERT { _from: CONCAT('Anomaly/', @anomalyKey), _to: CONCAT('Adapter/', @adapterKey),
                    relationship: 'discovered_by', created_at: @discoveredAt }
           INTO DiscoveredBy`,
        { adapterKey, anomalyKey: anomaly.key, discoveredAt: anomaly.created_at }
      );
    }
  );
}

/** Anomalies filtered by routing target, status, or reporting child. */
export async function listAnomalies(
  client: ArangoHttpClient,
  filter: AnomalyFilter = {}
): Promise<AnomalyNode[]> {
  const rows = await client.query<ArangoDoc>(
    `FOR a IN Anomaly
       FILTER @routesTo == '' OR a.routes_to == @routesTo
       FILTER @status == '' OR a.status == @status
       SORT a.created_at DESC
       LIMIT @limit
       RETURN a`,
    {
      routesTo: filter.routesTo ?? '',
      status: filter.status ?? '',
      limit: filter.limit && filter.limit > 0 ? filter.limit : 200
    }
  );
  const nodes = rows.map(anomalyFromDoc);
  if (!filter.sourceChild) return nodes;
  return nodes.filter((node) => node.source_child === filter.sourceChild);
}
