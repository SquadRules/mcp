// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
/** Canonical layer URIs and the transitional older layer-row form in tool copy. */
const LAYER_URI_IN_MESSAGE = new RegExp(
  `kairos://(?:layer|${['me', 'm'].join('')})/[0-9a-f-]{36}`,
  'gi'
);

export function rewriteTuneMessage(message: string, layerUri: string): string {
  return message
    .replace(/\bmemory\b/gi, (match) => (match[0] === 'M' ? 'Adapter layer' : 'adapter layer'))
    .replace(LAYER_URI_IN_MESSAGE, layerUri);
}

export function buildTuneResultMessage(
  entry: { status: 'updated' | 'error'; message: string },
  layerUri: string
): string {
  if (entry.status === 'updated') {
    return `Adapter layer ${layerUri} updated successfully`;
  }

  return rewriteTuneMessage(entry.message, layerUri);
}
