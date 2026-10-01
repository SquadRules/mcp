import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  KAIROS_FORWARD_UI_SKYBRIDGE_URI,
  KAIROS_FORWARD_UI_URI,
  MCP_APP_HTML_MIME_TYPE,
  SKYBRIDGE_HTML_MIME_TYPE,
  SQUADRULES_FORWARD_UI_SKYBRIDGE_URI,
  SQUADRULES_FORWARD_UI_URI
} from './kairos-ui-constants.js';
import { buildForwardWidgetHtml } from './forward-widget-html.js';

function readForwardWidget(uri: string, mimeType: string) {
  const text = buildForwardWidgetHtml();
  return {
    contents: [{ uri, mimeType, text }]
  };
}

/** Registers MCP App and Skybridge HTML resources for the forward chat widget (prior + SquadRules URIs). */
export function registerForwardUiResources(server: McpServer): void {
  server.registerResource(
    'kairos-forward-widget',
    KAIROS_FORWARD_UI_URI,
    {
      title: 'KAIROS forward result',
      description: 'Inline view for the forward tool (KAIROS • Protocol: …, Running step: …, progress).',
      mimeType: MCP_APP_HTML_MIME_TYPE
    },
    () => readForwardWidget(KAIROS_FORWARD_UI_URI, MCP_APP_HTML_MIME_TYPE)
  );

  server.registerResource(
    'kairos-forward-widget-skybridge',
    KAIROS_FORWARD_UI_SKYBRIDGE_URI,
    {
      title: 'KAIROS forward result (Skybridge profile)',
      description: 'Same forward widget (header, step title, progress) with text/html+skybridge for hosts that require that profile.',
      mimeType: SKYBRIDGE_HTML_MIME_TYPE
    },
    () => readForwardWidget(KAIROS_FORWARD_UI_SKYBRIDGE_URI, SKYBRIDGE_HTML_MIME_TYPE)
  );

  // SquadRules-branded aliases serve the same widget HTML under new URIs.
  server.registerResource(
    'squadrules-forward-widget',
    SQUADRULES_FORWARD_UI_URI,
    {
      title: 'SquadRules forward result',
      description: 'Inline view for the forward tool (SquadRules • Protocol: …, Running step: …, progress).',
      mimeType: MCP_APP_HTML_MIME_TYPE
    },
    () => readForwardWidget(SQUADRULES_FORWARD_UI_URI, MCP_APP_HTML_MIME_TYPE)
  );

  server.registerResource(
    'squadrules-forward-widget-skybridge',
    SQUADRULES_FORWARD_UI_SKYBRIDGE_URI,
    {
      title: 'SquadRules forward result (Skybridge profile)',
      description: 'Same forward widget with text/html+skybridge for hosts that require that profile.',
      mimeType: SKYBRIDGE_HTML_MIME_TYPE
    },
    () => readForwardWidget(SQUADRULES_FORWARD_UI_SKYBRIDGE_URI, SKYBRIDGE_HTML_MIME_TYPE)
  );
}
