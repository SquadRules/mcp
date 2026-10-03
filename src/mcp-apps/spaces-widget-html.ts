/**
 * Optional HTML summary for the spaces tool (MCP hosts that render HTML in tool content).
 * All dynamic text is escaped to avoid injection from adapter titles or space names.
 */

export interface SpacesWidgetSpaceRow {
  name: string;
  space_id: string;
  type: 'personal' | 'group' | 'app' | 'other';
  adapter_count: number;
  adapters?: Array<{ adapter_id: string; title: string; layer_count: number }>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TYPE_LABEL: Record<SpacesWidgetSpaceRow['type'], string> = {
  personal: 'Personal',
  group: 'Group',
  app: 'App',
  other: 'Other'
};

/**
 * Renders a compact HTML table with type badges and expandable adapter lists when
 * `adapters` are present. This remains available for hosts that still render
 * HTML directly from tool content.
 */
export function renderSpacesWidgetHtml(spaces: SpacesWidgetSpaceRow[]): string {
  const rows = spaces
    .map((sp) => {
      const badge = esc(TYPE_LABEL[sp.type] ?? sp.type);
      const name = esc(sp.name);
      const count = String(sp.adapter_count);
      const sid = esc(sp.space_id);
      const inner =
        sp.adapters && sp.adapters.length > 0
          ? `<ul style="margin:0.25em 0 0 1em;padding:0;">${sp.adapters
              .map(
                (a) =>
                  `<li>${esc(a.title)} <span style="opacity:0.75">(${esc(a.adapter_id)}) - ${String(a.layer_count)} layers</span></li>`
              )
              .join('')}</ul>`
          : '';
      const details =
        inner.length > 0
          ? `<details style="margin-top:0.25em;"><summary style="cursor:pointer;">Adapters (${String(sp.adapters!.length)})</summary>${inner}</details>`
          : '';
      const personalHighlight =
        sp.type === 'personal'
          ? 'border-left:3px solid #2563eb;padding-left:0.5em;'
          : '';
      const nameSize = sp.type === 'personal' ? '1.05rem' : '1rem';
      return `<tr>
  <td style="vertical-align:top;padding:0.3em 0.45em;border-bottom:1px solid #ddd;${personalHighlight}"><span style="font-weight:700;font-size:${nameSize};letter-spacing:-0.02em;">${name}</span><div style="font-size:0.85em;opacity:0.8;margin-top:0.15em;">${sid}</div></td>
  <td style="vertical-align:top;padding:0.3em 0.45em;border-bottom:1px solid #ddd;"><span style="display:inline-block;padding:0.12em 0.38em;border-radius:4px;background:#eef;font-size:0.85em;">${badge}</span></td>
  <td style="vertical-align:top;padding:0.3em 0.45em;border-bottom:1px solid #ddd;text-align:right;">${count}</td>
  <td style="vertical-align:top;padding:0.3em 0.45em;border-bottom:1px solid #ddd;">${details}</td>
</tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Spaces</title></head><body>
<section aria-label="SQUADRULES spaces">
  <table style="border-collapse:collapse;width:100%;max-width:56rem;font-family:system-ui,sans-serif;font-size:14px;">
    <thead><tr>
      <th style="text-align:left;padding:0.3em 0.45em;border-bottom:2px solid #333;">Space</th>
      <th style="text-align:left;padding:0.3em 0.45em;border-bottom:2px solid #333;">Type</th>
      <th style="text-align:right;padding:0.3em 0.45em;border-bottom:2px solid #333;">Adapters</th>
      <th style="text-align:left;padding:0.3em 0.45em;border-bottom:2px solid #333;">Details</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:0.5em;font-size:12px;opacity:0.75;">Use <code>activate</code> / <code>train</code> / <code>tune</code> with the same space names or ids. Prefer explicit adapter URIs when multiple protocols share a label.</p>
</section>
</body></html>`;
}
