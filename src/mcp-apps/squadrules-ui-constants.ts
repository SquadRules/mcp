/**
 * MCP Apps (SEP-1865) identifiers for SquadRules.
 *
 * Host-owned chrome (tool row icon, connector tile) is outside MCP; branding
 * here applies to server-delivered HTML inside the chat widget iframe only.
 *
 * `ui://squadrules/*` are the MCP resource URIs served by this server and
 * referenced from tools/list `_meta.ui.resourceUri`.
 */
export const SQUADRULES_SPACES_UI_URI = 'ui://squadrules/spaces-result' as const;

/**
 * Same spaces widget HTML as {@link SQUADRULES_SPACES_UI_URI} for hosts that expect
 * the Skybridge-style HTML MIME profile (mirrors common `ui://open-ai/...` URIs).
 */
export const SQUADRULES_SPACES_UI_SKYBRIDGE_URI = 'ui://open-ai/squadrules/spaces-result' as const;

/** MCP Apps HTML resource for inline `forward` tool results. */
export const SQUADRULES_FORWARD_UI_URI = 'ui://squadrules/forward-result' as const;

/** Same forward widget with Skybridge HTML MIME profile. */
export const SQUADRULES_FORWARD_UI_SKYBRIDGE_URI = 'ui://open-ai/squadrules/forward-result' as const;

/** MCP Apps HTML resource for inline `activate` tool results (adapter choices). */
export const SQUADRULES_ACTIVATE_UI_URI = 'ui://squadrules/activate-result' as const;

/** Same activate widget with Skybridge HTML MIME profile. */
export const SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI = 'ui://open-ai/squadrules/activate-result' as const;

/**
 * Flat `resourceUri` metadata key mirrored beside `_meta.ui.resourceUri` for hosts
 * that expect the shape normalized by `@modelcontextprotocol/ext-apps` `registerAppTool`.
 */
export const SQUADRULES_UI_RESOURCE_URI_FLAT_META_KEY = 'ui/resourceUri' as const;

/** `forward` tool: MCP Apps widget binding (tools/list + registerTool). */
export const SQUADRULES_FORWARD_TOOL_UI_META = {
  ui: {
    resourceUri: SQUADRULES_FORWARD_UI_URI,
    visibility: ['model', 'app'] as const
  },
  [SQUADRULES_UI_RESOURCE_URI_FLAT_META_KEY]: SQUADRULES_FORWARD_UI_URI
} as const;

/** `activate` tool: MCP Apps widget binding (tools/list + registerTool). */
export const SQUADRULES_ACTIVATE_TOOL_UI_META = {
  ui: {
    resourceUri: SQUADRULES_ACTIVATE_UI_URI,
    visibility: ['model', 'app'] as const
  },
  [SQUADRULES_UI_RESOURCE_URI_FLAT_META_KEY]: SQUADRULES_ACTIVATE_UI_URI
} as const;

/** `spaces` tool: MCP Apps widget binding (tools/list + registerTool). */
export const SQUADRULES_SPACES_TOOL_UI_META = {
  ui: {
    resourceUri: SQUADRULES_SPACES_UI_URI,
    visibility: ['model', 'app'] as const
  },
  [SQUADRULES_UI_RESOURCE_URI_FLAT_META_KEY]: SQUADRULES_SPACES_UI_URI
} as const;

/** SEP-1865 extension id (`io.modelcontextprotocol/ui`). */
export const MCP_UI_EXTENSION_ID = 'io.modelcontextprotocol/ui' as const;

/** MVP MCP Apps HTML MIME type (matches `@modelcontextprotocol/ext-apps` RESOURCE_MIME_TYPE). */
export const MCP_APP_HTML_MIME_TYPE = 'text/html;profile=mcp-app' as const;

/** Skybridge / OpenAI-style widget HTML MIME type (same document shape, different profile). */
export const SKYBRIDGE_HTML_MIME_TYPE = 'text/html+skybridge' as const;
