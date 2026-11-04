import { z, toJSONSchema } from 'zod';

// JSON Schema type for tool input/output - must have type: "object" for v2 SDK
export interface ToolJsonSchema {
  type?: 'object' | string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

const EMPTY_OBJECT_JSON_SCHEMA: ToolJsonSchema = {
  type: 'object',
  properties: {}
};

export function zodToInputJsonSchema(schema: z.ZodTypeAny): ToolJsonSchema {
  try {
    const jsonSchema = toJSONSchema(schema, {
      io: 'input'
    }) as ToolJsonSchema;
    // Ensure type is preserved
    if (!jsonSchema.type) {
      jsonSchema.type = 'object';
    }
    return jsonSchema;
  } catch {
    // Fallback to empty schema
  }
  return EMPTY_OBJECT_JSON_SCHEMA;
}

export function zodToOutputJsonSchema(schema: z.ZodTypeAny): ToolJsonSchema {
  try {
    const jsonSchema = toJSONSchema(schema, {
      io: 'output'
    }) as ToolJsonSchema;
    // Ensure type is preserved
    if (!jsonSchema.type) {
      jsonSchema.type = 'object';
    }
    return jsonSchema;
  } catch {
    // Fallback to empty schema
  }
  return EMPTY_OBJECT_JSON_SCHEMA;
}
