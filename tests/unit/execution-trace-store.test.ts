import type { ExecutionTrace } from '../../src/types/memory.js';
import { ExecutionTraceStore } from '../../src/services/execution-trace-store.js';
import { buildLayerUri } from '../../src/tools/squadrules-uri.js';
import { describeQdrantBackend } from '../utils/vector-backend.js';

function buildTrace(params: {
  executionId: string;
  adapterUri: string;
  layerIndex: number;
  layerId: string;
  createdAt: string;
}): ExecutionTrace {
  const { executionId, adapterUri, layerIndex, layerId, createdAt } = params;
  return {
    execution_id: executionId,
    adapter_uri: adapterUri,
    layer_uri: buildLayerUri(layerId, executionId),
    layer_index: layerIndex,
    created_at: createdAt,
    layer_instructions: `Layer ${layerIndex} instructions`,
    tensor_in: { prompt: `prompt-${layerIndex}` },
    tensor_out: { name: `tensor_${layerIndex}`, value: `value-${layerIndex}` },
    raw_solution: { comment: { text: `solution-${layerIndex}` } },
    merge_depth: 0
  };
}

const TEST_COLLECTION = `squadrules_test_traces_${Date.now()}`;

// ExecutionTraceStore is Qdrant-only (constructed with a Qdrant URL); it has no embedded-LanceDB
// form, so this suite self-skips under SINGLE (empty QDRANT_URL) and runs on the CLUSTER Qdrant backend.
describeQdrantBackend('ExecutionTraceStore (Qdrant-backed)', () => {
  let store: ExecutionTraceStore;

  beforeAll(() => {
    store = new ExecutionTraceStore(
      process.env['QDRANT_URL'] || 'http://localhost:6333',
      process.env['QDRANT_API_KEY'] || '',
      TEST_COLLECTION
    );
  });

  afterAll(async () => {
    const { QdrantClient } = await import('@qdrant/js-client-rest');
    const client = new QdrantClient({
      url: process.env['QDRANT_URL'] || 'http://localhost:6333',
      ...(process.env['QDRANT_API_KEY'] ? { apiKey: process.env['QDRANT_API_KEY'] } : {})
    });
    try {
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // Collection may not exist if tests failed early
    }
  });

  test('startExecution, appendTrace, setReward, getExecution round-trip', async () => {
    const executionId = `exec-${Date.now()}-1`;
    const adapterId = 'adapter-1';
    const adapterUri = 'squadrules://adapter/adapter-1';

    await store.startExecution({
      executionId,
      adapterId,
      adapterUri,
      activationQuery: 'summarize the customer issue'
    });

    await store.appendTrace(
      buildTrace({
        executionId,
        adapterUri,
        layerIndex: 1,
        layerId: 'layer-1',
        createdAt: '2026-03-22T10:00:00.000Z'
      })
    );

    await store.appendTrace(
      buildTrace({
        executionId,
        adapterUri,
        layerIndex: 2,
        layerId: 'layer-2',
        createdAt: '2026-03-22T10:01:00.000Z'
      })
    );

    await store.setReward(executionId, {
      outcome: 'success',
      score: 0.95,
      signed_score: 0.95,
      quality_bonus: 0.95,
      grader_kind: 'human',
      evaluation_label: 'gold',
      exportable_for_sft: true,
      exportable_for_preference: false,
      rated_at: '2026-03-22T10:05:00.000Z'
    });

    const execution = await store.getExecution(executionId);
    expect(execution).not.toBeNull();
    expect(execution?.activation_query).toBe('summarize the customer issue');
    expect(execution?.traces.map((t) => t.layer_index)).toEqual([1, 2]);
    expect(execution?.reward?.outcome).toBe('success');
  });

  test('listAdapterExecutions and buildTrainingPairsForAdapter', async () => {
    const executionId = `exec-${Date.now()}-2`;
    const adapterId = 'adapter-list-test';
    const adapterUri = `squadrules://adapter/${adapterId}`;

    await store.startExecution({ executionId, adapterId, adapterUri });
    await store.appendTrace(
      buildTrace({
        executionId,
        adapterUri,
        layerIndex: 1,
        layerId: 'layer-1',
        createdAt: '2026-03-22T11:00:00.000Z'
      })
    );

    const executions = await store.listAdapterExecutions(adapterId);
    expect(executions).toContain(executionId);

    const pairs = await store.buildTrainingPairsForAdapter(adapterId, false);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    expect(pairs[0]?.execution_id).toBe(executionId);
  });

  test('deleteExecution removes data', async () => {
    const executionId = `exec-${Date.now()}-3`;
    const adapterId = 'adapter-delete-test';
    const adapterUri = `squadrules://adapter/${adapterId}`;

    await store.startExecution({ executionId, adapterId, adapterUri });
    await store.deleteExecution(executionId);

    expect(await store.getExecution(executionId)).toBeNull();
  });

  test('restarting same execution preserves existing traces', async () => {
    const executionId = `exec-${Date.now()}-4`;
    const adapterId = 'adapter-restart-test';
    const adapterUri = `squadrules://adapter/${adapterId}`;

    await store.startExecution({ executionId, adapterId, adapterUri, activationQuery: 'draft' });
    await store.appendTrace(
      buildTrace({
        executionId,
        adapterUri,
        layerIndex: 1,
        layerId: 'layer-1',
        createdAt: '2026-03-22T12:00:00.000Z'
      })
    );

    await store.startExecution({ executionId, adapterId, adapterUri, activationQuery: 'draft' });
    const execution = await store.getExecution(executionId);
    expect(execution?.traces).toHaveLength(1);
  });
});
