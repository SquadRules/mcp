/**
 * Adapter-document builders for the HTTP compare-and-swap suite.
 *
 * Extracted from `http-api-graph-cas.test.ts` to keep per-file line counts
 * within the ESLint `max-lines` budget; behavior is unchanged.
 */
import { httpAdapterDoc, shellContract } from './http-api-graph-docs.js';

export function adapterDocument(body: string, title = 'Http Cas Adapter'): string {
  return httpAdapterDoc({
    title,
    sections: [{ heading: 'Step', body }],
    contract: shellContract('echo cas-step')
  });
}

/**
 * The same document shape with a second contract fence, so the writer produces a
 * two-layer adapter (`layer_index` 1 and 2) under one H1.
 */
export function twoLayerDocument(title: string): string {
  const secondLayer = [
    '## Second Step',
    '',
    'second-step-body',
    '',
    '```json',
    JSON.stringify({ contract: shellContract('echo cas-second-step') }),
    '```',
    '',
    '## Reward Signal'
  ].join('\n');
  return adapterDocument('first-step-body', title).replace('## Reward Signal', secondLayer);
}
