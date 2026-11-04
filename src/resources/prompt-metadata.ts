/**
 * Prompt metadata for SquadRules MCP prompts.
 *
 * Provides real descriptions (not template-derived) and argument declarations
 * for prompts. This helps hosts render parameterized commands and gives agents
 * better context about what each prompt does.
 */

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptMetadata {
  description: string;
  arguments?: PromptArgument[];
}

/**
 * Metadata for each prompt.
 * 
 * Descriptions are sourced from the prompt's purpose and first paragraph.
 * Arguments are declared for prompts that accept parameters.
 */
export const PROMPT_METADATA: Record<string, PromptMetadata> = {
  // Example entries - extend as prompts are added
  // 'example-prompt': {
  //   description: 'Generates a structured response for common queries.',
  //   arguments: [
  //     { name: 'query', description: 'The user query to respond to', required: true },
  //     { name: 'format', description: 'Output format (text|markdown|json)', required: false }
  //   ]
  // }
} as const;

/**
 * Get metadata for a prompt by name.
 * Returns default metadata if no specific override exists.
 */
export function getPromptMetadata(promptName: string, fallbackDescription: string): PromptMetadata {
  return PROMPT_METADATA[promptName] || {
    description: fallbackDescription,
    arguments: []
  };
}
