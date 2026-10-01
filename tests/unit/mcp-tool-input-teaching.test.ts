import { describe, expect, test } from '@jest/globals';
import { forwardInputSchema, forwardMcpWireInputSchema } from '../../src/tools/forward_schema.js';
import { activateInputSchema } from '../../src/tools/activate_schema.js';
import { buildMcpInputTeachingPayload } from '../../src/tools/mcp-tool-input-teaching.js';

describe('mcp-tool-input-teaching', () => {
  const LAYER_WITH_EXEC = 'kairos://layer/00000000-0000-0000-0000-000000000002?execution_id=00000000-0000-0000-0000-000000000003';

  test('forward MCP wire schema accepts empty object so handler can teach', () => {
    const wire = forwardMcpWireInputSchema.safeParse({});
    expect(wire.success).toBe(true);
  });

  test('forward missing uri includes next_action and INVALID_TOOL_INPUT', () => {
    const parsed = forwardInputSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const body = buildMcpInputTeachingPayload('forward', parsed.error, {});
    expect(body.error).toBe('INVALID_TOOL_INPUT');
    expect(body.tool).toBe('forward');
    expect(body.must_obey).toBe(true);
    expect(String(body.message)).toContain('Input validation error');
    expect(String(body.next_action)).toContain('forward');
    expect(String(body.next_action)).toContain('uri');
    expect(body.example).toBeDefined();
    expect(body.retry_count).toBeDefined();
    expect(body.max_retries).toBe(3);
  });

  test('forward continuation call without solution explains continuation requirement', () => {
    const parsed = forwardInputSchema.safeParse({ uri: LAYER_WITH_EXEC });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const body = buildMcpInputTeachingPayload('forward', parsed.error, { uri: LAYER_WITH_EXEC });
    expect(body.error).toBe('INVALID_TOOL_INPUT');
    expect(Array.isArray(body.invalid_fields) ? body.invalid_fields : []).toContain('solution');
    expect(String(body.message)).toContain('solution');
    expect(body.example).toBeDefined();
  });

  test('forward continuation call without solution.type includes explicit guidance', () => {
    const parsed = forwardInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      solution: { shell: { exit_code: 0 } }
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const body = buildMcpInputTeachingPayload('forward', parsed.error, {
      uri: LAYER_WITH_EXEC,
      solution: { shell: { exit_code: 0 } }
    });
    expect(body.error).toBe('INVALID_TOOL_INPUT');
    expect(String(body.message)).toContain('solution.type');
    expect(String(body.next_action)).toContain('solution.type');
    expect(body.example).toBeDefined();
  });

  test('forward start call with solution teaches omit solution on start', () => {
    const ADAPTER_URI = 'kairos://adapter/phase-critic';
    const parsed = forwardInputSchema.safeParse({
      uri: ADAPTER_URI,
      solution: { type: 'comment', comment: { text: 'x' } }
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const body = buildMcpInputTeachingPayload('forward', parsed.error, {});
    expect(body.error).toBe('INVALID_TOOL_INPUT');
    expect(String(body.message)).toContain('Omit `solution` when starting');
    expect(String(body.next_action)).toMatch(/Omit `solution`/i);
    expect(body.example).toBeDefined();
  });

  test('forward adapter UUID input is now accepted (dual-scheme compat)', () => {
    // UUID adapter URIs are valid after the rebrand dual-scheme support;
    // no teaching payload is needed.
    const parsed = forwardInputSchema.safeParse({
      uri: 'kairos://adapter/00000000-0000-0000-0000-000000000001'
    });
    expect(parsed.success).toBe(true);
  });

  test('teaching payloads include structured example across tools', () => {
    const parsed = activateInputSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const activateErr = buildMcpInputTeachingPayload('activate', parsed.error, {});
    expect(activateErr.example).toBeDefined();
  });
});
