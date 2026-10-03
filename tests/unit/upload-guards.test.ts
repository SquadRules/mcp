import { describe, expect, test } from '@jest/globals';
import { normalizeAndValidateApiBaseUrl, prepareMarkdownUploadForMode } from '../../src/cli/upload-guards.js';

const VALID_PROTOCOL = `# Example Protocol

## Activation Patterns

- "run example"

## Step 1: Do Work

Follow the instructions.

\`\`\`json
{
  "contract": {
    "type": "comment",
    "comment": { "min_length": 5 }
  }
}
\`\`\`

## Reward Signal

Reward successful completion.
`;

describe('normalizeAndValidateApiBaseUrl', () => {
  test('accepts plain http and https base URLs', () => {
    expect(normalizeAndValidateApiBaseUrl('http://localhost:3300')).toBe('http://localhost:3300');
    expect(normalizeAndValidateApiBaseUrl('https://squadrules.example.com/')).toBe('https://squadrules.example.com');
  });

  test('rejects credentials and query strings', () => {
    expect(() => normalizeAndValidateApiBaseUrl('https://user:pass@example.com')).toThrow(
      'API base URL must not include credentials'
    );
    expect(() => normalizeAndValidateApiBaseUrl('https://example.com/?x=1')).toThrow(
      'API base URL must not include query or fragment'
    );
  });

  test('rejects unsupported protocols', () => {
    expect(() => normalizeAndValidateApiBaseUrl('file:///tmp/squadrules')).toThrow(
      'Unsupported API base URL protocol: file:'
    );
  });
});

describe('prepareMarkdownUploadForMode', () => {
  test('validates train markdown structure', () => {
    expect(prepareMarkdownUploadForMode(VALID_PROTOCOL, 'train')).toContain('## Reward Signal');
    expect(() => prepareMarkdownUploadForMode('# Missing structure', 'train')).toThrow(
      /Adapter is missing required structure/
    );
  });

  test('blocks obvious secret material unless explicitly allowed', () => {
    const sensitive = `${VALID_PROTOCOL}\n\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n`;
    expect(() => prepareMarkdownUploadForMode(sensitive, 'tune')).toThrow(/private key material/);
    expect(prepareMarkdownUploadForMode(sensitive, 'tune', true)).toContain('PRIVATE KEY');
  });
});
