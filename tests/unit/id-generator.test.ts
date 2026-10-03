import { IDGenerator } from '../../src/services/id-generator.js';

const UUID = '700468c5-2c80-4502-b60b-9a8c74044a35';
const EXEC = '00000000-0000-0000-0000-0000000000aa';

describe('IDGenerator.qdrantIdFromUri', () => {
  test('extracts bare uuid from squadrules:// simple uri', () => {
    expect(IDGenerator.qdrantIdFromUri(`squadrules://${UUID}`)).toBe(UUID);
  });

  test('extracts layer id from squadrules:// layer uri', () => {
    expect(IDGenerator.qdrantIdFromUri(`squadrules://layer/${UUID}?execution_id=${EXEC}`)).toBe(UUID);
  });

  test('non-uuid simple uri hashes deterministically via buildQdrantId', () => {
    const uri = 'squadrules://coding/rule/coding-rules/step/1';
    expect(IDGenerator.qdrantIdFromUri(uri)).toBe(IDGenerator.buildQdrantId(uri));
  });

  test('throws on unsupported scheme', () => {
    expect(() => IDGenerator.qdrantIdFromUri(`othrscheme://${UUID}`)).toThrow(/Unsupported URI format/);
  });
});
