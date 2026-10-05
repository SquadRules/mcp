import { describe, expect, it } from '@jest/globals';
import { executeTrain } from '../../src/tools/train.js';
import type { Memory } from '../../src/types/memory.js';

describe('executeTrain artifact adapter_uri mapping', () => {
  it('keeps parent adapter_uri when artifact memory lookup returns null', async () => {
    const parentAdapterUri = 'squadrules://adapter/parent-adapter';
    const artifactUuid = '11111111-2222-3333-4444-555555555555';

    const memoryStore = {
      storeArtifact: async () =>
        [
          {
            memory_uuid: artifactUuid,
            label: 'artifact.py',
            tags: ['artifact', 'x-python'],
            text: 'print("ok")',
            llm_model_id: 'test-model',
            created_at: new Date().toISOString()
          }
        ] satisfies Memory[],
      storeAdapter: async () => [] as Memory[],
      getMemory: async () => null
    } as any;

    const output = await executeTrain(
      memoryStore,
      {
        content: 'print("ok")',
        llm_model_id: 'test-model',
        force_update: false,
        mime: 'text/x-python',
        artifact_name: 'artifact.py',
        adapter_uri: parentAdapterUri
      },
      async (fn) => fn(),
      // An artifact train resolves the parent adapter slug through the adapter store
      // (src/tools/train-artifact-adapter-uri.ts) and fails without it; the stub resolves the
      // slug back to the same adapter id so the parent uri is kept on the stored item.
      {
        findFirstStepMemoryUuidBySlug: async () => ({ layerUuid: 'parent-adapter' })
      } as any
    );

    expect(output.status).toBe('stored');
    expect(output.items).toHaveLength(1);
    expect(output.items[0]?.artifact_uuid).toBe(artifactUuid);
    expect(output.items[0]?.uri).toBe(`squadrules://artifact/${artifactUuid}`);
    expect(output.items[0]?.adapter_uri).toBe(parentAdapterUri);
  });
});
