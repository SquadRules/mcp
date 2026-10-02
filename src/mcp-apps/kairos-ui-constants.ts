/**
 * MCP Apps (SEP-1865) identifiers for KAIROS / SquadRules.
 *
 * Host-owned chrome (tool row icon, connector tile) is outside MCP; branding
 * here applies to server-delivered HTML inside the chat widget iframe only.
 *
 * Both `ui://kairos/*` (prior) and `ui://squadrules/*` (new) URIs are
 * registered as available resources. The prior URIs remain the values used
 * in tools/list `_meta.ui.resourceUri` for this release because hosts cache
 * them aggressively.
 */
export const KAIROS_SPACES_UI_URI = 'ui://kairos/spaces-result' as const;

/** SquadRules-branded alias for {@link KAIROS_SPACES_UI_URI}. */
export const SQUADRULES_SPACES_UI_URI = 'ui://squadrules/spaces-result' as const;

/**
 * Same spaces widget HTML as {@link KAIROS_SPACES_UI_URI} for hosts that expect
 * the Skybridge-style HTML MIME profile (mirrors common `ui://open-ai/...` URIs).
 */
export const KAIROS_SPACES_UI_SKYBRIDGE_URI = 'ui://open-ai/kairos/spaces-result' as const;

/** SquadRules-branded alias for {@link KAIROS_SPACES_UI_SKYBRIDGE_URI}. */
export const SQUADRULES_SPACES_UI_SKYBRIDGE_URI = 'ui://open-ai/squadrules/spaces-result' as const;

/** MCP Apps HTML resource for inline `forward` tool results. */
export const KAIROS_FORWARD_UI_URI = 'ui://kairos/forward-result' as const;

/** SquadRules-branded alias for {@link KAIROS_FORWARD_UI_URI}. */
export const SQUADRULES_FORWARD_UI_URI = 'ui://squadrules/forward-result' as const;

/** Same forward widget with Skybridge HTML MIME profile. */
export const KAIROS_FORWARD_UI_SKYBRIDGE_URI = 'ui://open-ai/kairos/forward-result' as const;

/** SquadRules-branded alias for {@link KAIROS_FORWARD_UI_SKYBRIDGE_URI}. */
export const SQUADRULES_FORWARD_UI_SKYBRIDGE_URI = 'ui://open-ai/squadrules/forward-result' as const;

/** MCP Apps HTML resource for inline `activate` tool results (adapter choices). */
export const KAIROS_ACTIVATE_UI_URI = 'ui://kairos/activate-result' as const;

/** SquadRules-branded alias for {@link KAIROS_ACTIVATE_UI_URI}. */
export const SQUADRULES_ACTIVATE_UI_URI = 'ui://squadrules/activate-result' as const;

/** Same activate widget with Skybridge HTML MIME profile. */
export const KAIROS_ACTIVATE_UI_SKYBRIDGE_URI = 'ui://open-ai/kairos/activate-result' as const;

/** SquadRules-branded alias for {@link KAIROS_ACTIVATE_UI_SKYBRIDGE_URI}. */
export const SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI = 'ui://open-ai/squadrules/activate-result' as const;

/**
 * Flat `resourceUri` metadata key mirrored beside `_meta.ui.resourceUri` for hosts
 * that expect the shape normalized by `@modelcontextprotocol/ext-apps` `registerAppTool`.
 */
export const KAIROS_UI_RESOURCE_URI_FLAT_META_KEY = 'ui/resourceUri' as const;

/** `forward` tool: MCP Apps widget binding (tools/list + registerTool). */
export const KAIROS_FORWARD_TOOL_UI_META = {
  ui: {
    resourceUri: KAIROS_FORWARD_UI_URI,
    visibility: ['model', 'app'] as const
  },
  [KAIROS_UI_RESOURCE_URI_FLAT_META_KEY]: KAIROS_FORWARD_UI_URI
} as const;

/** `activate` tool: MCP Apps widget binding (tools/list + registerTool). */
export const KAIROS_ACTIVATE_TOOL_UI_META = {
  ui: {
    resourceUri: KAIROS_ACTIVATE_UI_URI,
    visibility: ['model', 'app'] as const
  },
  [KAIROS_UI_RESOURCE_URI_FLAT_META_KEY]: KAIROS_ACTIVATE_UI_URI
} as const;

/** `spaces` tool: MCP Apps widget binding (tools/list + registerTool). */
export const KAIROS_SPACES_TOOL_UI_META = {
  ui: {
    resourceUri: KAIROS_SPACES_UI_URI,
    visibility: ['model', 'app'] as const
  },
  [KAIROS_UI_RESOURCE_URI_FLAT_META_KEY]: KAIROS_SPACES_UI_URI
} as const;

/** SEP-1865 extension id (`io.modelcontextprotocol/ui`). */
export const MCP_UI_EXTENSION_ID = 'io.modelcontextprotocol/ui' as const;

/** MVP MCP Apps HTML MIME type (matches `@modelcontextprotocol/ext-apps` RESOURCE_MIME_TYPE). */
export const MCP_APP_HTML_MIME_TYPE = 'text/html;profile=mcp-app' as const;

/** Skybridge / OpenAI-style widget HTML MIME type (same document shape, different profile). */
export const SKYBRIDGE_HTML_MIME_TYPE = 'text/html+skybridge' as const;

// ---------------------------------------------------------------------------
// SquadRules-branded tool _meta bindings (available for future switch-over)
// ---------------------------------------------------------------------------

/**
 * `forward` tool: SquadRules-branded widget binding.
 *
 * @public Retained for the planned KAIROS -> SquadRules URI switch-over; not yet imported.
 */
export const SQUADRULES_FORWARD_TOOL_UI_META = {
  ui: {
    resourceUri: SQUADRULES_FORWARD_UI_URI,
    visibility: ['model', 'app'] as const
  },
  [KAIROS_UI_RESOURCE_URI_FLAT_META_KEY]: SQUADRULES_FORWARD_UI_URI
} as const;

/**
 * `activate` tool: SquadRules-branded widget binding.
 *
 * @public Retained for the planned KAIROS -> SquadRules URI switch-over; not yet imported.
 */
export const SQUADRULES_ACTIVATE_TOOL_UI_META = {
  ui: {
    resourceUri: SQUADRULES_ACTIVATE_UI_URI,
    visibility: ['model', 'app'] as const
  },
  [KAIROS_UI_RESOURCE_URI_FLAT_META_KEY]: SQUADRULES_ACTIVATE_UI_URI
} as const;

/**
 * `spaces` tool: SquadRules-branded widget binding.
 *
 * @public Retained for the planned KAIROS -> SquadRules URI switch-over; not yet imported.
 */
export const SQUADRULES_SPACES_TOOL_UI_META = {
  ui: {
    resourceUri: SQUADRULES_SPACES_UI_URI,
    visibility: ['model', 'app'] as const
  },
  [KAIROS_UI_RESOURCE_URI_FLAT_META_KEY]: SQUADRULES_SPACES_UI_URI
} as const;
