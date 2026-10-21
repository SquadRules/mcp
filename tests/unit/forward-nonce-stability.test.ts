import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import type { Memory } from '../../src/types/memory.js';

const nonceByUuid = new Map<string, string>();

jest.unstable_mockModule('../../src/services/proof-of-work-store.js', () => ({
  MAX_RETRIES: 3,
  proofOfWorkStore: {
    getNonce: async (uuid: string) => nonceByUuid.get(uuid) ?? null,
    setNonce: async (uuid: string, nonce: string) => {
      nonceByUuid.set(uuid, nonce);
    },
    getResult: async () => null,
    saveResult: async () => {},
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

jest.unstable_mockModule('../../src/services/embedding/service.js', () => ({
  embeddingService: {
    generateEmbedding: async () => ({ embedding: new Array(384).fill(0) }),
    calculateCosineSimilarity: () => 0.5
  }
}));

function makeCommentLayerMemory(memoryUuid: string): Memory {
  return {
    memory_uuid: memoryUuid,
    label: 'Test layer',
    tags: [],
    text: '# Step\n\nDo the thing.',
    llm_model_id: 'test',
    created_at: new Date().toISOString(),
    adapter: { id: 'adapter-head-uuid', name: 'Test adapter', layer_index: 5, layer_count: 5 },
    inference_contract: {
      type: 'comment',
      required: true,
      comment: { min_length: 10 }
    }
  };
}

describe('buildForwardView nonce stability', () => {
  let buildForwardView: typeof import('../../src/tools/forward-view.js').buildForwardView;

  beforeAll(async () => {
    const mod = await import('../../src/tools/forward-view.js');
    buildForwardView = mod.buildForwardView;
  });

  afterEach(() => {
    nonceByUuid.clear();
  });

  test('repeat forward preview for the same layer reuses the same nonce', async () => {
    const memoryUuid = randomUUID();
    const memory = makeCommentLayerMemory(memoryUuid);
    const executionId = randomUUID();

    const first = await buildForwardView(memory, executionId);
    const second = await buildForwardView(memory, executionId);

    expect(first.contract).toBeDefined();
    expect(second.contract).toBeDefined();
    if (
      typeof first.contract !== 'object' ||
      first.contract === null ||
      !('nonce' in first.contract) ||
      typeof first.contract.nonce !== 'string'
    ) {
      throw new Error('expected comment contract with nonce');
    }
    expect(second.contract).toMatchObject({ nonce: first.contract.nonce });
    expect(nonceByUuid.get(memoryUuid)).toBe(first.contract.nonce);
  });
});

describe('handleProofSubmission nonce rotation on NONCE_MISMATCH', () => {
  let handleProofSubmission: typeof import('../../src/tools/next-pow-helpers.js').handleProofSubmission;

  beforeAll(async () => {
    const mod = await import('../../src/tools/next-pow-helpers.js');
    handleProofSubmission = mod.handleProofSubmission;
  });

  afterEach(() => {
    nonceByUuid.clear();
  });

  test('rotates nonce after NONCE_MISMATCH so agent can recover', async () => {
    const memoryUuid = randomUUID();
    const memory = makeCommentLayerMemory(memoryUuid);

    // Seed a stored nonce (simulates a prior buildChallenge call)
    const storedNonce = 'original-nonce-value';
    nonceByUuid.set(memoryUuid, storedNonce);

    // Submit with a WRONG nonce (simulates the desync scenario)
    const result = await handleProofSubmission(
      { type: 'comment', nonce: 'wrong-nonce', comment: { text: 'x'.repeat(80) } },
      memory,
      { expectedPreviousHash: 'genesis' }
    );

    // Should be blocked with NONCE_MISMATCH
    expect(result.blockedPayload).toBeDefined();
    expect(result.blockedPayload.error_code).toBe('NONCE_MISMATCH');

    // The challenge in the error response must contain a DIFFERENT nonce
    const responseNonce = result.blockedPayload.challenge?.nonce;
    expect(responseNonce).toBeDefined();
    expect(responseNonce).not.toBe(storedNonce);

    // The stored nonce must have been rotated to the new value
    expect(nonceByUuid.get(memoryUuid)).toBe(responseNonce);

    // A subsequent call with the NEW nonce should pass nonce validation
    const recovery = await handleProofSubmission(
      { type: 'comment', nonce: responseNonce, comment: { text: 'x'.repeat(80) } },
      memory,
      { expectedPreviousHash: 'genesis' }
    );
    // Should NOT be blocked with NONCE_MISMATCH anymore
    expect(recovery.blockedPayload?.error_code).not.toBe('NONCE_MISMATCH');
  });
});
