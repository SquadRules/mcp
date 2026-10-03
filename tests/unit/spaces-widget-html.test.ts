import { describe, expect, it, test } from '@jest/globals';
import { buildSpacesWidgetHtml } from '../../src/mcp-apps/spaces-mcp-app-widget-html.js';
import { renderSpacesWidgetHtml } from '../../src/mcp-apps/spaces-widget-html.js';

describe('renderSpacesWidgetHtml', () => {
  it('escapes angle brackets in titles and names', () => {
    const html = renderSpacesWidgetHtml([
      {
        name: '<script>',
        space_id: 'user:r:x',
        type: 'personal',
        adapter_count: 1,
        adapters: [{ adapter_id: 'a1', title: '<b>evil</b>', layer_count: 2 }]
      }
    ]);
    expect(html).not.toMatch(/<script>/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
  });

  it('renders type badge and adapter details', () => {
    const html = renderSpacesWidgetHtml([
      {
        name: 'Group: Team',
        space_id: 'group:r:team',
        type: 'group',
        adapter_count: 1,
        adapters: [{ adapter_id: 'uuid-here', title: 'Demo', layer_count: 3 }]
      }
    ]);
    expect(html).toMatch(/Group/);
    expect(html).toMatch(/Personal|Group|App|Other/);
    expect(html).toContain('Demo');
    expect(html).toContain('details');
  });
});

describe('buildSpacesWidgetHtml', () => {
  test('includes MCP Apps handshake and tool-result handling', () => {
    const html = buildSpacesWidgetHtml();
    expect(html).toContain('ui/initialize');
    expect(html).toContain('ui/notifications/initialized');
    expect(html).toContain('ui/notifications/tool-result');
    expect(html).toContain('renderSpacesTable');
    expect(html).toContain('squadrules-spaces-view');
    expect(html).toContain('ui/notifications/host-context-changed');
    expect(html).toContain('paintHostContext');
    expect(html).toContain('data-theme');
    expect(html).toContain('html.dark');
    expect(html).toContain("classList.add('dark')");
    expect(html).toContain('squadrules-spaces-root');
    expect(html).toContain('space-row-personal');
    expect(html).toContain('space-display-name');
    expect(html).toContain('space-type-badge--personal');
    expect(html).toContain('Space name');
    expect(html).toContain('Kind');
    expect(html).toContain('spaceTypeKey');
    expect(html).not.toContain('<!DOCTYPE html>');
  });
});
