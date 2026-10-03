import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { getExportZipCompressionLevel } from '../../src/config/export-zip-settings.js';

describe('getExportZipCompressionLevel', () => {
  const key = 'SQUADRULES_EXPORT_ZIP_COMPRESSION_LEVEL';
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[key];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  });

  it('defaults to 6 when unset', () => {
    delete process.env[key];
    expect(getExportZipCompressionLevel()).toBe(6);
  });

  it('accepts 0 for store-only', () => {
    process.env[key] = '0';
    expect(getExportZipCompressionLevel()).toBe(0);
  });

  it('clamps to 0–9', () => {
    process.env[key] = '-1';
    expect(getExportZipCompressionLevel()).toBe(0);
    process.env[key] = '99';
    expect(getExportZipCompressionLevel()).toBe(9);
  });

  it('treats invalid as default 6', () => {
    process.env[key] = 'nan';
    expect(getExportZipCompressionLevel()).toBe(6);
  });
});
