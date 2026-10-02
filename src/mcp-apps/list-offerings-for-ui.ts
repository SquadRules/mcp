// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * `listOfferingsForUI` is not in core MCP; some chat hosts call it to prefetch
 * widget-capable tools and UI resources. Shapes mirror tools/list and UIResource
 * listings (SEP-1865 / MCP Apps).
 */
import type { Prompt } from '@modelcontextprotocol/sdk/types.js';
import { resolveToolDoc } from '../utils/mcp-tool-doc-runtime.js';
import { zodToInputJsonSchema, zodToOutputJsonSchema } from '../utils/zod-to-jsonschema.js';
import { listPromptOfferings } from '../resources/prompt-resources.js';
import { activateInputSchema, activateOutputSchema } from '../tools/activate_schema.js';
import { forwardInputSchema, forwardOutputSchema } from '../tools/forward_schema.js';
import { spacesInputSchema, spacesOutputSchema } from '../tools/spaces_schema.js';
import {
  KAIROS_ACTIVATE_TOOL_UI_META,
  KAIROS_ACTIVATE_UI_SKYBRIDGE_URI,
  KAIROS_ACTIVATE_UI_URI,
  KAIROS_FORWARD_TOOL_UI_META,
  KAIROS_FORWARD_UI_SKYBRIDGE_URI,
  KAIROS_FORWARD_UI_URI,
  KAIROS_SPACES_TOOL_UI_META,
  KAIROS_SPACES_UI_SKYBRIDGE_URI,
  KAIROS_SPACES_UI_URI,
  MCP_APP_HTML_MIME_TYPE,
  SKYBRIDGE_HTML_MIME_TYPE,
  SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI,
  SQUADRULES_ACTIVATE_UI_URI,
  SQUADRULES_FORWARD_UI_SKYBRIDGE_URI,
  SQUADRULES_FORWARD_UI_URI,
  SQUADRULES_SPACES_UI_SKYBRIDGE_URI,
  SQUADRULES_SPACES_UI_URI
} from './kairos-ui-constants.js';

const SPACES_TOOL_NAME = 'spaces';
const FORWARD_TOOL_NAME = 'forward';
const ACTIVATE_TOOL_NAME = 'activate';

/** Tool entry aligned with tools/list for the spaces tool including MCP Apps metadata. */
export function buildSpacesToolOffering(): Record<string, unknown> {
  return {
    name: SPACES_TOOL_NAME,
    title: 'List spaces and adapter counts',
    description:
      resolveToolDoc('spaces') ??
      "List the agent's available spaces with human-readable names and adapter counts.",
    inputSchema: zodToInputJsonSchema(spacesInputSchema),
    outputSchema: zodToOutputJsonSchema(spacesOutputSchema),
    _meta: KAIROS_SPACES_TOOL_UI_META
  };
}

/** Tool entry for `forward` including MCP Apps widget metadata. */
export function buildForwardToolOffering(): Record<string, unknown> {
  return {
    name: FORWARD_TOOL_NAME,
    title: 'Run adapter forward pass',
    description:
      resolveToolDoc('forward') ?? 'Run the first or next adapter layer. Omit `solution` on the first call in a run.',
    inputSchema: zodToInputJsonSchema(forwardInputSchema),
    outputSchema: zodToOutputJsonSchema(forwardOutputSchema),
    _meta: KAIROS_FORWARD_TOOL_UI_META
  };
}

/** Tool entry for `activate` including MCP Apps widget metadata. */
export function buildActivateToolOffering(): Record<string, unknown> {
  return {
    name: ACTIVATE_TOOL_NAME,
    title: 'Activate the best adapter',
    description:
      resolveToolDoc('activate') ??
      'Find the best adapter for the current input and return ranked activation choices.',
    inputSchema: zodToInputJsonSchema(activateInputSchema),
    outputSchema: zodToOutputJsonSchema(activateOutputSchema),
    _meta: KAIROS_ACTIVATE_TOOL_UI_META
  };
}

/** UI resource for the activate widget (mcp-app profile). */
export function buildActivateUiResourceOffering(): Record<string, unknown> {
  return {
    uri: KAIROS_ACTIVATE_UI_URI,
    name: 'SQUADRULES activate result',
    description: 'Branded inline view for the activate tool (choices, roles, next_action).',
    mimeType: MCP_APP_HTML_MIME_TYPE,
    _meta: {
      ui: {
        prefersBorder: true
      }
    }
  };
}

/** Activate widget with Skybridge MIME profile. */
export function buildActivateSkybridgeResourceOffering(): Record<string, unknown> {
  return {
    uri: KAIROS_ACTIVATE_UI_SKYBRIDGE_URI,
    name: 'SQUADRULES activate result (Skybridge profile)',
    description: 'Same activate widget markup with text/html+skybridge.',
    mimeType: SKYBRIDGE_HTML_MIME_TYPE,
    _meta: {
      ui: {
        prefersBorder: true
      }
    }
  };
}

/** UI resource for the forward widget (mcp-app profile). */
export function buildForwardUiResourceOffering(): Record<string, unknown> {
  return {
    uri: KAIROS_FORWARD_UI_URI,
    name: 'SQUADRULES forward result',
    description: 'Branded inline view for the forward tool (adapter, space, current layer).',
    mimeType: MCP_APP_HTML_MIME_TYPE,
    _meta: {
      ui: {
        prefersBorder: true
      }
    }
  };
}

