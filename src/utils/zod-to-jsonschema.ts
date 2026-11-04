// v2 migration: zod-compat utilities removed, using direct zod JSON schema conversion
import type { z } from 'zod';

const EMPTY_OBJECT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {}
};

// TODO: v2 migration - these utilities need replacement
// For now, return empty schema as placeholder
export function zodToInputJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // In v2, use standard JSON schema conversion or SDK utilities
  try {
    // Try to use zod's built-in JSON schema if available
    if ('jsonSchema' in schema && typeof schema.jsonSchema === 'function') {
      return schema.jsonSchema() as Record<string, unknown>;
    }
  } catch {
    // Fallback to empty schema
  }
  return EMPTY_OBJECT_JSON_SCHEMA;
}

export function zodToOutputJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    if ('jsonSchema' in schema && typeof schema.jsonSchema === 'function') {
      return schema.jsonSchema() as Record<string, unknown>;
    }
  } catch {
    // Fallback to empty schema
  }
  return EMPTY_OBJECT_JSON_SCHEMA;
}
