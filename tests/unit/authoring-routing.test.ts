import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Memory } from '../../src/types/memory.js';
import type { ForwardExecutionMeta } from '../../src/services/forward-runtime-store.js';
import type { MemoryQdrantStore } from '../../src/services/memory/store.js';
import type { QdrantService } from '../../src/services/qdrant/service.js';

const executions = new Map<string, ForwardExecutionMeta>();
const nonces = new Map<string, string>();
const search = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const submit = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ proofHash: 'accepted' });
const traces = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule('../../src/tools/search.js', () => ({ executeSearch: search }));
jest.unstable_mockModule('../../src/services/forward-runtime-store.js', () => ({
  forwardRuntimeStore: {
    startExecution: async (meta: ForwardExecutionMeta) => { executions.set(meta.execution_id, meta); },
    getExecution: async (id: string) => executions.get(id) ?? null
  }
}));
jest.unstable_mockModule('../../src/services/execution-trace-store.js', () => ({
  executionTraceStore: { startExecution: traces }
}));
jest.unstable_mockModule('../../src/tools/forward-trace.js', () => ({
  appendExecutionTrace: traces, solutionToTensorValue: () => undefined, handleTensorForward: jest.fn()
}));
jest.unstable_mockModule('../../src/tools/next.js', () => ({ updateStepQuality: async () => {} }));
jest.unstable_mockModule('../../src/tools/next-previous-step.js', () => ({
  ensurePreviousProofCompleted: async () => null,
  tryApplySolutionToPreviousStep: async () => ({ applied: false }),
  tryApplySolutionToPreviousStepWhenSolutionMatchesPrevious: async () => ({ applied: false })
}));
jest.unstable_mockModule('../../src/tools/next-pow-helpers.js', () => ({
  GENESIS_HASH: 'genesis', handleProofSubmission: submit,
  tryUserInputElicitation: async (_s: unknown, _m: unknown, solution: unknown) => ({ solution }),
  buildChallenge: async (memory: Memory) => {
    const nonce = nonces.get(memory.memory_uuid) ?? randomUUID();
    nonces.set(memory.memory_uuid, nonce);
    return { type: 'comment', nonce, proof_hash: 'genesis' };
  }
}));
jest.unstable_mockModule('../../src/services/proof-of-work-store.js', () => ({
  proofOfWorkStore: { getNonce: async (id: string) => nonces.get(id), getProofHash: async () => null }
}));

const { executeActivate } = await import('../../src/tools/activate.js');
const { executeForward } = await import('../../src/tools/forward.js');
const { activateInputSchema, activateOutputSchema } = await import('../../src/tools/activate_schema.js');
const { forwardInputSchema, forwardMcpWireInputSchema, forwardOutputSchema } = await import('../../src/tools/forward_schema.js');
const { resolveAdapterSlugAlias } = await import('../../src/utils/adapter-alias.js');
const { LanceRecordReader } = await import('../../src/services/vector-store/lancedb/lance-records-reads.js');
const { findFirstStepMemoryUuidBySlug } = await import('../../src/services/qdrant/memory-retrieval.js');

const head = randomUUID(), next = randomUUID(), target = randomUUID();
function layer(id: string, index: number, slug = 'author-adapter'): Memory {
  return {
    memory_uuid: id, slug, label: 'Authoring phase', tags: [], text: 'Inspect the adapter.',
    llm_model_id: 'test', created_at: new Date().toISOString(),
    adapter: { id: slug === 'author-adapter' ? head : target, name: 'Author Adapter', layer_index: index, layer_count: 2 },
    inference_contract: { type: 'comment', comment: { min_length: 1 }, required: true }
  };
}
const memories = new Map([[head, layer(head, 1)], [next, layer(next, 2)], [target, layer(target, 1, 'sample-pr-workflow')]]);
const store = { getMemory: async (id: string) => memories.get(id) ?? null } as unknown as MemoryQdrantStore;
const db = {
  findFirstStepMemoryUuidBySlug: async (slug: string) => ({ layerUuid: resolveAdapterSlugAlias(slug) === 'author-adapter' ? head : slug === 'sample-pr-workflow' ? target : null }),
  getAdapterLayers: async (id: string) => (id === head ? [head, next] : id === target ? [target] : []).map((uuid, i) => ({ uuid, payload: { adapter: { layer_index: i + 1 } } }))
} as unknown as QdrantService;
const authoring = { operation: 'update' as const, target_adapter_uri: 'squadrules://adapter/sample-pr-workflow' };
const canonicalAuthoring = { ...authoring, target_adapter_uri: `squadrules://adapter/${target}` };
const solution = { type: 'comment' as const, outcome: 'success' as const, evidence: { text: 'Checked' } };

beforeEach(() => { executions.clear(); nonces.clear(); jest.clearAllMocks(); });

