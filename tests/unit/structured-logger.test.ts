/**
 * Unit tests for structured-logger sanitization (log injection / CodeQL remediation).
 * Verifies sanitizeLogMessage, sanitizeBindingsForAudit, and that info/warn/error
 * pass only sanitized data to the sink.
 */

import { jest } from '@jest/globals';
import {
  buildAuditLine,
  sanitizeLogMessage,
  sanitizeBindingsForAudit,
  structuredLogger
} from '../../src/utils/structured-logger.js';

describe('sanitizeLogMessage', () => {
  test('removes carriage return and newline', () => {
    expect(sanitizeLogMessage('a\r\nb')).toBe('a b');
    expect(sanitizeLogMessage('line1\nline2')).toBe('line1 line2');
    expect(sanitizeLogMessage('x\ry')).toBe('x y');
  });

  test('replaces control characters (0x00-0x1f) with space', () => {
    expect(sanitizeLogMessage('a\x00b')).toBe('a b');
    expect(sanitizeLogMessage('tab\there')).toBe('tab here');
    expect(sanitizeLogMessage('one\x1f two')).toBe('one two');
  });

  test('collapses multiple spaces and trims', () => {
    expect(sanitizeLogMessage('  a   b  ')).toBe('a b');
    expect(sanitizeLogMessage('x\n\n\ny')).toBe('x y');
  });

  test('returns (empty) for empty or whitespace-only after trim', () => {
    expect(sanitizeLogMessage('')).toBe('(empty)');
    expect(sanitizeLogMessage('   ')).toBe('(empty)');
    expect(sanitizeLogMessage('\t\n\r')).toBe('(empty)');
  });

  test('handles non-string input by returning empty string', () => {
    expect(sanitizeLogMessage(null as unknown as string)).toBe('');
  });

  test('caps length at default maxLen', () => {
    const long = 'a'.repeat(40_000);
    expect(sanitizeLogMessage(long).length).toBeLessThanOrEqual(32_768);
  });
});

describe('sanitizeBindingsForAudit', () => {
  test('sanitizes string values', () => {
    const out = sanitizeBindingsForAudit({ a: 'x\ny', b: 'ok' });
    expect(out).toEqual({ a: 'x y', b: 'ok' });
  });

  test('recursively sanitizes nested objects', () => {
    const out = sanitizeBindingsForAudit({
      top: 't\r\n',
      nested: { inner: 'i\nj' }
    });
    expect(out).toEqual({ top: 't', nested: { inner: 'i j' } });
  });

  test('sanitizes binding keys that contain newlines or control characters', () => {
    const out = sanitizeBindingsForAudit({ ['evil\nkey']: 'value', normal: 'ok' });
    expect(out).not.toHaveProperty('evil\nkey');
    expect(out['evil key']).toBe('value');
    expect(out.normal).toBe('ok');
  });

  test('leaves non-string primitives unchanged', () => {
    const out = sanitizeBindingsForAudit({
      n: 42,
      b: true,
      nil: null
    });
    expect(out).toEqual({ n: 42, b: true, nil: null });
  });

  test('normalizes Error instances into safe objects', () => {
    const err = new Error('msg');
    const out = sanitizeBindingsForAudit({ e: err });
    expect(out).toMatchObject({ e: { name: 'Error', message: 'msg' } });
  });

  test('normalizes arrays into bounded summaries', () => {
    const out = sanitizeBindingsForAudit({ values: ['x\ny', 'second'] });
    expect(out).toEqual({
      values: { kind: 'array', item_count: 2, first_item: 'x y' }
    });
  });
});

describe('buildAuditLine', () => {
  test('serializes coarse allowlisted audit events with full context bindings', () => {
    const line = buildAuditLine('info', {
      category: 'audit.embedding',
      stage: 'provider',
      status: 'error',
      tenant_id: 'tenant-1',
      request_id: 'req-1',
      error_message: 'upstream failed'
    });
    expect(line).toContain('"category":"audit.embedding"');
    expect(line).toContain('"event":"embedding_provider_error"');
    // All non-category/event bindings are passed through for full audit context
    expect(line).toContain('"tenant_id":"tenant-1"');
    expect(line).toContain('"request_id":"req-1"');
    expect(line).toContain('"error_message":"upstream failed"');
    expect(line?.endsWith('\n')).toBe(true);
  });
});

describe('structuredLogger sink sanitization', () => {
  test('info with object bindings passes sanitized bindings to pino', () => {
    const pino = structuredLogger.getPinoLogger();
    const infoSpy = jest.spyOn(pino, 'info');

    structuredLogger.info(
      { category: 'info', uri: 'http://example.com\ninjected', request_id: 'id\r\n' },
      'test message'
    );

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [bindings, message] = infoSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(bindings.uri).toBe('http://example.com injected');
    expect(bindings.request_id).toBe('id');
    expect(message).toBe('test message');
    infoSpy.mockRestore();
  });

  test('warn with object bindings passes sanitized bindings to pino', () => {
    const pino = structuredLogger.getPinoLogger();
    const warnSpy = jest.spyOn(pino, 'warn');

    structuredLogger.warn(
      { category: 'warning', mcp_method: 'tools/call\r\n', request_id: 'req-1' },
      'warning message'
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [bindings] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(bindings.mcp_method).toBe('tools/call');
    expect(bindings.request_id).toBe('req-1');
    warnSpy.mockRestore();
  });

  test('error with options passes sanitized bindings to pino', () => {
    const pino = structuredLogger.getPinoLogger();
    const errorSpy = jest.spyOn(pino, 'error');

    structuredLogger.error('HTTP error', new Error('fail'), {
      request_id: 'rid\n',
      http_method: 'POST',
      http_url: 'http://evil.com\r\npath'
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [bindings, message] = errorSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(bindings.request_id).toBe('rid');
    expect(bindings.http_method).toBe('POST');
    expect(bindings.http_url).toBe('http://evil.com path');
    expect(message).toBe('HTTP error');
    errorSpy.mockRestore();
  });

  test('debug with string message sanitizes message at sink', () => {
    const pino = structuredLogger.getPinoLogger();
    const debugSpy = jest.spyOn(pino, 'debug');

    structuredLogger.debug('debug input\nforged\rline');

    expect(debugSpy).toHaveBeenCalledTimes(1);
    const [, message] = debugSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe('debug input forged line');
    expect(message).toBe(sanitizeLogMessage('debug input\nforged\rline'));
    debugSpy.mockRestore();
  });

  test('warn with string message sanitizes message at sink', () => {
    const pino = structuredLogger.getPinoLogger();
    const warnSpy = jest.spyOn(pino, 'warn');

    structuredLogger.warn('warn input\nforged line');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [, message] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe('warn input forged line');
    expect(message).toBe(sanitizeLogMessage('warn input\nforged line'));
    warnSpy.mockRestore();
  });

  test('info with string message sanitizes message at sink', () => {
    const pino = structuredLogger.getPinoLogger();
    const infoSpy = jest.spyOn(pino, 'info');

    structuredLogger.info('user input\nforged line');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [, message] = infoSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).not.toContain('\n');
    expect(message).toBe('user input forged line');
    infoSpy.mockRestore();
  });

  test('info with string message truncates long input at sink', () => {
    const pino = structuredLogger.getPinoLogger();
    const infoSpy = jest.spyOn(pino, 'info');
    const longInput = 'a'.repeat(40_000);

    structuredLogger.info(longInput);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [, message] = infoSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe(sanitizeLogMessage(longInput));
    expect(message.length).toBeLessThanOrEqual(32_768);
    infoSpy.mockRestore();
  });
});
