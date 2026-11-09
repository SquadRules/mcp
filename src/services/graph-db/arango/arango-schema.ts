/**
 * ArangoDB schema bootstrap for the shared adapter ontology.
 *
 * Collections and the named graph mirror docs/specs/graph-schema.md §1–2. Creation
 * is idempotent (a 409 "duplicate name" is treated as already-present), so opening a
 * database that another replica bootstrapped is a no-op.
 *
 * The bootstrap also *proves* the capabilities the repository depends on instead of
 * claiming them: it reads the server version, then opens and aborts a real stream
 * transaction. There is no HA/cluster claim anywhere — a single server is enough and
 * is what the shared tests exercise.
 */
import {
  assertSupportedArangoVersion,
  type ArangoConnectionConfig
} from '../../../config/graph-backend.js';
import { ArangoHttpClient, ArangoHttpError } from './arango-http.js';

export const NODE_COLLECTIONS = [
  'Adapter',
  'Concept',
  'Instance',
  'Anomaly',
  'Version',
  'Proposal',
  'Confirmation'
] as const;

export const EDGE_COLLECTIONS = [
  'Inherits',
  'SpecializedBy',
  'Contradicts',
  'VersionOf',
  'DiscoveredBy',
  'RoutesTo',
  'ProposedFor',
  'ConceptInstances'
] as const;

export const ONTOLOGY_GRAPH_NAME = 'squadrules_ontology';

interface EdgeDefinition {
  collection: string;
  from: string[];
  to: string[];
}

const EDGE_DEFINITIONS: EdgeDefinition[] = [
  { collection: 'Inherits', from: ['Adapter'], to: ['Adapter'] },
  { collection: 'SpecializedBy', from: ['Adapter'], to: ['Adapter'] },
  { collection: 'Contradicts', from: ['Anomaly'], to: ['Adapter'] },
  { collection: 'VersionOf', from: ['Version'], to: ['Adapter'] },
  { collection: 'DiscoveredBy', from: ['Anomaly'], to: ['Adapter'] },
  { collection: 'RoutesTo', from: ['Adapter'], to: ['Adapter'] },
  { collection: 'ProposedFor', from: ['Proposal'], to: ['Adapter'] },
  { collection: 'ConceptInstances', from: ['Instance'], to: ['Concept'] }
];

export interface ArangoCapabilities {
  version: string;
  license: string;
  /** `verified` means a real begin/abort round-trip succeeded, not a claim. */
  streamTransactions: 'verified';
  collections: string[];
}

function isDuplicateError(err: unknown): boolean {
  return err instanceof ArangoHttpError && err.status === 409;
}

async function ensureCollection(
  client: ArangoHttpClient,
  name: string,
  type: 2 | 3
): Promise<void> {
  try {
    await client.request('/_api/collection', { method: 'POST', body: { name, type } });
  } catch (err) {
    if (!isDuplicateError(err)) throw err;
  }
}

async function ensureIndex(
  client: ArangoHttpClient,
  collection: string,
  fields: string[]
): Promise<void> {
  try {
    await client.request(`/_api/index?collection=${encodeURIComponent(collection)}`, {
      method: 'POST',
      body: { type: 'persistent', fields, name: `idx_${collection}_${fields.join('_')}` }
    });
  } catch (err) {
    // Duplicate name (1207) or duplicate definition (1210) — the index exists.
    if (!isDuplicateError(err)) throw err;
  }
}

async function ensureGraph(client: ArangoHttpClient): Promise<void> {
  try {
    await client.request('/_api/gharial', {
      method: 'POST',
      body: {
        name: ONTOLOGY_GRAPH_NAME,
        edgeDefinitions: EDGE_DEFINITIONS,
        orphanCollections: ['Concept', 'Instance', 'Proposal', 'Confirmation']
      }
    });
  } catch (err) {
    if (!isDuplicateError(err)) throw err;
  }
}

/** Create every collection, edge definition and lookup index. */
export async function ensureArangoSchema(client: ArangoHttpClient): Promise<void> {
  for (const name of NODE_COLLECTIONS) {
    await ensureCollection(client, name, 2);
  }
  for (const name of EDGE_COLLECTIONS) {
    await ensureCollection(client, name, 3);
  }
  await ensureGraph(client);

  await ensureIndex(client, 'Adapter', ['space', 'slug']);
  await ensureIndex(client, 'Version', ['entity_key', 'version_seq']);
  await ensureIndex(client, 'Anomaly', ['routes_to', 'created_at']);
  await ensureIndex(client, 'Proposal', ['target_key', 'status']);
  await ensureIndex(client, 'Confirmation', ['proposal_key', 'actor']);
}

/**
 * Verify the server is a supported series and that stream transactions really work.
 *
 * A stream transaction over `Adapter` is opened and aborted immediately: if the
 * server cannot do it, the repository refuses to initialize instead of degrading to
 * non-atomic writes.
 */
export async function probeArangoCapabilities(
  client: ArangoHttpClient
): Promise<ArangoCapabilities> {
  const info = await client.version();
  assertSupportedArangoVersion(info.version);
  await ensureArangoSchema(client);

  const transactionId = await client.beginTransaction({ write: ['Adapter'] });
  await client.abortTransaction(transactionId);

  return {
    version: info.version,
    license: info.license ?? 'unknown',
    streamTransactions: 'verified',
    collections: [...NODE_COLLECTIONS, ...EDGE_COLLECTIONS]
  };
}

/** Build a client and verify the deployment before the repository is handed out. */
export async function connectArango(
  config: ArangoConnectionConfig
): Promise<{ client: ArangoHttpClient; capabilities: ArangoCapabilities }> {
  const client = new ArangoHttpClient(config);
  const capabilities = await probeArangoCapabilities(client);
  return { client, capabilities };
}
