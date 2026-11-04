// v2 migration: zod-compat utilities removed, using direct zod JSON schema conversion
import type { z } from 'zod';

// JSON Schema type for tool input/output - must have type: "object" for v2 SDK
export interface ToolJsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

const EMPTY_OBJECT_JSON_SCHEMA: ToolJsonSchema = {
  type: 'object',
  properties: {}
};

// TODO: v2 migration - these utilities need replacement
// For now, return empty schema as placeholder
export function zodToInputJsonSchema(schema: z.ZodTypeAny): ToolJsonSchema {
  // In v2, use standard JSON schema conversion or SDK utilities
  try {
    // Try to use zod's built-in JSON schema if available
    if ('jsonSchema' in schema && typeof schema.jsonSchema === 'function') {
      const result = schema.jsonSchema() as ToolJsonSchema;
      // Ensure type is preserved
      if (!result.type) {
        result.type = 'object';
      }
      return result;
    }
  } catch {
    // Fallback to empty schema
  }
  return EMPTY_OBJECT_JSON_SCHEMA;
}

export function zodToOutputJsonSchema(schema: z.ZodTypeAny): ToolJsonSchema {
  try {
    if ('jsonSchema' in schema && typeof schema.jsonSchema === 'function') {
      const result = schema.jsonSchema() as ToolJsonSchema;
      // Ensure type is preserved
      if (!result.type) {
        result.type = 'object';
      }
      return result;
    }
  } catch {
    // Fallback to empty schema
  }
  return EMPTY_OBJECT_JSON_SCHEMA;
}
