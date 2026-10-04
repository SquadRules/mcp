import { describe, expect, it } from '@jest/globals';
import { trainInputSchema } from '../../src/tools/train_schema.js';

const minimalAdapter = {
  llm_model_id: 'test-model',
  content: 'print(1)',
  mime: 'text/x-python' as const,
  artifact_name: 'helper.py',
  adapter_uri: 'squadrules://adapter/helper-adapter' as const
};

describe('trainInputSchema relative_path', () => {
  it('accepts relative_path with non-markdown artifact fields', () => {
    const ok = trainInputSchema.safeParse({
      ...minimalAdapter,
      relative_path: 'scripts/helper.py'
    });
    expect(ok.success).toBe(true);
  });

  it('rejects relative_path when mime is markdown', () => {
    const bad = trainInputSchema.safeParse({
      llm_model_id: 'm',
      content: '# T\n\n## Activation Patterns\n\n## Reward Signal\n\n```json\n{"contract":{}}\n```\n',
      relative_path: 'scripts/x.py'
    });
    expect(bad.success).toBe(false);
  });

  it('rejects relative_path when mime is omitted (adapter train)', () => {
    const bad = trainInputSchema.safeParse({
      llm_model_id: 'm',
      content: '# T\n\n## Activation Patterns\n\n## Reward Signal\n\n```json\n{"contract":{}}\n```\n',
      relative_path: 'foo.py'
    });
    expect(bad.success).toBe(false);
  });

  it('rejects path traversal in relative_path', () => {
    const bad = trainInputSchema.safeParse({
      ...minimalAdapter,
      relative_path: '../outside.toml'
    });
    expect(bad.success).toBe(false);
  });

  it('rejects absolute-style relative_path', () => {
    const bad = trainInputSchema.safeParse({
      ...minimalAdapter,
      relative_path: '/etc/hosts'
    });
    expect(bad.success).toBe(false);
  });
});
