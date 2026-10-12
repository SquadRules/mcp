/**
 * B1 output-model unit tests: global `--format` resolution, `emitResult` routing, and the
 * pretty-mode next-call hint. Pure — no server, no embedded store, no ONNX. Importing the
 * render/output/format leaves never touches the embedding stack.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Command } from 'commander';
import { resolveOutputFormat } from '../../src/cli/format.js';
import { emitResult } from '../../src/cli/output.js';
import { nextCallHint } from '../../src/cli/render.js';

function fakeProgram(opts: Record<string, unknown>): Command {
  return { optsWithGlobals: () => opts } as unknown as Command;
}

describe('resolveOutputFormat', () => {
  const originalTty = process.stdout.isTTY;
  const originalEnv = process.env['SQUADRULES_FORMAT'];

  afterEach(() => {
    process.stdout.isTTY = originalTty;
    if (originalEnv === undefined) delete process.env['SQUADRULES_FORMAT'];
    else process.env['SQUADRULES_FORMAT'] = originalEnv;
  });

  it('auto resolves to pretty on a TTY', () => {
    delete process.env['SQUADRULES_FORMAT'];
    process.stdout.isTTY = true;
    expect(resolveOutputFormat(fakeProgram({ format: 'auto' }))).toBe('pretty');
  });

  it('auto resolves to json when piped (non-TTY)', () => {
    delete process.env['SQUADRULES_FORMAT'];
    process.stdout.isTTY = false;
    expect(resolveOutputFormat(fakeProgram({}))).toBe('json');
  });

  it('explicit --format wins over both TTY and env', () => {
    process.env['SQUADRULES_FORMAT'] = 'text';
    process.stdout.isTTY = true;
    expect(resolveOutputFormat(fakeProgram({ format: 'json' }))).toBe('json');
  });

  it('SQUADRULES_FORMAT env applies when no --format flag is given', () => {
    process.env['SQUADRULES_FORMAT'] = 'text';
    process.stdout.isTTY = true;
    expect(resolveOutputFormat(fakeProgram({}))).toBe('text');
  });

  it('an unrecognized --format falls back to auto (TTY -> pretty)', () => {
    delete process.env['SQUADRULES_FORMAT'];
    process.stdout.isTTY = true;
    expect(resolveOutputFormat(fakeProgram({ format: 'markdown' }))).toBe('pretty');
  });

  it('is case-insensitive', () => {
    delete process.env['SQUADRULES_FORMAT'];
    expect(resolveOutputFormat(fakeProgram({ format: 'JSON' }))).toBe('json');
  });
});

describe('emitResult', () => {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let restore: Array<() => void> = [];

  beforeEach(() => {
    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown): boolean => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown): boolean => {
      stderrChunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write);
    restore = [() => outSpy.mockRestore(), () => errSpy.mockRestore()];
  });

  afterEach(() => {
    for (const r of restore) r();
    restore = [];
  });

  const view = {
    pretty: (d: { n: number }): string => `pretty:${d.n}`,
    text: (d: { n: number }): string => `text:${d.n}`,
    nextCall: (d: { n: number }): string | null => (d.n > 0 ? `next:${d.n}` : null)
  };

  it('json mode writes only the canonical object to stdout', () => {
    emitResult('json', { n: 1 }, view);
    expect(stdoutChunks.join('')).toBe(`${JSON.stringify({ n: 1 }, null, 2)}\n`);
    expect(stderrChunks).toEqual([]);
  });

  it('text mode writes only the text rendering to stdout', () => {
    emitResult('text', { n: 2 }, view);
    expect(stdoutChunks.join('')).toBe('text:2\n');
    expect(stderrChunks).toEqual([]);
  });

  it('pretty mode writes pretty to stdout and the next-call hint to stderr', () => {
    emitResult('pretty', { n: 3 }, view);
    expect(stdoutChunks.join('')).toBe('pretty:3\n');
    expect(stderrChunks.join('')).toBe('next:3\n');
  });

  it('pretty mode stays silent on stderr when there is no next call', () => {
    emitResult('pretty', { n: 0 }, view);
    expect(stdoutChunks.join('')).toBe('pretty:0\n');
    expect(stderrChunks).toEqual([]);
  });
});

describe('nextCallHint', () => {
  it('returns null for non-object responses', () => {
    expect(nextCallHint(null)).toBeNull();
    expect(nextCallHint('nope')).toBeNull();
    expect(nextCallHint(42)).toBeNull();
  });

  it('forward next_call renders a forward snippet with the solution template', () => {
    const hint = nextCallHint({
      next_call: {
        kind: 'forward',
        args: { uri: 'squadrules://layer/abc', solution_template: { type: 'comment' } }
      }
    });
    expect(hint).toBe(
      `next: squadrules forward 'squadrules://layer/abc' --solution '${JSON.stringify({ type: 'comment' })}'`
    );
  });

  it('reward next_call renders a reward snippet', () => {
    const hint = nextCallHint({
      next_call: {
        kind: 'reward',
        args: { uri: 'squadrules://layer/abc', outcome_template: { outcome: 'success' } }
      }
    });
    expect(hint).toBe(`next: squadrules reward 'squadrules://layer/abc' success 'completed'`);
  });

  it('activate choices render the first forward_first_call snippet', () => {
    const hint = nextCallHint({
      choices: [
        { role: 'create', forward_first_call: null },
        { role: 'match', forward_first_call: { uri: 'squadrules://adapter/foo' } }
      ]
    });
    expect(hint).toBe(`next: squadrules forward 'squadrules://adapter/foo'`);
  });

  it('a terminal reward (next_call: null) yields no hint', () => {
    expect(nextCallHint({ results: [], next_call: null })).toBeNull();
  });
});
