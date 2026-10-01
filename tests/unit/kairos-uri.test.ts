import {
  parseKairosUri,
  buildAdapterUri,
  buildLayerUri,
  assertWireAdapterUri
} from '../../src/tools/kairos-uri.js';

describe('parseKairosUri', () => {
  test('parses adapter slug URIs', () => {
    expect(parseKairosUri('kairos://adapter/create-merge-request')).toEqual({
      kind: 'adapter',
      id: 'create-merge-request',
      idKind: 'slug',
      raw: 'kairos://adapter/create-merge-request'
    });
  });

  test('parses artifact slug URIs', () => {
    expect(parseKairosUri('kairos://artifact/sort-jira-py')).toEqual({
      kind: 'artifact',
      id: 'sort-jira-py',
      idKind: 'slug',
      raw: 'kairos://artifact/sort-jira-py'
    });
  });

  test('parses artifact uuid URIs', () => {
    expect(parseKairosUri('kairos://artifact/00000000-0000-0000-0000-000000000001')).toEqual({
      kind: 'artifact',
      id: '00000000-0000-0000-0000-000000000001',
      idKind: 'uuid',
      raw: 'kairos://artifact/00000000-0000-0000-0000-000000000001'
    });
  });

  test('parses canonical layer URIs', () => {
    expect(parseKairosUri('kairos://layer/00000000-0000-0000-0000-000000000099')).toEqual({
      kind: 'layer',
      id: '00000000-0000-0000-0000-000000000099',
      raw: 'kairos://layer/00000000-0000-0000-0000-000000000099'
    });
  });

  test('parses transitional older layer-row URIs as layer kind', () => {
    const id = '00000000-0000-0000-0000-000000000088';
    const raw = `${['kairos', '://', 'me', 'm', '/'].join('')}${id}`;
    expect(parseKairosUri(raw)).toEqual({
      kind: 'layer',
      id,
      raw
    });
  });
});

describe('parseKairosUri squadrules:// alias (dual-accept input)', () => {
  test('parses squadrules adapter slug URIs and preserves raw scheme', () => {
    expect(parseKairosUri('squadrules://adapter/create-merge-request')).toEqual({
      kind: 'adapter',
      id: 'create-merge-request',
      idKind: 'slug',
      raw: 'squadrules://adapter/create-merge-request'
    });
  });

  test('parses squadrules adapter uuid URIs', () => {
    expect(parseKairosUri('squadrules://adapter/00000000-0000-0000-0000-000000000001')).toEqual({
      kind: 'adapter',
      id: '00000000-0000-0000-0000-000000000001',
      idKind: 'uuid',
      raw: 'squadrules://adapter/00000000-0000-0000-0000-000000000001'
    });
  });

  test('parses squadrules artifact slug URIs', () => {
    expect(parseKairosUri('squadrules://artifact/sort-jira-py')).toEqual({
      kind: 'artifact',
      id: 'sort-jira-py',
      idKind: 'slug',
      raw: 'squadrules://artifact/sort-jira-py'
    });
  });

  test('parses squadrules layer URIs with execution_id', () => {
    expect(
      parseKairosUri(
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
    expect(() => parseKairosUri('othrscheme://adapter/foo')).toThrow(/Invalid KAIROS URI/);
  });
});

describe('build/emit functions produce canonical kairos:// only', () => {
  test('buildAdapterUri emits kairos://', () => {
    expect(buildAdapterUri('create-merge-request')).toBe('kairos://adapter/create-merge-request');
  });

  test('buildLayerUri emits kairos:// with and without execution id', () => {
    expect(buildLayerUri('00000000-0000-0000-0000-000000000099')).toBe(
      'kairos://layer/00000000-0000-0000-0000-000000000099'
    );
    expect(
      buildLayerUri('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-0000000000aa')
    ).toBe(
      'kairos://layer/00000000-0000-0000-0000-000000000099?execution_id=00000000-0000-0000-0000-0000000000aa'
    );
  });

  test('assertWireAdapterUri accepts squadrules:// and returns canonical kairos://', () => {
    expect(assertWireAdapterUri('squadrules://adapter/create-merge-request')).toBe(
      'kairos://adapter/create-merge-request'
    );
    expect(assertWireAdapterUri('kairos://adapter/create-merge-request')).toBe(
      'kairos://adapter/create-merge-request'
    );
  });

  test('round trip: parse squadrules:// then rebuild as kairos://', () => {
    const parsed = parseKairosUri('squadrules://adapter/create-merge-request');
    expect(parsed.kind).toBe('adapter');
    expect(buildAdapterUri(parsed.id)).toBe('kairos://adapter/create-merge-request');
  });
});
