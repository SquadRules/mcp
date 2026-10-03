// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import {
  validateAdapterMarkdownSize,
  validateArtifactContentSize
} from '../../src/services/memory/validate-adapter-markdown-size.js';

describe('validateAdapterMarkdownSize', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      'KAIROS_ADAPTER_MARKDOWN_MAX_LINES',
      'KAIROS_ADAPTER_MARKDOWN_MAX_LINE_BYTES',
      'KAIROS_ADAPTER_MARKDOWN_SIZE_SAFETY_FACTOR'
    ]) {
      prev[k] = process.env[k];
    }
    process.env['KAIROS_ADAPTER_MARKDOWN_MAX_LINES'] = '5';
    process.env['KAIROS_ADAPTER_MARKDOWN_MAX_LINE_BYTES'] = '32';
    process.env['KAIROS_ADAPTER_MARKDOWN_SIZE_SAFETY_FACTOR'] = '1';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('accepts small document', () => {
    const r = validateAdapterMarkdownSize('a\nb\nc\n');
    expect(r).toEqual({ ok: true });
  });

  it('rejects too many lines when enforceMaxLineCount', () => {
    const r = validateAdapterMarkdownSize('x\n'.repeat(6));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ADAPTER_MARKDOWN_LINE_COUNT_EXCEEDED');
  });

  it('allows many short lines when line count not enforced', () => {
    process.env['KAIROS_ADAPTER_MARKDOWN_MAX_LINES'] = '500';
    process.env['KAIROS_ADAPTER_MARKDOWN_MAX_LINE_BYTES'] = '8';
    process.env['KAIROS_ADAPTER_MARKDOWN_SIZE_SAFETY_FACTOR'] = '1';
    const r = validateAdapterMarkdownSize('x\n'.repeat(200), { enforceMaxLineCount: false });
    expect(r.ok).toBe(true);
  });

  it('rejects long single line', () => {
    const r = validateAdapterMarkdownSize('y'.repeat(40));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ADAPTER_MARKDOWN_LINE_TOO_LONG');
  });

  it('rejects when total bytes exceed ceiling', () => {
    process.env['KAIROS_ADAPTER_MARKDOWN_MAX_LINES'] = '2';
    process.env['KAIROS_ADAPTER_MARKDOWN_MAX_LINE_BYTES'] = '8';
    process.env['KAIROS_ADAPTER_MARKDOWN_SIZE_SAFETY_FACTOR'] = '1';
    const r = validateAdapterMarkdownSize('abcdefgh\nijklmnop');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ADAPTER_MARKDOWN_TOTAL_BYTES_EXCEEDED');
  });
});

describe('validateArtifactContentSize', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      'KAIROS_ADAPTER_MARKDOWN_MAX_LINES',
      'KAIROS_ADAPTER_MARKDOWN_MAX_LINE_BYTES',
      'KAIROS_ADAPTER_MARKDOWN_SIZE_SAFETY_FACTOR'
    ]) {
      prev[k] = process.env[k];
    }
    process.env['KAIROS_ADAPTER_MARKDOWN_MAX_LINES'] = '2';
    process.env['KAIROS_ADAPTER_MARKDOWN_MAX_LINE_BYTES'] = '4';
    process.env['KAIROS_ADAPTER_MARKDOWN_SIZE_SAFETY_FACTOR'] = '1';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('rejects oversized artifact body', () => {
    const r = validateArtifactContentSize('123456789');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ARTIFACT_CONTENT_TOTAL_BYTES_EXCEEDED');
  });
});
