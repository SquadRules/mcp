/**
 * Honest verification on the reward surface (SquadRules/mcp#216): a layer whose
 * last stored proof failed must not be rated as success, and the machine-readable
 * reward call must not invite success for it.
 */
import { describe, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Memory } from '../../src/types/memory.js';
import type { QdrantService } from '../../src/services/qdrant/service.js';

type StoredProof = {
  status: 'success' | 'failed';
  shell?: { exit_code: number };
};

const storedProofs = new Map<string, StoredProof>();

jest.unstable_mockModule('../../src/services/proof-of-work-store.js', () => ({
  MAX_RETRIES: 3,
  proofOfWorkStore: {
    getResult: async (uuid: string) => storedProofs.get(uuid) ?? null,
    saveResult: async () => {},
    getNonce: async () => null,
    setNonce: async () => {},
    setProofHash: async () => {},
    getProofHash: async () => null,
    incrementRetry: async () => 1,
    resetRetry: async () => {}
  }
}));

jest.unstable_mockModule('../../src/services/forward-runtime-store.js', () => ({
  forwardRuntimeStore: {
    getExecution: async () => null,
    startExecution: async () => {},
    deleteExecution: async () => {}
  }
}));

const { buildForwardView } = await import('../../src/tools/forward-view.js');
const { executeReward } = await import('../../src/tools/reward.js');

function makeLayerMemory(memoryUuid: string): Memory {
  return {
    memory_uuid: memoryUuid,
    label: 'Final layer',
    tags: [],
    text: '# Step\n\nRun the gate.',
    llm_model_id: 'test',
    created_at: new Date().toISOString(),
    adapter: { id: 'adapter-head-uuid', name: 'Test adapter', layer_index: 1, layer_count: 1 },
    inference_contract: {
      type: 'comment',
      required: true,
      comment: { min_length: 10 }
    }
  };
}

describe('reward outcome template follows the stored proof', () => {
  test('a layer with a failed proof is offered a failure outcome, not a success', async () => {
    const memoryUuid = randomUUID();
    storedProofs.set(memoryUuid, { status: 'failed', shell: { exit_code: 2 } });

    const view = await buildForwardView(makeLayerMemory(memoryUuid), randomUUID(), { final: true });

    expect(view.next_call.kind).toBe('reward');
    if (view.next_call.kind !== 'reward') throw new Error('expected a reward next_call');
    expect(view.next_call.args.outcome_template.outcome).toBe('failure');
  });

  test('a layer with a successful proof keeps the success outcome', async () => {
    const memoryUuid = randomUUID();
    storedProofs.set(memoryUuid, { status: 'success', shell: { exit_code: 0 } });

    const view = await buildForwardView(makeLayerMemory(memoryUuid), randomUUID(), { final: true });

    if (view.next_call.kind !== 'reward') throw new Error('expected a reward next_call');
    expect(view.next_call.args.outcome_template.outcome).toBe('success');
  });
});

describe('executeReward refuses a success that contradicts the stored proof', () => {
  test('rejects success when the layer\'s last proof failed', async () => {
    const memoryUuid = randomUUID();
    storedProofs.set(memoryUuid, { status: 'failed', shell: { exit_code: 2 } });
    const uri = `squadrules://layer/${memoryUuid}`;
    const retrieveById = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null);
    const qdrantService = { retrieveById } as unknown as QdrantService;

    let caught: unknown;
    try {
      await executeReward(qdrantService, { uri, outcome: 'success', feedback: 'done' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toMatch(/last proof failed/i);
    expect(message).toMatch(/exit_code 2/);
    expect(retrieveById).not.toHaveBeenCalled();
  });

  test('does not block a failure rating for the same layer', async () => {
    const memoryUuid = randomUUID();
    storedProofs.set(memoryUuid, { status: 'failed', shell: { exit_code: 2 } });
    const uri = `squadrules://layer/${memoryUuid}`;
    const qdrantService = {
      retrieveById: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockRejectedValue(new Error('qdrant unavailable'))
    } as unknown as QdrantService;

    let caught: unknown;
    try {
      await executeReward(qdrantService, { uri, outcome: 'failure', feedback: 'gate did not pass' });
    } catch (error) {
      caught = error;
    }

    // The guard must not fire: the failure rating is the honest outcome. The
    // remaining error comes from the unavailable store, not from the guard.
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).not.toMatch(/last proof failed/i);
  });
});
