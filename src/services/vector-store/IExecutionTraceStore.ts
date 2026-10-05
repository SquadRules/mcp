/**
 * Port: execution-trace persistence (no vectors).
 *
 * Signatures mirror the current `ExecutionTraceStore` exactly, so a Qdrant
 * adapter can satisfy this by delegation with no behavior change while a
 * LanceDB adapter maps the same calls onto its own storage.
 */
import type { ExecutionTrace, RewardRecord, StartExecutionParams, StoredExecutionTrace, TrainingPair } from './types.js';

export interface IExecutionTraceStore {
  /** Open (or re-open) an execution, preserving prior reward and traces. */
  startExecution(params: StartExecutionParams): Promise<void>;

  /** Append one layer trace to its execution. */
  appendTrace(trace: ExecutionTrace): Promise<void>;

  /** Attach a reward record to a completed execution. */
  setReward(executionId: string, reward: RewardRecord): Promise<void>;

  /** Read a full execution, or null when absent. */
  getExecution(executionId: string): Promise<StoredExecutionTrace | null>;

  /** List execution ids recorded for an adapter. */
  listAdapterExecutions(adapterId: string): Promise<string[]>;

  /** Build supervised-fine-tuning pairs for an adapter. */
  buildTrainingPairsForAdapter(adapterId: string, includeReward?: boolean): Promise<TrainingPair[]>;

  /** Delete an execution and its traces. */
  deleteExecution(executionId: string): Promise<void>;
}
