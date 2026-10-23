/**
 * Helpers for assertions on tool inputSchema as returned by MCP tools/list.
 * Some tools register a Zod union (strict shape + passthrough) so the JSON Schema
 * may be anyOf/oneOf rather than a single type: object.
 */

export function isLikelyToolInputJsonSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const s = schema as Record<string, unknown>;
  if (s.type === 'object') return true;
  if (Array.isArray(s.anyOf) && s.anyOf.length > 0) return true;
  if (Array.isArray(s.oneOf) && s.oneOf.length > 0) return true;
  return false;
}

/**
 * MCP SDK `tools/list` normalizes Zod to an object schema before JSON Schema conversion.
 * A top-level `z.union` (for example `mcpLooseToolInput(strict)`) is not treated as an object, so the
 * listed input schema becomes `{ type: 'object', properties: {} }` with no field hints.
 */
export function isMcpListedEmptyObjectParamsSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const s = schema as Record<string, unknown>;
  if (s.type !== 'object' || !s.properties || typeof s.properties !== 'object') return false;
  return Object.keys(s.properties as Record<string, unknown>).length === 0;
}

/** True if some object branch of the schema defines all given property names. */
export function schemaHasObjectBranchWithProps(schema: unknown, propNames: string[]): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const s = schema as Record<string, unknown>;
  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    const p = s.properties as Record<string, unknown>;
    return propNames.every((k) => Object.prototype.hasOwnProperty.call(p, k));
  }
  if (Array.isArray(s.anyOf)) {
    return s.anyOf.some((b) => schemaHasObjectBranchWithProps(b, propNames));
  }
  if (Array.isArray(s.oneOf)) {
    return s.oneOf.some((b) => schemaHasObjectBranchWithProps(b, propNames));
  }
  return false;
}

/**
 * True when at least one object branch exposes the nested property path.
 * Example: ['solution', 'forward', 'success'].
 */
export function schemaHasPropertyPath(schema: unknown, path: string[]): boolean {
  if (!schema || typeof schema !== 'object' || path.length === 0) return false;
  const s = schema as Record<string, unknown>;
  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    const [head, ...tail] = path;
    const props = s.properties as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(props, head)) return false;
    if (tail.length === 0) return true;
    return schemaHasPropertyPath(props[head], tail);
  }
  if (Array.isArray(s.anyOf)) {
    return s.anyOf.some((b) => schemaHasPropertyPath(b, path));
  }
  if (Array.isArray(s.oneOf)) {
    return s.oneOf.some((b) => schemaHasPropertyPath(b, path));
  }
  return false;
}