describe('authoring intent from activation through continuation', () => {
  test('update existing PR adapter routes to authoring, preserving context on every layer', async () => {
    const input = activateInputSchema.parse({ query: 'update existing PR adapter worktree isolation', authoring });
    const activation = activateOutputSchema.parse(await executeActivate(store, db, input));
    expect(search).not.toHaveBeenCalled();
    const call = activation.choices[0]!.forward_first_call!;
    expect(call).toEqual({ uri: 'squadrules://adapter/author-adapter', authoring: canonicalAuthoring });
    const first = forwardOutputSchema.parse(await executeForward({}, store, db, forwardInputSchema.parse(call)));
    expect(first.authoring).toEqual(canonicalAuthoring);
    expect(first.next_call.args).toMatchObject({ authoring: canonicalAuthoring });
    const continued = forwardOutputSchema.parse(await executeForward({}, store, db, {
      uri: first.current_layer!.uri, solution
    }));
    expect(continued.authoring).toEqual(canonicalAuthoring);
    expect(continued.current_layer!.uri).toContain(next);
    expect(continued.next_call.args).toMatchObject({ authoring: canonicalAuthoring });
    expect(executions.get(first.execution_id!)?.authoring).toEqual(canonicalAuthoring);
  });

  test.each(['author-adapter', 'create-new-protocol'])('%s starts the same existing adapter', async slug => {
    const result = await executeForward({}, store, db, { uri: `squadrules://adapter/${slug}`, authoring });
    expect(result.current_layer!.uri).toContain(head);
  });

  test('continuation cannot change operation, target, or workflow; rejection precedes proof processing', async () => {
    const first = await executeForward({}, store, db, { uri: 'squadrules://adapter/author-adapter', authoring });
    for (const changed of [{ operation: 'create' as const }, { ...authoring, target_adapter_uri: 'squadrules://adapter/other' }]) {
      await expect(executeForward({}, store, db, { uri: first.current_layer!.uri, solution, authoring: changed })).rejects.toMatchObject({ code: 'AUTHORING_CONTEXT_MISMATCH' });
    }
    await expect(executeForward({}, store, db, { uri: `squadrules://layer/${target}?execution_id=${first.execution_id}`, solution })).rejects.toMatchObject({ code: 'AUTHORING_CONTEXT_MISMATCH' });
    expect(submit).not.toHaveBeenCalled();
  });

  test('missing target never falls back to create or starts an execution', async () => {
    const missing = { ...authoring, target_adapter_uri: 'squadrules://adapter/missing' };
    await expect(executeActivate(store, db, { query: 'update adapter', authoring: missing })).rejects.toThrow();
    await expect(executeForward({}, store, db, { uri: 'squadrules://adapter/author-adapter', authoring: missing })).rejects.toThrow();
    expect(executions.size).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });

  test('context cannot be attached to target execution or an unknown continuation', async () => {
    await expect(executeForward({}, store, db, { uri: 'squadrules://adapter/sample-pr-workflow', authoring })).rejects.toMatchObject({ code: 'INVALID_AUTHORING_WORKFLOW' });
    await expect(executeForward({}, store, db, { uri: `squadrules://layer/${head}?execution_id=${randomUUID()}`, solution, authoring })).rejects.toMatchObject({ code: 'AUTHORING_CONTEXT_MISMATCH' });
  });

  test('expired authoring execution fails closed even when context is omitted', async () => {
    const first = await executeForward({}, store, db, { uri: 'squadrules://adapter/author-adapter', authoring });
    executions.clear();
    await expect(executeForward({}, store, db, { uri: first.current_layer!.uri, solution })).rejects.toMatchObject({ code: 'AUTHORING_CONTEXT_MISMATCH' });
    expect(submit).not.toHaveBeenCalled();
  });

  test('original start without context remains valid', async () => {
    const result = await executeForward({}, store, db, { uri: 'squadrules://adapter/author-adapter' });
    expect(result.authoring).toBeUndefined();
  });

  test.each([activateInputSchema, forwardInputSchema, forwardMcpWireInputSchema])('schemas retain valid intent and reject invalid combinations', schema => {
    const base = { query: 'update adapter', uri: 'squadrules://adapter/author-adapter' };
    expect(schema.parse({ ...base, authoring })).toMatchObject({ authoring });
    for (const bad of [{ operation: 'update' }, { operation: 'review', target_adapter_uri: 'https://example.com' }, { operation: 'create', target_adapter_uri: authoring.target_adapter_uri }, { operation: 'execute' }]) {
      expect(schema.safeParse({ ...base, authoring: bad }).success).toBe(false);
    }
  });

  test('shared slug retrieval maps lifecycle alias to original storage without changing other slugs', async () => {
    for (const [input, expected] of [['author-adapter', 'author-adapter'], ['create-new-protocol', 'author-adapter'], ['sample-pr-workflow', 'sample-pr-workflow']]) {
      const scroll = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ points: [] });
      const conn = { executeWithReconnect: (fn: () => unknown) => fn(), client: { scroll }, collectionName: 'test' };
      await findFirstStepMemoryUuidBySlug(conn as never, input!);
      const lanceScroll = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([]);
      const reader = new LanceRecordReader({ scroll: lanceScroll } as never);
      await reader.findFirstStepMemoryUuidBySlug(input!);
      expect(lanceScroll.mock.calls[0]![0]).toMatchObject({ must: expect.arrayContaining([{ key: 'slug', match: { value: expected } }]) });
      expect(scroll.mock.calls[0]![1]).toMatchObject({ filter: { must: expect.arrayContaining([{ key: 'slug', match: { value: expected } }]) } });
    }
  });
});
