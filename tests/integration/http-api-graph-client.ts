/**
 * HTTP client helpers shared by the graph API integration suites.
 *
 * Every call here is a real `POST` against the child server started by
 * `ChildApiServer` (real Express router, real LanceDB/LadybugDB, real fastembed). Nothing
 * is stubbed: these helpers only assemble request bodies so the suites can state intent.
 *
 * Review gate, recorded rather than bypassed: `executeTrain` exempts exactly two real
 * contracts from `review_evidence` — artifact trains (non-markdown mime) and fork trains
 * (`source_adapter_uri`). The gate is shape-first, so no test may fabricate a critic PASS.
 * `FORK_SOURCE` is the bundled `critic-loop` adapter that boot injection system-seeds
 * into the app space, so every authored write in these suites is a real fork train.
 */
import type { ChildApiServer } from './http-api-graph-child-server.js';

/** Bundled adapter that boot injection seeds into the app space — the fork source. */
export const FORK_SOURCE = 'squadrules://adapter/critic-loop';

export interface ForkOutcome {
  status: number;
  body: Record<string, unknown>;
  slug: string;
  layerUuid: string;
}

/** Fork train one document over real HTTP and return the created adapter identity. */
export async function forkTrain(server: ChildApiServer, markdown: string): Promise<ForkOutcome> {
  const reply = await server.post('/api/train', {
    content: markdown,
    source_adapter_uri: FORK_SOURCE,
    llm_model_id: 'it-http-api',
    force_update: true
  });
  const items = (reply.body['items'] as Array<Record<string, unknown>> | undefined) ?? [];
  const first = items[0] ?? {};
  const adapterUri = typeof first['adapter_uri'] === 'string' ? (first['adapter_uri'] as string) : '';
  const layerUuid = typeof first['layer_uuid'] === 'string' ? (first['layer_uuid'] as string) : '';
  return {
    status: reply.status,
    body: reply.body,
    slug: adapterUri.replace('squadrules://adapter/', ''),
    layerUuid
  };
}

/** Real `POST /api/export` for one adapter URI (current head unless `version`). */
export async function exportMarkdown(
  server: ChildApiServer,
  uri: string,
  version?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  return server.post('/api/export', {
    uri,
    format: 'markdown',
    ...(version !== undefined ? { version } : {})
  });
}
