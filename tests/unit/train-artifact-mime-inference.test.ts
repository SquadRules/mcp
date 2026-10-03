import { describe, expect, it } from '@jest/globals';
import { trainInputSchema } from '../../src/tools/train_schema.js';

describe('trainInputSchema artifact MIME inference', () => {
  it('accepts artifact rows without mime when artifact_name extension is recognized', () => {
    const parsed = trainInputSchema.safeParse({
      llm_model_id: 'm',
      content: 'print("ok")',
      artifact_name: 'helper.py',
      adapter_uri: 'squadrules://adapter/helper-adapter'
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects inferred artifact rows when extension is unknown and mime is missing', () => {
    const parsed = trainInputSchema.safeParse({
      llm_model_id: 'm',
      content: 'not markdown',
      artifact_name: 'helper.rs',
      adapter_uri: 'squadrules://adapter/helper-adapter'
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((issue) => issue.message).join(' | ');
      expect(msg).toContain('mime is required');
    }
  });

  it('accepts relative_path when artifact mode is inferred from artifact_name', () => {
    const parsed = trainInputSchema.safeParse({
      llm_model_id: 'm',
      content: 'print("ok")',
      artifact_name: 'helper.py',
      adapter_uri: 'squadrules://adapter/helper-adapter',
      relative_path: 'scripts/helper.py'
    });
    expect(parsed.success).toBe(true);
  });
});