/** Forward widget with Skybridge MIME profile. */
export function buildForwardSkybridgeResourceOffering(): Record<string, unknown> {
  return {
    uri: KAIROS_FORWARD_UI_SKYBRIDGE_URI,
    name: 'SQUADRULES forward result (Skybridge profile)',
    description: 'Same forward widget markup with text/html+skybridge.',
    mimeType: SKYBRIDGE_HTML_MIME_TYPE,
    _meta: {
      ui: {
        prefersBorder: true
      }
    }
  };
}

/** UI resource entry for listings (uri, name, mimeType, optional _meta.ui). */
export function buildSpacesUiResourceOffering(): Record<string, unknown> {
  return {
    uri: KAIROS_SPACES_UI_URI,
    name: 'SQUADRULES spaces result',
    description: 'Branded inline view for the spaces tool (logo + structured JSON).',
    mimeType: MCP_APP_HTML_MIME_TYPE,
    _meta: {
      ui: {
        prefersBorder: true
      }
    }
  };
}

/** Same widget HTML with Skybridge MIME profile for alternate hosts. */
export function buildSpacesSkybridgeResourceOffering(): Record<string, unknown> {
  return {
    uri: KAIROS_SPACES_UI_SKYBRIDGE_URI,
    name: 'SQUADRULES spaces result (Skybridge profile)',
    description: 'Same spaces widget markup with text/html+skybridge.',
    mimeType: SKYBRIDGE_HTML_MIME_TYPE,
    _meta: {
      ui: {
        prefersBorder: true
      }
    }
  };
}

// ---------------------------------------------------------------------------
// SquadRules-branded resource offerings (same HTML, new URIs)
// ---------------------------------------------------------------------------

/** SquadRules activate widget (mcp-app profile). */
export function buildSquadRulesActivateUiResourceOffering(): Record<string, unknown> {
  return {
    uri: SQUADRULES_ACTIVATE_UI_URI,
    name: 'SquadRules activate result',
    description: 'Branded inline view for the activate tool (choices, roles, next_action).',
    mimeType: MCP_APP_HTML_MIME_TYPE,
    _meta: { ui: { prefersBorder: true } }
  };
}

/** SquadRules activate widget (Skybridge profile). */
export function buildSquadRulesActivateSkybridgeResourceOffering(): Record<string, unknown> {
  return {
    uri: SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI,
    name: 'SquadRules activate result (Skybridge profile)',
    description: 'Same activate widget markup with text/html+skybridge.',
    mimeType: SKYBRIDGE_HTML_MIME_TYPE,
    _meta: { ui: { prefersBorder: true } }
  };
}

/** SquadRules forward widget (mcp-app profile). */
export function buildSquadRulesForwardUiResourceOffering(): Record<string, unknown> {
  return {
    uri: SQUADRULES_FORWARD_UI_URI,
    name: 'SquadRules forward result',
    description: 'Branded inline view for the forward tool (adapter, space, current layer).',
    mimeType: MCP_APP_HTML_MIME_TYPE,
    _meta: { ui: { prefersBorder: true } }
  };
}

/** SquadRules forward widget (Skybridge profile). */
export function buildSquadRulesForwardSkybridgeResourceOffering(): Record<string, unknown> {
  return {
    uri: SQUADRULES_FORWARD_UI_SKYBRIDGE_URI,
    name: 'SquadRules forward result (Skybridge profile)',
    description: 'Same forward widget markup with text/html+skybridge.',
    mimeType: SKYBRIDGE_HTML_MIME_TYPE,
    _meta: { ui: { prefersBorder: true } }
  };
}

/** SquadRules spaces widget (mcp-app profile). */
export function buildSquadRulesSpacesUiResourceOffering(): Record<string, unknown> {
  return {
    uri: SQUADRULES_SPACES_UI_URI,
    name: 'SquadRules spaces result',
    description: 'Branded inline view for the spaces tool (logo + structured JSON).',
    mimeType: MCP_APP_HTML_MIME_TYPE,
    _meta: { ui: { prefersBorder: true } }
  };
}

/** SquadRules spaces widget (Skybridge profile). */
export function buildSquadRulesSpacesSkybridgeResourceOffering(): Record<string, unknown> {
  return {
    uri: SQUADRULES_SPACES_UI_SKYBRIDGE_URI,
    name: 'SquadRules spaces result (Skybridge profile)',
    description: 'Same spaces widget markup with text/html+skybridge.',
    mimeType: SKYBRIDGE_HTML_MIME_TYPE,
    _meta: { ui: { prefersBorder: true } }
  };
}

export function buildListOfferingsForUIResult(): {
  tools: Record<string, unknown>[];
  prompts: Prompt[];
  resources: Record<string, unknown>[];
} {
  return {
    tools: [buildSpacesToolOffering(), buildForwardToolOffering(), buildActivateToolOffering()],
    prompts: listPromptOfferings(),
    resources: [
      buildSpacesUiResourceOffering(),
      buildSpacesSkybridgeResourceOffering(),
      buildForwardUiResourceOffering(),
      buildForwardSkybridgeResourceOffering(),
      buildActivateUiResourceOffering(),
      buildActivateSkybridgeResourceOffering(),
      // SquadRules-branded aliases (same HTML, new URIs)
      buildSquadRulesSpacesUiResourceOffering(),
      buildSquadRulesSpacesSkybridgeResourceOffering(),
      buildSquadRulesForwardUiResourceOffering(),
      buildSquadRulesForwardSkybridgeResourceOffering(),
      buildSquadRulesActivateUiResourceOffering(),
      buildSquadRulesActivateSkybridgeResourceOffering()
    ]
  };
}
