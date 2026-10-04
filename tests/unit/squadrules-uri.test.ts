import {
  parseSquadrulesUri,
  buildAdapterUri,
  buildLayerUri,
  assertWireAdapterUri
} from '../../src/tools/squadrules-uri.js';

describe('parseSquadrulesUri', () => {
  test('parses adapter slug URIs', () => {
    expect(parseSquadrulesUri('squadrules://adapter/create-merge-request')).toEqual({
      kind: 'adapter',
      id: 'create-merge-request',
      idKind: 'slug',
      raw: 'squadrules://adapter/create-merge-request'
    });
  });

  test('parses adapter uuid URIs', () => {
    expect(parseSquadrulesUri('squadrules://adapter/00000000-0000-0000-0000-000000000001')).toEqual({
      kind: 'adapter',
      id: '00000000-0000-0000-0000-000000000001',
      idKind: 'uuid',
      raw: 'squadrules://adapter/00000000-0000-0000-0000-000000000001'
    });
  });

  test('parses artifact slug URIs', () => {
    expect(parseSquadrulesUri('squadrules://artifact/sort-jira-py')).toEqual({
      kind: 'artifact',
      id: 'sort-jira-py',
      idKind: 'slug',
      raw: 'squadrules://artifact/sort-jira-py'
    });
  });

  test('parses artifact uuid URIs', () => {
    expect(parseSquadrulesUri('squadrules://artifact/00000000-0000-0000-0000-000000000001')).toEqual({
      kind: 'artifact',
      id: '00000000-0000-0000-0000-000000000001',
      idKind: 'uuid',
      raw: 'squadrules://artifact/00000000-0000-0000-0000-000000000001'
    });
  });

  test('parses canonical layer URIs', () => {
    expect(parseSquadrulesUri('squadrules://layer/00000000-0000-0000-0000-000000000099')).toEqual({
      kind: 'layer',
      id: '00000000-0000-0000-0000-000000000099',
      raw: 'squadrules://layer/00000000-0000-0000-0000-000000000099'
    });
  });

  test('parses layer URIs with execution_id', () => {
    expect(
      parseSquadrulesUri(
        'squadrules://layer/00000000-0000-0000-0000-000000000099?execution_id=00000000-0000-0000-0000-0000000000aa'
      )
    ).toEqual({
      kind: 'layer',
      id: '00000000-0000-0000-0000-000000000099',
      executionId: '00000000-0000-0000-0000-0000000000aa',
      raw: 'squadrules://layer/00000000-0000-0000-0000-000000000099?execution_id=00000000-0000-0000-0000-0000000000aa'
    });
  });

  test('rejects unknown schemes', () => {
    expect(() => parseSquadrulesUri('other://adapter/foo')).toThrow(/Invalid SquadRules URI/);
  });
});

describe('build/emit functions produce canonical squadrules://', () => {
  test('buildAdapterUri emits squadrules://', () => {
    expect(buildAdapterUri('create-merge-request')).toBe('squadrules://adapter/create-merge-request');
  });

  test('buildLayerUri emits squadrules:// with and without execution id', () => {
    expect(buildLayerUri('00000000-0000-0000-0000-000000000099')).toBe(
      'squadrules://layer/00000000-0000-0000-0000-000000000099'
    );
    expect(
      buildLayerUri('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-0000000000aa')
    ).toBe(
      'squadrules://layer/00000000-0000-0000-0000-000000000099?execution_id=00000000-0000-0000-0000-0000000000aa'
    );
  });

  test('assertWireAdapterUri returns the canonical squadrules:// form', () => {
    expect(assertWireAdapterUri('squadrules://adapter/create-merge-request')).toBe(
      'squadrules://adapter/create-merge-request'
    );
  });

  test('round trip: parse then rebuild', () => {
    const parsed = parseSquadrulesUri('squadrules://adapter/create-merge-request');
    expect(parsed.kind).toBe('adapter');
    expect(buildAdapterUri(parsed.id)).toBe('squadrules://adapter/create-merge-request');
  });
});
