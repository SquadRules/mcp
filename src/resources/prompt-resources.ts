import type { GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js';
import { getPrompts, getPrompt } from './embedded-mcp-resources.js';
import { logger } from '../utils/structured-logger.js';

type PromptOverride = {
  title?: string;
  description?: string;
  resultDescription?: string;
};

const promptOverrides: Record<string, PromptOverride> = {};

type RegisteredPrompt = Prompt & {
  resultDescription: string;
  text: string;
};

function formatPromptTitle(key: string): string {
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function buildRegisteredPrompt(key: string, text: string): RegisteredPrompt {
  const override = promptOverrides[key] ?? {};
  const title = override.title ?? formatPromptTitle(key);
  const description = override.description ?? `Prompt: ${title}`;

  return {
    name: key,
    title,
    description,
    resultDescription: override.resultDescription ?? description,
    text
  };
}

/** Prompt entries for `prompts/list`-shaped surfaces (for example `listOfferingsForUI`). */
export function listPromptOfferings(): Prompt[] {
  const prompts = getPrompts() as Record<string, string>;
  return Object.entries(prompts).map(([key, text]) => {
    const { name, title, description } = buildRegisteredPrompt(key, text);
    return { name, title, description };
  });
}

/**
 * Register all prompts from embedded-mcp-resources
 */
export function registerPromptResources(server: any) {
  logger.debug('registering prompts from embedded resources');

  const prompts = getPrompts() as Record<string, string>;

  for (const [key, text] of Object.entries(prompts)) {
    const prompt = buildRegisteredPrompt(key, text);

    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description
      },
      async (): Promise<GetPromptResult> => {
        const promptText = getPrompt(prompt.name) ?? prompt.text;
        const result: GetPromptResult = {
          description: prompt.resultDescription,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: promptText
              }
            }
          ]
        };

        return result;
      }
    );
  }
}
