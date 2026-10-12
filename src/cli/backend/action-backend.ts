/**
 * Transport-agnostic action backend for the CLI.
 *
 * Every data command talks to an `ActionBackend`, never to a transport directly.
 * `HttpBackend` drives a remote server through {@link ApiClient}; `LocalBackend`
 * calls the same `execute*` core the HTTP routes and MCP tools use, against an
 * in-process embedded store. Both return the canonical `src/tools/*` output shapes.
 */
import type { ActivateOutput } from '../../tools/activate_schema.js';
import type { ForwardOutput } from '../../tools/forward_schema.js';
import type { RewardOutput } from '../../tools/reward_schema.js';
import type { TrainOutput } from '../../tools/train_schema.js';
import type { TuneOutput } from '../../tools/tune_schema.js';
import type { DeleteOutput } from '../../tools/delete_schema.js';
import type { ExportInput, ExportOutput } from '../../tools/export_schema.js';
import type { SpaceInfo } from '../../tools/spaces.js';
import type { SafeMarkdownUpload } from '../upload-guards.js';

/** Which transport an {@link ActionBackend} drives. */
export type BackendKind = 'http' | 'local';

/** Canonical spaces listing (same shape the `/api/spaces` route and `executeSpaces` produce). */
export interface SpacesOutput {
  spaces: SpaceInfo[];
}

/** Critic-loop review evidence carried by train/tune. */
export interface ReviewEvidence {
  verdict_file: string;
  exit_code: number;
  stdout: string;
}

/** Options for the raw-markdown `train` path. */
export interface TrainRawOptions {
  llmModelId?: string;
  force?: boolean;
  space?: string;
  reviewEvidence?: ReviewEvidence;
}

/** JSON `train` body (fork from source, or attach an artifact). */
export interface TrainJsonBody {
  llm_model_id: string;
  force_update?: boolean;
  space?: string;
  source_adapter_uri?: string;
  content?: string;
  protocol_version?: string;
  mime?: string;
  artifact_name?: string;
  adapter_uri?: string;
  relative_path?: string;
  review_evidence?: ReviewEvidence;
}

/** Options for `tune`. */
export interface TuneOptions {
  markdownDoc?: SafeMarkdownUpload[];
  updates?: Record<string, unknown>;
  space?: string;
  reviewEvidence?: ReviewEvidence;
}

/** Options for `reward`. */
export interface RewardOptions {
  score?: number;
  rater?: string;
  rubricVersion?: string;
  llmModelId?: string;
}

/** Options for `spaces`. */
export interface SpacesOptions {
  include_adapter_titles?: boolean;
  include_artifacts?: boolean;
}

/** Options for `activate`. */
export interface ActivateOptions {
  space?: string;
}

/** Downloaded export bytes (skill_zip). */
export interface ExportDownload {
  data: Buffer;
  filename?: string;
  contentType?: string;
}

export interface ActionBackend {
  /** Transport this backend drives; commands use it to gate http-only behavior. */
  readonly kind: BackendKind;

  activate(query: string, options?: ActivateOptions): Promise<ActivateOutput>;
  forward(uri: string, solution?: unknown): Promise<ForwardOutput>;
  train(markdown: SafeMarkdownUpload, options?: TrainRawOptions): Promise<TrainOutput>;
  trainJson(body: TrainJsonBody): Promise<TrainOutput>;
  tune(uris: string[], options?: TuneOptions): Promise<TuneOutput>;
  delete(uris: string[]): Promise<DeleteOutput>;
  reward(
    uri: string,
    outcome: 'success' | 'failure',
    feedback: string,
    options?: RewardOptions
  ): Promise<RewardOutput>;
  spaces(options?: SpacesOptions): Promise<SpacesOutput>;
  export(input: ExportInput): Promise<ExportOutput>;

  /**
   * Follow an export `download_ref` (or inline payload) to raw bytes. Only the HTTP
   * backend serves capability download URLs; the local backend returns skill_zip inline,
   * so commands must handle a backend without this method.
   */
  downloadExportRef?(urlOrPath: string): Promise<ExportDownload>;
}
