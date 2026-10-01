import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  KAIROS_ACTIVATE_UI_SKYBRIDGE_URI,
  KAIROS_ACTIVATE_UI_URI,
  MCP_APP_HTML_MIME_TYPE,
  SKYBRIDGE_HTML_MIME_TYPE,
  SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI,
  SQUADRULES_ACTIVATE_UI_URI
} from './kairos-ui-constants.js';
import { buildActivateWidgetHtml } from './activate-widget-html.js';

function readActivateWidget(uri: string, mimeType: string) {
  const text = buildActivateWidgetHtml();
  return {
    contents: [{ uri, mimeType, text }]
  };
}

/** Registers MCP App and Skybridge HTML resources for the activate chat widget (prior + SquadRules URIs). */
export function registerActivateUiResources(server: McpServer): void {
  server.registerResource(
    'kairos-activate-widget',
    KAIROS_ACTIVATE_UI_URI,
    {
      title: 'KAIROS activate result',
      description: 'Inline view for the activate tool (ranked choices, roles, next_action).',
      mimeType: MCP_APP_HTML_MIME_TYPE
    },
    () => readActivateWidget(KAIROS_ACTIVATE_UI_URI, MCP_APP_HTML_MIME_TYPE)
  );

  server.registerResource(
    'kairos-activate-widget-skybridge',
    KAIROS_ACTIVATE_UI_SKYBRIDGE_URI,
    {
      title: 'KAIROS activate result (Skybridge profile)',
      description: 'Same activate widget with text/html+skybridge for hosts that require that profile.',
      mimeType: SKYBRIDGE_HTML_MIME_TYPE
    },
    () => readActivateWidget(KAIROS_ACTIVATE_UI_SKYBRIDGE_URI, SKYBRIDGE_HTML_MIME_TYPE)
  );

  // SquadRules-branded aliases serve the same widget HTML under new URIs.
  server.registerResource(
    'squadrules-activate-widget',
    SQUADRULES_ACTIVATE_UI_URI,
    {
      title: 'SquadRules activate result',
      description: 'Inline view for the activate tool (ranked choices, roles, next_action).',
      mimeType: MCP_APP_HTML_MIME_TYPE
    },
    () => readActivateWidget(SQUADRULES_ACTIVATE_UI_URI, MCP_APP_HTML_MIME_TYPE)
  );

  server.registerResource(
    'squadrules-activate-widget-skybridge',
    SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI,
    {
      title: 'SquadRules activate result (Skybridge profile)',
      description: 'Same activate widget with text/html+skybridge for hosts that require that profile.',
      mimeType: SKYBRIDGE_HTML_MIME_TYPE
    },
    () => readActivateWidget(SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI, SKYBRIDGE_HTML_MIME_TYPE)
  );
}
