import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SQUADRULES_FORWARD_UI_SKYBRIDGE_URI,
  SQUADRULES_FORWARD_UI_URI,
  MCP_APP_HTML_MIME_TYPE,
  SKYBRIDGE_HTML_MIME_TYPE
} from './squadrules-ui-constants.js';
import { buildForwardWidgetHtml } from './forward-widget-html.js';

function readForwardWidget(uri: string, mimeType: string) {
  const text = buildForwardWidgetHtml();
  return {
    contents: [{ uri, mimeType, text }]
  };
}

/** Registers MCP App and Skybridge HTML resources for the forward chat widget. */
export function registerForwardUiResources(server: McpServer): void {
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
      description: 'Same forward widget (header, step title, progress) with text/html+skybridge for hosts that require that profile.',
      mimeType: SKYBRIDGE_HTML_MIME_TYPE
    },
    () => readForwardWidget(SQUADRULES_FORWARD_UI_SKYBRIDGE_URI, SKYBRIDGE_HTML_MIME_TYPE)
  );
}
