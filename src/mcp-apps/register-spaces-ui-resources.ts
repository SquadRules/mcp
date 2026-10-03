import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SQUADRULES_SPACES_UI_SKYBRIDGE_URI,
  SQUADRULES_SPACES_UI_URI,
  MCP_APP_HTML_MIME_TYPE,
  SKYBRIDGE_HTML_MIME_TYPE
} from './squadrules-ui-constants.js';
import { buildSpacesWidgetHtml } from './spaces-mcp-app-widget-html.js';

function readSpacesWidget(uri: string, mimeType: string) {
  const text = buildSpacesWidgetHtml();
  return {
    contents: [{ uri, mimeType, text }]
  };
}

/** Registers MCP App and Skybridge HTML resources for the spaces chat widget. */
export function registerSpacesUiResources(server: McpServer): void {
  server.registerResource(
    'squadrules-spaces-widget',
    SQUADRULES_SPACES_UI_URI,
    {
      title: 'SquadRules spaces result',
      description: 'Branded inline view for the spaces tool (MCP Apps HTML profile).',
      mimeType: MCP_APP_HTML_MIME_TYPE
    },
    () => readSpacesWidget(SQUADRULES_SPACES_UI_URI, MCP_APP_HTML_MIME_TYPE)
  );

  server.registerResource(
    'squadrules-spaces-widget-skybridge',
    SQUADRULES_SPACES_UI_SKYBRIDGE_URI,
    {
      title: 'SquadRules spaces result (Skybridge profile)',
      description: 'Same spaces widget with text/html+skybridge for hosts that require that profile.',
      mimeType: SKYBRIDGE_HTML_MIME_TYPE
    },
    () => readSpacesWidget(SQUADRULES_SPACES_UI_SKYBRIDGE_URI, SKYBRIDGE_HTML_MIME_TYPE)
  );
}
