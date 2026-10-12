/**
 * HTTP action backend — drives a remote SquadRules server through {@link ApiClient}.
 * Behavior is identical to the pre-backend CLI: same endpoints, same auth/refresh,
 * same timeout/retry handling. Only the wiring (backend interface) is new.
 */
import { ApiClient } from '../api-client.js';
import type {
  ActionBackend,
  ActivateOptions,
  ExportDownload,
  RewardOptions,
  SpacesOptions,
  SpacesOutput,
  TrainJsonBody,
  TrainRawOptions,
  TuneOptions
} from './action-backend.js';
import type { ActivateOutput } from '../../tools/activate_schema.js';
import type { ForwardOutput } from '../../tools/forward_schema.js';
import type { RewardOutput } from '../../tools/reward_schema.js';
import type { TrainOutput } from '../../tools/train_schema.js';
import type { TuneOutput } from '../../tools/tune_schema.js';
import type { DeleteOutput } from '../../tools/delete_schema.js';
import type { ExportInput, ExportOutput } from '../../tools/export_schema.js';
import type { SafeMarkdownUpload } from '../upload-guards.js';

export class HttpBackend implements ActionBackend {
  readonly kind = 'http' as const;

  constructor(private readonly client: ApiClient) {}

  activate(query: string, options?: ActivateOptions): Promise<ActivateOutput> {
    return this.client.activate(query, options?.space ? { space: options.space } : undefined);
  }

  forward(uri: string, solution?: unknown): Promise<ForwardOutput> {
    return this.client.forward(uri, solution);
  }

  train(markdown: SafeMarkdownUpload, options?: TrainRawOptions): Promise<TrainOutput> {
    return this.client.train(markdown, options);
  }

  trainJson(body: TrainJsonBody): Promise<TrainOutput> {
    return this.client.trainJson(body);
  }

  tune(uris: string[], options?: TuneOptions): Promise<TuneOutput> {
    return this.client.tune(uris, options);
  }

  delete(uris: string[]): Promise<DeleteOutput> {
    return this.client.delete(uris);
  }

  reward(
    uri: string,
    outcome: 'success' | 'failure',
    feedback: string,
    options?: RewardOptions
  ): Promise<RewardOutput> {
    return this.client.reward(uri, outcome, feedback, options);
  }

  spaces(options?: SpacesOptions): Promise<SpacesOutput> {
    return this.client.spaces(options) as Promise<SpacesOutput>;
  }

  export(input: ExportInput): Promise<ExportOutput> {
    return this.client.export(input);
  }

  downloadExportRef(urlOrPath: string): Promise<ExportDownload> {
    return this.client.downloadExportRef(urlOrPath);
  }
}
