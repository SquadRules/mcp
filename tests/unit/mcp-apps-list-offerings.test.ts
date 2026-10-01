import { buildListOfferingsForUIResult } from '../../src/mcp-apps/list-offerings-for-ui.js';
import {
  KAIROS_ACTIVATE_UI_SKYBRIDGE_URI,
  KAIROS_ACTIVATE_UI_URI,
  KAIROS_FORWARD_UI_SKYBRIDGE_URI,
  KAIROS_FORWARD_UI_URI,
  KAIROS_SPACES_UI_SKYBRIDGE_URI,
  KAIROS_UI_RESOURCE_URI_FLAT_META_KEY,
  MCP_APP_HTML_MIME_TYPE,
  SKYBRIDGE_HTML_MIME_TYPE
} from '../../src/mcp-apps/kairos-ui-constants.js';

describe('buildListOfferingsForUIResult', () => {
  test('includes spaces, forward, and activate tools with ui resourceUri, flat meta key, and matching resource entries', () => {
    const r = buildListOfferingsForUIResult();
    expect(r.prompts).toHaveLength(0);
    expect(r.tools).toHaveLength(3);
    expect(r.resources).toHaveLength(12);

    const spacesTool = r.tools.find((x) => (x as { name?: string }).name === 'spaces') as {
      name?: string;
      _meta?: { ui?: { resourceUri?: string } } & Record<string, string | undefined>;
    };
    expect(spacesTool?.name).toBe('spaces');
    expect(spacesTool?._meta?.ui?.resourceUri).toBe('ui://kairos/spaces-result');
    expect(spacesTool?._meta?.[KAIROS_UI_RESOURCE_URI_FLAT_META_KEY]).toBe('ui://kairos/spaces-result');

    const forwardTool = r.tools.find((x) => (x as { name?: string }).name === 'forward') as {
      name?: string;
      _meta?: { ui?: { resourceUri?: string } } & Record<string, string | undefined>;
    };
    expect(forwardTool?.name).toBe('forward');
    expect(forwardTool?._meta?.ui?.resourceUri).toBe(KAIROS_FORWARD_UI_URI);
    expect(forwardTool?._meta?.[KAIROS_UI_RESOURCE_URI_FLAT_META_KEY]).toBe(KAIROS_FORWARD_UI_URI);

    const activateTool = r.tools.find((x) => (x as { name?: string }).name === 'activate') as {
      name?: string;
      _meta?: { ui?: { resourceUri?: string } } & Record<string, string | undefined>;
    };
    expect(activateTool?.name).toBe('activate');
    expect(activateTool?._meta?.ui?.resourceUri).toBe(KAIROS_ACTIVATE_UI_URI);
    expect(activateTool?._meta?.[KAIROS_UI_RESOURCE_URI_FLAT_META_KEY]).toBe(KAIROS_ACTIVATE_UI_URI);

    const resSpaces = r.resources.find((x) => (x as { uri?: string }).uri === 'ui://kairos/spaces-result') as {
      uri?: string;
      mimeType?: string;
    };
    expect(resSpaces?.mimeType).toBe(MCP_APP_HTML_MIME_TYPE);

    const resSpacesSky = r.resources.find(
      (x) => (x as { uri?: string }).uri === KAIROS_SPACES_UI_SKYBRIDGE_URI
    ) as { uri?: string; mimeType?: string };
    expect(resSpacesSky?.mimeType).toBe(SKYBRIDGE_HTML_MIME_TYPE);

    const resForward = r.resources.find((x) => (x as { uri?: string }).uri === KAIROS_FORWARD_UI_URI) as {
      uri?: string;
      mimeType?: string;
    };
    expect(resForward?.mimeType).toBe(MCP_APP_HTML_MIME_TYPE);

    const resForwardSky = r.resources.find(
      (x) => (x as { uri?: string }).uri === KAIROS_FORWARD_UI_SKYBRIDGE_URI
    ) as { uri?: string; mimeType?: string };
    expect(resForwardSky?.mimeType).toBe(SKYBRIDGE_HTML_MIME_TYPE);

    const resActivate = r.resources.find((x) => (x as { uri?: string }).uri === KAIROS_ACTIVATE_UI_URI) as {
      uri?: string;
      mimeType?: string;
    };
    expect(resActivate?.mimeType).toBe(MCP_APP_HTML_MIME_TYPE);

    const resActivateSky = r.resources.find(
      (x) => (x as { uri?: string }).uri === KAIROS_ACTIVATE_UI_SKYBRIDGE_URI
    ) as { uri?: string; mimeType?: string };
    expect(resActivateSky?.mimeType).toBe(SKYBRIDGE_HTML_MIME_TYPE);
  });
});
