import { getResource, getResources } from './embedded-mcp-resources.js';
import { logger } from '../utils/structured-logger.js';
import { getResourceAnnotations } from './resource-annotations.js';
import { getResourceIcons } from './resource-icons.js';
import { getResourceDescription } from './resource-descriptions.js';

function mdOrFallback(uri: any, text?: string, notFound: string = 'Document not found') {
  return {
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: text || `# ${notFound}` }]
  };
}

export function registerDocsResources(server: any) {
  logger.debug('registering docs resources from embedded resources');

  const resources = getResources();
  const toTitle = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

  // Handle both flat resources (directly in resources/) and nested resources (in subdirectories)
  for (const [key, value] of Object.entries(resources)) {
    if (typeof value === 'string') {
      // Flat resource: treat as if in 'doc' subdirectory
      const subdir = 'doc';
      const filename = key;
      const prefix = `squadrules://${subdir}`;
      const uri = `${prefix}/${filename}`;
      const name = toTitle(filename);
      const resourceDesc = getResourceDescription(subdir, filename, name);
      const description = resourceDesc.description;
      const annotations = getResourceAnnotations(subdir, filename);
      const icons = getResourceIcons(subdir);

      server.registerResource(
        `${subdir}-${filename}`,
        uri,
        {
          name,
          title: resourceDesc.title || name,
          description,
          mimeType: 'text/markdown',
          annotations,
          icons
        },
        (uriObj: any) => {
          const resourceContent = getResource(filename);
          return mdOrFallback(uriObj, resourceContent);
        }
      );
    } else if (typeof value === 'object' && value !== null) {
      // Nested resource: subdirectory structure (doc, mem, etc.)
      const subdir = key;
      const prefix = `squadrules://${subdir}`;

      // Iterate through files in this subdirectory
      for (const [filename, content] of Object.entries(value)) {
        if (typeof content === 'string') {
          const uri = `${prefix}/${filename}`;
          const name = toTitle(filename);
          const resourceDesc = getResourceDescription(subdir, filename, name);
          const description = resourceDesc.description;
          const annotations = getResourceAnnotations(subdir, filename);
          const icons = getResourceIcons(subdir);

          server.registerResource(
            `${subdir}-${filename}`,
            uri,
            {
              name,
              title: resourceDesc.title || name,
              description,
              mimeType: 'text/markdown',
              annotations,
              icons
            },
            (uriObj: any) => {
              const resourceContent = getResource(`${subdir}.${filename}`);
              return mdOrFallback(uriObj, resourceContent);
            }
          );
        }
      }
    }
  }

  // Tools docs are not registered as resources to keep resources/list lean.
}
