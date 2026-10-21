import type { ShellInterpreter } from '../tools/shell-challenge-invocation.js';

export interface AdapterInfo {
  id: string; // Stable adapter identifier (typically the head layer UUID)
  name: string; // Adapter title (H1)
  layer_index: number; // 1-based layer index in the adapter
  layer_count: number; // Total number of layers in the adapter
  protocol_version?: string; // Optional semver carried from frontmatter/train input
  activation_patterns?: string[];
  reward_signal?: string; // Optional trailing Reward Signal markdown section
  /** Slug of the chain entry-point adapter. When set, `activate` collapses this adapter's URI to the root. */
  chain_root?: string;
}

export type InferenceContractType = 'shell' | 'mcp' | 'user_input' | 'comment' | 'subagent';

export interface InferenceContractDefinition {
  type?: InferenceContractType;
  required: boolean;
  // Shell-specific convenience fields retained for older internal helpers.
  cmd?: string;
  timeout_seconds?: number;
  shell?: {
    cmd: string;
    timeout_seconds: number;
    /** Required (ADR 0026): the argv a shell contract runs must be fully specified by the contract. */
    interpreter: ShellInterpreter;
    flags?: string[];
    args?: string[];
    workdir?: string;
  };
  mcp?: {
    tool_name: string;
    /** When set (including `{}`), submission must supply a plain object `solution.mcp.arguments` matching these keys (subset semantics). */
    arguments?: Record<string, unknown>;
    expected_result?: unknown;
  };
  user_input?: {
    prompt?: string;
  };
  comment?: {
    min_length?: number;
  };
  subagent?: {
    context?: string;
  };
}

export interface TensorValue {
  name: string;
  value: unknown;
}

export interface RewardRecord {
  outcome: 'success' | 'failure';
  score?: number;
  signed_score?: number;
  quality_bonus?: number;
  feedback?: string;
  rater?: string;
  rubric_version?: string;
  llm_model_id?: string;
  grader_kind?: 'human' | 'model' | 'unknown';
  evaluation_label?: 'gold' | 'silver' | 'bronze' | 'rejected';
  exportable_for_sft?: boolean;
  exportable_for_preference?: boolean;
  sft_blockers?: string[];
  preference_blockers?: string[];
  rated_at: string;
}

export interface ExecutionTrace {
  execution_id: string;
  adapter_uri: string;
  layer_uri: string;
  layer_index: number;
  created_at: string;
  activation_query?: string;
  layer_instructions?: string;
  tensor_in: Record<string, unknown>;
  tensor_out?: TensorValue;
  trace?: string;
  raw_solution?: unknown;
  reward?: RewardRecord;
  merge_depth?: number;
}

export interface Memory {
  memory_uuid: string;
  /** Qdrant payload space when present (export / adapter scroll scoping). */
  space_id?: string;
  label: string;
  slug?: string;
  tags: string[];
  text: string;
  llm_model_id: string;
  created_at: string;
  content_type?: string;
  artifact?: {
    slug: string;
    version: string;
    name: string;
    sha256: string;
    /** Skill-root-relative path when trained with relative_path (skill export layout). */
    relative_path?: string;
  };
  adapter?: AdapterInfo;
  inference_contract?: InferenceContractDefinition;
}

// Transitional alias kept to reduce churn while the internal codebase moves to adapter terminology.
export type ProofOfWorkType = InferenceContractType;
export type ProofOfWorkDefinition = InferenceContractDefinition;
