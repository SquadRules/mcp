/**
 * Resource descriptions for SquadRules MCP resources.
 *
 * Provides real descriptions (not template-derived) for resources.
 * Descriptions are sourced from the document's H1 + first paragraph where possible,
 * or hand-written where that is not meaningful.
 */

export interface ResourceDescription {
  description: string;
  title?: string;
}

/**
 * Descriptions for each resource by category and filename.
 * 
 * These replace the template "Documentation for ${name}" with meaningful
 * descriptions that help agents decide which resources to consult.
 */
export const RESOURCE_DESCRIPTIONS: Record<string, Record<string, ResourceDescription>> = {
  tools: {
    activate: {
      title: 'Activate Tool Guide',
      description: 'Rank stored adapters for user intent and return the next forward call arguments. Use this tool to find the best-matching adapter for any action, task, or workflow.'
    },
    forward: {
      title: 'Forward Tool Guide',
      description: 'Execute the next step in an adapter workflow. Copy the forward_first_call from activate results directly into this tool to advance the chain.'
    },
    train: {
      title: 'Train Tool Guide',
      description: 'Create or update adapters in the local store. Use this to teach SquadRules new workflows or refine existing ones with better instructions.'
    },
    reward: {
      title: 'Reward Tool Guide',
      description: 'Record success or failure signals for adapter executions. Helps the system learn which adapters work best for different scenarios.'
    },
    tune: {
      title: 'Tune Tool Guide',
      description: 'Update existing adapter content layer by layer. Use this to refine adapter instructions without creating a new adapter from scratch.'
    },
    delete: {
      title: 'Delete Tool Guide',
      description: 'Remove adapters or specific layers from the store. Use with caution as deletion is permanent.'
    },
    export: {
      title: 'Export Tool Guide',
      description: 'Export adapter or training data in various formats. Use this to backup adapters, share them, or inspect their structure.'
    },
    spaces: {
      title: 'Spaces Tool Guide',
      description: 'List available spaces and adapter counts. Shows the organizational structure for adapters (personal, shared, group spaces).'
    }
  },
  mem: {
    'adapter-migration': {
      title: 'Adapter Migration Guide',
      description: 'Procedures for migrating adapters between versions or systems. Covers data format changes and version continuity.'
    },
    'author-adapter': {
      title: 'Authoring Adapters',
      description: 'Step-by-step guide for creating new adapters from scratch. Covers structure, best practices, and testing.'
    },
    'bulk-insert-adapters-via-cli': {
      title: 'Bulk Adapter Insertion',
      description: 'Command-line methods for inserting multiple adapters at once. Useful for initial setup or large-scale imports.'
    },
    'challenge-type-guide': {
      title: 'Challenge Type Guide',
      description: 'Explanation of challenge types in SquadRules and how they affect adapter selection and execution.'
    },
    'critic-loop-guide': {
      title: 'Critic Loop Guide',
      description: 'Overview of the critic loop pattern for iterative refinement. Shows how adapters can self-improve through feedback.'
    },
    'critic-loop': {
      title: 'Critic Loop Implementation',
      description: 'Technical details of critic loop implementation. Covers the activate-forward-reward cycle for self-improvement.'
    },
    'protocol-linking-guide': {
      title: 'Protocol Linking Guide',
      description: 'How to link adapters together using protocol references. Enables composition of complex workflows from simple adapters.'
    },
    'README': {
      title: 'Memory Documentation',
      description: 'Overview of the SquadRules memory system and adapter storage. Entry point for understanding how adapters are organized.'
    },
    'refine-search': {
      title: 'Search Refinement',
      description: 'Techniques for refining adapter searches when initial results are weak. Covers query improvement and space filtering.'
    }
  },
  meta: {
    // Meta resources are keyed by slug, descriptions can be added as needed
  },
  resources: {
    // General resources can be added here
  },
  templates: {
    // Template resources can be added here
  }
} as const;

/**
 * Get description for a resource by category and filename.
 * Falls back to a generated description if no specific override exists.
 */
export function getResourceDescription(category: string, filename: string, fallbackName: string): ResourceDescription {
  const categoryDescs = RESOURCE_DESCRIPTIONS[category];
  if (categoryDescs && categoryDescs[filename]) {
    return categoryDescs[filename]!;
  }
  
  // Fallback: generate a reasonable description from the name
  return {
    title: fallbackName,
    description: `SquadRules ${category} documentation: ${fallbackName}`
  };
}
