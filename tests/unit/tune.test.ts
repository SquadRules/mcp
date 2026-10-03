import { buildTuneResultMessage, rewriteTuneMessage } from '../../src/tools/tune-messages.js';

const LAYER_URI = 'squadrules://layer/00000000-0000-0000-0000-000000000123';

describe('tune result messaging', () => {
  test('rewrites capitalized memory references and layer URIs', () => {
    expect(
      rewriteTuneMessage(`Memory ${LAYER_URI} updated successfully`, LAYER_URI)
    ).toBe(`Adapter layer ${LAYER_URI} updated successfully`);
  });

  test('builds adapter-layer success messages from canonical layer URIs', () => {
    expect(
      buildTuneResultMessage(
        {
          status: 'updated',
          message: `Memory ${LAYER_URI} updated successfully`
        },
        LAYER_URI
      )
    ).toBe(`Adapter layer ${LAYER_URI} updated successfully`);
  });

  test('rewrites error messages without losing the failure detail', () => {
    expect(
      buildTuneResultMessage(
        {
          status: 'error',
          message: 'Failed to update memory: Permission denied'
        },
        LAYER_URI
      )
    ).toBe('Failed to update adapter layer: Permission denied');
  });
});
