// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  KAIROS_SPACES_UI_SKYBRIDGE_URI,
  KAIROS_SPACES_UI_URI,
  MCP_APP_HTML_MIME_TYPE,
  SKYBRIDGE_HTML_MIME_TYPE,
  SQUADRULES_SPACES_UI_SKYBRIDGE_URI,
  SQUADRULES_SPACES_UI_URI
} from './kairos-ui-constants.js';
import { buildSpacesWidgetHtml } from './spaces-mcp-app-widget-html.js';

function readSpacesWidget(uri: string, mimeType: string) {
  const text = buildSpacesWidgetHtml();
  return {
    contents: [{ uri, mimeType, text }]
  };
}

/** Registers MCP App and Skybridge HTML resources for the spaces chat widget (prior + SquadRules URIs). */
export function registerSpacesUiResources(server: McpServer): void {
  server.registerResource(
    'kairos-spaces-widget',
    KAIROS_SPACES_UI_URI,
    {
      title: 'SQUADRULES spaces result',
      description: 'Branded inline view for the spaces tool (MCP Apps HTML profile).',
      mimeType: MCP_APP_HTML_MIME_TYPE
    },
    () => readSpacesWidget(KAIROS_SPACES_UI_URI, MCP_APP_HTML_MIME_TYPE)
  );

  server.registerResource(
    'kairos-spaces-widget-skybridge',
    KAIROS_SPACES_UI_SKYBRIDGE_URI,
    {
      title: 'SQUADRULES spaces result (Skybridge profile)',
      description: 'Same spaces widget with text/html+skybridge for hosts that require that profile.',
      mimeType: SKYBRIDGE_HTML_MIME_TYPE
    },
    () => readSpacesWidget(KAIROS_SPACES_UI_SKYBRIDGE_URI, SKYBRIDGE_HTML_MIME_TYPE)
  );

  // SquadRules-branded aliases serve the same widget HTML under new URIs.
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
