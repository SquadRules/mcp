// squadrules-compat-surface: imports/references a retained prior-brand-named module or path (source filenames are an explicit non-goal)
/**
 * Unit tests for buildChallengeShapeForDisplay: MCP output schema safety for stored proofs.
 */

import { describe, expect, jest, test } from '@jest/globals';
import { buildChallengeShapeForDisplay } from '../../src/tools/kairos-challenge-display.js';
import { structuredLogger } from '../../src/utils/structured-logger.js';

describe('buildChallengeShapeForDisplay', () => {
  test('undefined type defaults to shell challenge shape', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      shell: { cmd: 'echo hi', timeout_seconds: 5 }
    } as any);
    expect(shape.type).toBe('shell');
    expect(shape.shell).toMatchObject({ cmd: 'echo hi', timeout_seconds: 5 });
    expect(String(shape.description)).toMatch(/shell/i);
  });

  test('shell challenge includes interpreter and invocation_display', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'shell',
      shell: {
        cmd: 'print 1',
        timeout_seconds: 5,
        interpreter: 'perl',
        flags: ['-e']
      }
    } as any);
    expect(shape.type).toBe('shell');
    expect((shape.shell as any).interpreter).toBe('perl');
    expect((shape.shell as any).invocation_display).toBeDefined();
    expect(String(shape.description)).toContain('perl');
    expect(String(shape.description)).toContain('PATH');
  });

  test('mcp challenge includes arguments in payload and description', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'mcp',
      mcp: { tool_name: 'activate', arguments: { query: 'x' } }
    } as any);
    expect(shape.type).toBe('mcp');
    expect((shape.mcp as Record<string, unknown>).arguments).toEqual({ query: 'x' });
    expect(String(shape.description)).toContain('subset');
  });

  test('invalid stored type is coerced to comment with valid schema fields', () => {
    const warn = jest.spyOn(structuredLogger, 'warn').mockImplementation(() => {});

    const shape = buildChallengeShapeForDisplay({
      type: 'comment|user_input|mcp|shell' as any,
      required: true,
      comment: { min_length: 50 }
    } as any);

    expect(shape.type).toBe('comment');
    expect(shape.comment).toEqual({ min_length: 50 });
    expect(String(shape.description)).toMatch(/minimum 50/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
