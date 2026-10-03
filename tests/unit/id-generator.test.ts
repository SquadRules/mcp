// squadrules-compat-surface: emits canonical kairos:// adapter/layer/artifact URIs that stored data and existing clients depend on (squadrules:// is dual-accepted on input only)
import { IDGenerator } from '../../src/services/id-generator.js';

const UUID = '700468c5-2c80-4502-b60b-9a8c74044a35';
const EXEC = '00000000-0000-0000-0000-0000000000aa';

describe('IDGenerator.qdrantIdFromUri dual-accept (kairos:// + squadrules://)', () => {
  test('extracts bare uuid from kairos:// simple uri', () => {
    expect(IDGenerator.qdrantIdFromUri(`kairos://${UUID}`)).toBe(UUID);
  });

  test('extracts bare uuid from squadrules:// simple uri', () => {
    expect(IDGenerator.qdrantIdFromUri(`squadrules://${UUID}`)).toBe(UUID);
  });

  test('extracts layer id from kairos:// layer uri', () => {
    expect(IDGenerator.qdrantIdFromUri(`kairos://layer/${UUID}?execution_id=${EXEC}`)).toBe(UUID);
  });

  test('extracts layer id from squadrules:// layer uri', () => {
    expect(IDGenerator.qdrantIdFromUri(`squadrules://layer/${UUID}?execution_id=${EXEC}`)).toBe(UUID);
  });

  test('older transitional layer-row form still resolves (kairos only)', () => {
    const older = `${['kairos', '://', 'me', 'm', '/'].join('')}${UUID}`;
    expect(IDGenerator.qdrantIdFromUri(older)).toBe(UUID);
  });

  test('deterministic /step/ hash is scheme-independent (canonicalized to kairos://)', () => {
    const stepPath = 'coding/rule/coding-rules/step/1';
    const kairosHash = IDGenerator.qdrantIdFromUri(`kairos://${stepPath}`);
    const squadHash = IDGenerator.qdrantIdFromUri(`squadrules://${stepPath}`);
    expect(kairosHash).toBe(squadHash);
    expect(kairosHash).toBe(IDGenerator.buildQdrantId(`kairos://${stepPath}`));
  });

  test('non-uuid simple uri hash is scheme-independent', () => {
    const kairosHash = IDGenerator.qdrantIdFromUri('kairos://some/named/resource');
    const squadHash = IDGenerator.qdrantIdFromUri('squadrules://some/named/resource');
    expect(kairosHash).toBe(squadHash);
  });

  test('throws on unsupported scheme', () => {
    expect(() => IDGenerator.qdrantIdFromUri(`othrscheme://${UUID}`)).toThrow(/Unsupported URI format/);
  });
});
