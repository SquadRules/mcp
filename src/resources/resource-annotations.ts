/**
 * Resource annotations for SquadRules MCP resources.
 *
 * Annotations provide metadata about resources based on the MCP 2026-07-28 spec:
 * - audience: Who the resource is intended for ('user' | 'assistant')
 * - priority: Numeric priority (higher = more important, 0.0-1.0 normalized)
 * - lastModified: ISO 8601 timestamp of last modification
 *
 * These help agents decide which resources to consult first.
 */

export interface ResourceAnnotations {
  audience?: ('user' | 'assistant')[];
  priority?: number;
  lastModified?: string;
}

/**
 * Annotations for each resource category.
 * 
 * Embedded docs are assistant-facing (used by agents to understand the system)
 * and versioned with the codebase. Priority reflects how often agents should
 * consult each resource type.
 */
export const RESOURCE_ANNOTATIONS: Record<string, ResourceAnnotations> = {
  // Tools documentation: high priority, assistant-facing
  'tools': {
    audience: ['assistant'],
    priority: 0.9,
    lastModified: new Date().toISOString()
  },
  // Mem documentation: medium priority, assistant-facing
  'mem': {
    audience: ['assistant'],
    priority: 0.7,
    lastModified: new Date().toISOString()
  },
  // Meta documentation: medium priority, assistant-facing
  'meta': {
    audience: ['assistant'],
    priority: 0.6,
    lastModified: new Date().toISOString()
  },
  // General resources: lower priority
  'resources': {
    audience: ['assistant'],
    priority: 0.5,
    lastModified: new Date().toISOString()
  },
  // Templates: low priority, assistant-facing
  'templates': {
    audience: ['assistant'],
    priority: 0.4,
    lastModified: new Date().toISOString()
  }
} as const;

/**
 * Get annotations for a resource by category and filename.
 * Falls back to category-level annotations if no specific override exists.
 */
export function getResourceAnnotations(category: string, _filename?: string): ResourceAnnotations {
  return RESOURCE_ANNOTATIONS[category] || {
    audience: ['assistant'],
    priority: 0.5,
    lastModified: new Date().toISOString()
  };
}
