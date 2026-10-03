import { describe, expect, it } from '@jest/globals';
import { trainInputSchema } from '../../src/tools/train_schema.js';
import { executeTrainStore } from '../../src/tools/train-store.js';

describe('trainInputSchema fork fields', () => {
  it('requires content or source_adapter_uri', () => {
    const bad = trainInputSchema.safeParse({
      llm_model_id: 'm'
    });
    expect(bad.success).toBe(false);
  });

  it('accepts source_adapter_uri without content', () => {
    const ok = trainInputSchema.safeParse({
      llm_model_id: 'm',
      source_adapter_uri: 'squadrules://adapter/source-adapter'
    });
    expect(ok.success).toBe(true);
  });

  it('accepts content only', () => {
    const ok = trainInputSchema.safeParse({
      llm_model_id: 'm',
      content: '# T\n\n## Activation Patterns\n\n## Reward Signal\n\n```json\n{"contract":{}}\n```\n',
      review_evidence: { verdict_file: '/tmp/v.txt', exit_code: 0, stdout: 'PASS' }
    });
    expect(ok.success).toBe(true);
  });

  it('requires artifact_name when mime is non-markdown', () => {
    const bad = trainInputSchema.safeParse({
      llm_model_id: 'm',
      content: 'print("ok")',
      mime: 'text/x-python',
      adapter_uri: 'squadrules://adapter/source-adapter'
    });
    expect(bad.success).toBe(false);
  });

  it('requires adapter_uri when mime is non-markdown', () => {
    const bad = trainInputSchema.safeParse({
      llm_model_id: 'm',
      content: 'print("ok")',
      mime: 'text/x-python',
      artifact_name: 'artifact.py'
    });
    expect(bad.success).toBe(false);
  });

  it('accepts adapter slug URI when mime is non-markdown', () => {
    const ok = trainInputSchema.safeParse({
      llm_model_id: 'm',
      content: 'print("ok")',
      mime: 'text/x-python',
      artifact_name: 'artifact.py',
      adapter_uri: 'squadrules://adapter/daily-briefing-generation-multi-source-work-dashboard'
    });
    expect(ok.success).toBe(true);
  });

  it('rejects unsupported artifact mime in store branch', async () => {
    const memoryStore = {
      storeArtifact: async () => {
        throw new Error('should not be called');
      }
    } as any;
    await expect(
      executeTrainStore(
        memoryStore,
        {
          content: 'whatever',
          llm_model_id: 'm',
          mime: 'text/html',
          artifact_name: 'bad.html',
          adapter_uri: 'squadrules://adapter/source-adapter'
        } as any,
        async (fn) => fn()
      )
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MIME' });
  });
});
