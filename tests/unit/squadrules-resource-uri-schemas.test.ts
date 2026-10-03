import { deleteInputSchema } from '../../src/tools/delete_schema.js';
import { exportInputSchema } from '../../src/tools/export_schema.js';
import { tuneInputSchema } from '../../src/tools/tune_schema.js';

const ADAPTER_URI = 'squadrules://adapter/sample-adapter';
const ADAPTER_WITH_EXEC = `${ADAPTER_URI}?execution_id=00000000-0000-0000-0000-000000000099`;
const LAYER_URI = 'squadrules://layer/00000000-0000-0000-0000-000000000002';
const LAYER_WITH_EXEC = `${LAYER_URI}?execution_id=00000000-0000-0000-0000-000000000003`;
const ARTIFACT_SLUG_URI = 'squadrules://artifact/sort-jira-py';

describe('resource URI schemas', () => {
  test('tune rejects execution_id on adapter URIs', () => {
    const result = tuneInputSchema.safeParse({
      uris: [ADAPTER_WITH_EXEC],
      content: ['# Updated adapter']
    });

    expect(result.success).toBe(false);
  });

  test('tune accepts layer execution_id URIs', () => {
    const result = tuneInputSchema.safeParse({
      uris: [LAYER_WITH_EXEC],
      content: ['# Updated adapter'],
      review_evidence: {
        verdict_file: '/tmp/verdict.txt',
        exit_code: 0,
        stdout: 'PASS'
      }
    });

    expect(result.success).toBe(true);
  });

  test('export rejects execution_id on adapter URIs', () => {
    const result = exportInputSchema.safeParse({
      uri: ADAPTER_WITH_EXEC,
      format: 'markdown'
    });

    expect(result.success).toBe(false);
  });

  test('export accepts execution_id on layer URIs', () => {
    const result = exportInputSchema.safeParse({
      uri: LAYER_WITH_EXEC,
      format: 'markdown'
    });

    expect(result.success).toBe(true);
  });

  test('export accepts flat markdown with single uri', () => {
    const result = exportInputSchema.safeParse({
      uri: ADAPTER_URI,
      format: 'markdown'
    });
    expect(result.success).toBe(true);
  });

  test('export rejects markdown format with adapters list', () => {
    const result = exportInputSchema.safeParse({
      adapters: [ADAPTER_URI],
      format: 'markdown'
    });
    expect(result.success).toBe(false);
  });

  test('export accepts artifact slug URIs', () => {
    const result = exportInputSchema.safeParse({
      uri: ARTIFACT_SLUG_URI,
      format: 'source'
    });

    expect(result.success).toBe(true);
  });

  test('delete rejects execution_id on adapter URIs', () => {
    const result = deleteInputSchema.safeParse({
      uris: [ADAPTER_WITH_EXEC]
    });

    expect(result.success).toBe(false);
  });

  test('delete accepts plain adapter URIs and layer execution_id URIs', () => {
    const result = deleteInputSchema.safeParse({
      uris: [ADAPTER_URI, LAYER_WITH_EXEC]
    });

    expect(result.success).toBe(true);
  });
});
