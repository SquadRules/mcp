// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Ensures the MCP server has resource handlers wired up even when no public
 * resources or templates are registered. Without this bootstrap, the SDK
 * refuses to expose resources/* methods and returns Method not found.
 */
export function bootstrapEmptyResourceHandlers(server: any) {
  // Register a throwaway resource to trigger handler installation, then remove it.
  const placeholderUri = 'kairos://__internal__/bootstrap';
  const placeholderResource = server.registerResource(
    '__kairos_internal_bootstrap_resource__',
    placeholderUri,
    {
      title: 'bootstrap',
      description: 'internal bootstrap resource',
      mimeType: 'text/plain'
    },
    () => ({
      contents: [{ uri: placeholderUri, mimeType: 'text/plain', text: '' }]
    })
  );
  placeholderResource.remove();

  // Same trick for resource templates so /resources/templates/list stays available.
  const template = new ResourceTemplate('kairos://__internal__/bootstrap/{id}', {
    async list() {
      return { resources: [] };
    }
  });
  const placeholderTemplate = server.registerResource(
    '__kairos_internal_bootstrap_template__',
    template,
    {
      title: 'bootstrap template',
      description: 'internal bootstrap template',
      mimeType: 'text/plain'
    },
    async () => ({
      contents: []
    })
  );
  placeholderTemplate.remove();
}

