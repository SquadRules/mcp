// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
import { MCP_APP_HTML_MIME_TYPE, MCP_UI_EXTENSION_ID, SKYBRIDGE_HTML_MIME_TYPE } from './kairos-ui-constants.js';

/**
 * Advertised on initialize so MCP Apps-capable hosts can treat UI resources as supported.
 * Unknown keys may be ignored by older clients; hosts that implement SEP-1865 read `extensions`.
 */
export const kairosServerUiCapabilityBlock = {
  extensions: {
    [MCP_UI_EXTENSION_ID]: {
      mimeTypes: [MCP_APP_HTML_MIME_TYPE, SKYBRIDGE_HTML_MIME_TYPE]
    }
  }
} as const;
