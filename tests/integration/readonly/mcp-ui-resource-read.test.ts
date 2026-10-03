/**
 * MCP Apps: resources/read for ui://squadrules/spaces-result returns HTML profile mcp-app.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import {
  SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI,
  SQUADRULES_FORWARD_UI_SKYBRIDGE_URI,
  SQUADRULES_SPACES_UI_SKYBRIDGE_URI,
  MCP_APP_HTML_MIME_TYPE,
  SKYBRIDGE_HTML_MIME_TYPE
} from '../../../src/mcp-apps/squadrules-ui-constants.js';
import { withRawOnFail } from '../../utils/expect-with-raw.js';

describe('MCP UI resource read (spaces widget)', () => {
  let mcpConnection: { client: Client; close: () => Promise<void> } | undefined;

  beforeAll(async () => {
    mcpConnection = await createMcpConnection();
  });

  afterAll(async () => {
    if (mcpConnection) {
      await mcpConnection.close();
    }
  });

  test('resources/read ui://squadrules/spaces-result returns HTML with Squadrules branding', async () => {
    const result = await mcpConnection.client.readResource({ uri: 'ui://squadrules/spaces-result' });
    withRawOnFail(result, () => {
      expect(result.contents?.length).toBeGreaterThan(0);
      const c = result.contents![0];
      expect(c.uri).toBe('ui://squadrules/spaces-result');
      expect(c.mimeType).toBe(MCP_APP_HTML_MIME_TYPE);
      expect(typeof c.text).toBe('string');
      expect(c.text).toContain('squadrules-spaces-root');
      expect(c.text).toContain('SQUADRULES');
      expect(c.text).toContain('ui/notifications/tool-result');
      expect(c.text).toContain('ui/initialize');
      expect(c.text).toContain('ui/notifications/initialized');
      expect(c.text).toContain('ui/notifications/host-context-changed');
    }, 'resources/read ui widget');
  });

  test('resources/read Skybridge URI returns same widget with text/html+skybridge', async () => {
    const result = await mcpConnection.client.readResource({ uri: SQUADRULES_SPACES_UI_SKYBRIDGE_URI });
    withRawOnFail(result, () => {
      expect(result.contents?.length).toBeGreaterThan(0);
      const c = result.contents![0];
      expect(c.uri).toBe(SQUADRULES_SPACES_UI_SKYBRIDGE_URI);
      expect(c.mimeType).toBe(SKYBRIDGE_HTML_MIME_TYPE);
      expect(typeof c.text).toBe('string');
      expect(c.text).toContain('ui/initialize');
      expect(c.text).toContain('SQUADRULES');
    }, 'resources/read skybridge widget');
  });

  test('resources/read ui://squadrules/forward-result returns forward MCP App HTML', async () => {
    const result = await mcpConnection.client.readResource({ uri: 'ui://squadrules/forward-result' });
    withRawOnFail(result, () => {
      expect(result.contents?.length).toBeGreaterThan(0);
      const c = result.contents![0];
      expect(c.uri).toBe('ui://squadrules/forward-result');
      expect(c.mimeType).toBe(MCP_APP_HTML_MIME_TYPE);
      expect(typeof c.text).toBe('string');
      expect(c.text).toContain('squadrules-forward-view');
      expect(c.text).toContain('isForwardStructured');
      expect(c.text).toContain('background:transparent');
    }, 'resources/read forward widget');
  });

  test('resources/read forward Skybridge URI returns text/html+skybridge', async () => {
    const result = await mcpConnection.client.readResource({ uri: SQUADRULES_FORWARD_UI_SKYBRIDGE_URI });
    withRawOnFail(result, () => {
      expect(result.contents?.length).toBeGreaterThan(0);
      const c = result.contents![0];
      expect(c.uri).toBe(SQUADRULES_FORWARD_UI_SKYBRIDGE_URI);
      expect(c.mimeType).toBe(SKYBRIDGE_HTML_MIME_TYPE);
      expect(c.text).toContain('squadrules-forward-view');
    }, 'resources/read forward skybridge');
  });

  test('resources/read ui://squadrules/activate-result returns activate MCP App HTML', async () => {
    const result = await mcpConnection.client.readResource({ uri: 'ui://squadrules/activate-result' });
    withRawOnFail(result, () => {
      expect(result.contents?.length).toBeGreaterThan(0);
      const c = result.contents![0];
      expect(c.uri).toBe('ui://squadrules/activate-result');
      expect(c.mimeType).toBe(MCP_APP_HTML_MIME_TYPE);
      expect(typeof c.text).toBe('string');
      expect(c.text).toContain('squadrules-activate-view');
      expect(c.text).toContain('isActivateStructured');
    }, 'resources/read activate widget');
  });

  test('resources/read activate Skybridge URI returns text/html+skybridge', async () => {
    const result = await mcpConnection.client.readResource({ uri: SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI });
    withRawOnFail(result, () => {
      expect(result.contents?.length).toBeGreaterThan(0);
      const c = result.contents![0];
      expect(c.uri).toBe(SQUADRULES_ACTIVATE_UI_SKYBRIDGE_URI);
      expect(c.mimeType).toBe(SKYBRIDGE_HTML_MIME_TYPE);
      expect(c.text).toContain('squadrules-activate-view');
    }, 'resources/read activate skybridge');
  });
});
