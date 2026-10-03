import {
  DELETE_COMMAND_DESCRIPTION,
  DELETE_COMMAND_URI_ARGUMENT_DESCRIPTION
} from '../../src/cli/commands/delete-metadata.js';

describe('delete command help', () => {
  test('describes adapter and layer URI support', () => {
    expect(DELETE_COMMAND_DESCRIPTION).toBe(
      'Delete one or more SQUADRULES adapter resources. Adapter URIs delete all layers; layer URIs delete a single layer.'
    );
    expect(DELETE_COMMAND_URI_ARGUMENT_DESCRIPTION).toBe(
      'SQUADRULES adapter or layer URIs (squadrules://adapter/{uuid} or squadrules://layer/{uuid})'
    );
  });
});
