import type { GetPromptResult, Prompt } from '@modelcontextprotocol/server';
import { getPrompts, getPrompt } from './embedded-mcp-resources.js';
import { logger } from '../utils/structured-logger.js';
import { getPromptIcons } from './prompt-icons.js';
import { getPromptMetadata } from './prompt-metadata.js';
import { buildEmbeddedDocsCacheMetadata, buildServerInfoMeta } from '../utils/pagination.js';

type PromptOverride = {
  title?: string;
  description?: string;
  resultDescription?: string;
};

const promptOverrides: Record<string, PromptOverride> = {};

type RegisteredPrompt = Prompt & {
  resultDescription: string;
  text: string;
  icons?: Array<{ src: string; mimeType: string; sizes: string[] }>;
};

function formatPromptTitle(key: string): string {
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function buildRegisteredPrompt(key: string, text: string): RegisteredPrompt {
  const override = promptOverrides[key] ?? {};
  const title = override.title ?? formatPromptTitle(key);
  const fallbackDescription = `Prompt: ${title}`;
  const metadata = getPromptMetadata(key, fallbackDescription);
  const description = override.description ?? metadata.description;
  const icons = getPromptIcons(key);

  return {
    name: key,
    title,
    description,
    resultDescription: override.resultDescription ?? description,
    text,
    icons,
    ...(metadata.arguments && metadata.arguments.length > 0 ? { arguments: metadata.arguments } : {})
  };
}

/** Prompt entries for `prompts/list`-shaped surfaces (for example `listOfferingsForUI`). */
export function listPromptOfferings(): Prompt[] {
  const prompts = getPrompts() as Record<string, string>;
  return Object.entries(prompts).map(([key, text]) => {
    const { name, title, description, icons, arguments: args } = buildRegisteredPrompt(key, text);
    return {
      name,
      title,
      description,
      ...(icons ? { icons } : {}),
      ...(args && args.length > 0 ? { arguments: args } : {})
    };
  });
}

/**
 * Register all prompts from embedded-mcp-resources.
 * Always installs prompts/list and prompts/get handlers, even when no prompts
 * are registered, so the server can respond to those MCP methods without error.
 */
export function registerPromptResources(server: any) {
  logger.debug('registering prompts from embedded resources');

  const prompts = getPrompts() as Record<string, string>;
  let anyRegistered = false;

  for (const [key, text] of Object.entries(prompts)) {
    const prompt = buildRegisteredPrompt(key, text);

    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        ...(prompt.icons ? { icons: prompt.icons } : {})
      },
      async (): Promise<GetPromptResult> => {
        const promptText = getPrompt(prompt.name) ?? prompt.text;
        const cacheMetadata = buildEmbeddedDocsCacheMetadata();
        const result: GetPromptResult = {
          resultType: 'complete',
          description: prompt.resultDescription,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: promptText
              }
            }
          ],
          ttlMs: cacheMetadata.ttlMs,
          cacheScope: cacheMetadata.cacheScope,
          _meta: buildServerInfoMeta()
        } as any;

        return result;
      }
    );
    anyRegistered = true;
  }

  // Ensure prompts/list and prompts/get handlers are always installed, even
  // when no prompts are registered. The SDK lazily installs these handlers on
  // the first registerPrompt call; without this bootstrap the server would
  // advertise prompts capability but return Method not found.
  if (!anyRegistered) {
    const placeholder = server.registerPrompt(
      '__squadrules_internal_bootstrap_prompt__',
      { title: 'bootstrap', description: 'internal bootstrap prompt' },
      async (): Promise<GetPromptResult> => ({
        messages: [{ role: 'user', content: { type: 'text', text: '' } }]
      })
    );
    placeholder.remove();
  }
}
