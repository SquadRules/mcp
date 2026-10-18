/**
 * Unit tests for buildChallengeShapeForDisplay: MCP output schema safety for stored proofs.
 */

import { describe, expect, jest, test } from '@jest/globals';
import { buildChallengeShapeForDisplay } from '../../src/tools/squadrules-challenge-display.js';
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

  test('subagent challenge is preserved with context and a delegation description', () => {
    const shape = buildChallengeShapeForDisplay({
      required: true,
      type: 'subagent',
      subagent: { context: 'forward squadrules://adapter/critic-loop' }
    } as any);
    expect(shape.type).toBe('subagent');
    expect((shape.subagent as Record<string, unknown>).context).toBe(
      'forward squadrules://adapter/critic-loop'
    );
    expect(String(shape.description)).toMatch(/delegate/i);
  });

  test('invalid stored type is coerced to comment with valid schema fields', () => {
    const warn = jest.spyOn(structuredLogger, 'warn').mockImplementation(() => {});

    const shape = buildChallengeShapeForDisplay({
      type: 'comment|user_input|shell' as any,
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
