/**
 * Local action backend — runs commands in-process against the embedded store.
 *
 * Calls the same `execute*` core the HTTP routes and MCP tools use, so local and
 * remote results are identical. There is no MCP SDK client and no HTTP listener:
 * the CLI boots the runtime ({@link bootLocalRuntime}) with fastboot defaults and
 * executes directly. Embeddings load lazily — only `activate`, `train`, and a fresh
 * seed touch the model; read/mutate commands (`forward`, `reward`, `tune` move-only,
 * `delete`, `spaces`, `export`) never load it.
 *
 * Space context: local mode is always auth-disabled, so every call runs inside the
 * single-tenant default context (personal write space + app read space) regardless
 * of any ambient AUTH_ENABLED, matching the plan's local-mode assumption.
 */
import { bootLocalRuntime, type BootedLocalRuntime } from '../../runtime/boot-local-runtime.js';
import { ensureEmbeddingDimension } from '../../services/embedding/lazy-probe.js';
import { MEM_BOOT_FORCE_INJECT } from '../../config/mem-boot.js';
import {
  defaultSpaceContext,
  runWithSpaceContextAsync,
  type SpaceContext
} from '../../utils/tenant-context.js';
import { resolveSpaceParamForContext } from '../../utils/resolve-space-param.js';

import { executeActivate } from '../../tools/activate.js';
import { activateInputSchema, type ActivateOutput } from '../../tools/activate_schema.js';
import { executeForward } from '../../tools/forward.js';
import { forwardInputSchema, type ForwardOutput } from '../../tools/forward_schema.js';
import { executeTrain } from '../../tools/train.js';
import { trainInputSchema, type TrainInput, type TrainOutput } from '../../tools/train_schema.js';
import { TrainError } from '../../tools/train-store.js';
import { executeTune } from '../../tools/tune.js';
import { tuneInputSchema, type TuneOutput } from '../../tools/tune_schema.js';
import { executeDelete } from '../../tools/delete.js';
import { deleteInputSchema, type DeleteOutput } from '../../tools/delete_schema.js';
import { executeReward } from '../../tools/reward.js';
import { rewardInputSchema, type RewardOutput } from '../../tools/reward_schema.js';
import { executeSpaces } from '../../tools/spaces.js';
import { executeExport } from '../../tools/export.js';
import { exportInputSchema, type ExportInput, type ExportOutput } from '../../tools/export_schema.js';

import type { SafeMarkdownUpload } from '../upload-guards.js';
import type {
  ActionBackend,
  ActivateOptions,
  RewardOptions,
  SpacesOptions,
  SpacesOutput,
  TrainJsonBody,
  TrainRawOptions,
  TuneOptions
} from './action-backend.js';

export interface LocalBackendOptions {
  /** Force delete-then-retrain seeding (structural repair). Defaults to MEM_BOOT_FORCE_INJECT. */
  reseed?: boolean;
}

/** Normalize a TrainError message the same way the HTTP raw route does (adapter vocabulary). */
function trainErrorMessage(error: TrainError): string {
  return error.message.replaceAll('Protocol', 'Adapter').replaceAll('protocol', 'adapter');
}

export class LocalBackend implements ActionBackend {
  readonly kind = 'local' as const;

  private constructor(private readonly runtime: BootedLocalRuntime) {}

  /**
   * Boot the embedded runtime with fastboot defaults and return a ready backend.
   * Seeding is automatic-on-empty (`seedAdapters: 'auto'`); embeddings stay lazy.
   */
  static async create(options: LocalBackendOptions = {}): Promise<LocalBackend> {
    const runtime = await bootLocalRuntime({
      seedAdapters: 'auto',
      loadEmbeddings: false,
      healthProbe: false,
      forceSeed: options.reseed ?? MEM_BOOT_FORCE_INJECT
    });
    return new LocalBackend(runtime);
  }

  /** Run an execution inside the single-tenant default space context. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    return runWithSpaceContextAsync(defaultSpaceContext(), fn);
  }

  async activate(query: string, options?: ActivateOptions): Promise<ActivateOutput> {
    await ensureEmbeddingDimension();
    const sp = typeof options?.space === 'string' ? options.space.trim() : '';
    const input = activateInputSchema.parse({ query, ...(sp ? { space: sp } : {}) });
    const { memoryStore, qdrantService } = this.runtime;
    return this.run(() => executeActivate(memoryStore, qdrantService, input));
  }

  async forward(uri: string, solution?: unknown): Promise<ForwardOutput> {
    const input = forwardInputSchema.parse({ uri, ...(solution !== undefined ? { solution } : {}) });
    const { memoryStore, qdrantService } = this.runtime;
    return this.run(() => executeForward(null, memoryStore, qdrantService, input));
  }

  async train(markdown: SafeMarkdownUpload, options?: TrainRawOptions): Promise<TrainOutput> {
    await ensureEmbeddingDimension();
    const sp = typeof options?.space === 'string' ? options.space.trim() : '';
    const bodyInput = {
      content: markdown as string,
      llm_model_id: options?.llmModelId?.trim() || 'cli',
      force_update: Boolean(options?.force),
      ...(sp ? { space: sp } : {}),
      ...(options?.reviewEvidence ? { review_evidence: options.reviewEvidence } : {})
    };
    return this.runTrain(trainInputSchema.parse(bodyInput));
  }

  async trainJson(body: TrainJsonBody): Promise<TrainOutput> {
    await ensureEmbeddingDimension();
    return this.runTrain(trainInputSchema.parse(body));
  }

  /** Mirror the HTTP raw-train space narrowing, then execute inside the narrowed context. */
  private async runTrain(input: TrainInput): Promise<TrainOutput> {
    const { memoryStore, qdrantService } = this.runtime;
    const ctx: SpaceContext = defaultSpaceContext();
    const rawSpace = typeof input.space === 'string' ? input.space.trim() : '';
    let resolvedSpaceId: string;
    if (!rawSpace) {
      resolvedSpaceId = ctx.defaultWriteSpaceId || ctx.allowedSpaceIds[0] || '';
    } else {
      const r = resolveSpaceParamForContext(ctx, rawSpace);
      if (!r.ok) throw new Error(r.message);
      resolvedSpaceId = r.spaceId;
    }
    const narrowedContext = { ...ctx, defaultWriteSpaceId: resolvedSpaceId };
    try {
      return await runWithSpaceContextAsync(narrowedContext, () =>
        executeTrain(memoryStore, input, (fn) => fn(), qdrantService)
      );
    } catch (error) {
      if (error instanceof TrainError) throw new Error(trainErrorMessage(error));
      throw error;
    }
  }

  async tune(uris: string[], options?: TuneOptions): Promise<TuneOutput> {
    // Only content/updates re-embed; a move-only (--space) tune never loads the model.
    const hasContent =
      (Array.isArray(options?.markdownDoc) && options!.markdownDoc!.length > 0) ||
      Boolean(options?.updates);
    if (hasContent) await ensureEmbeddingDimension();
    const input = tuneInputSchema.parse({
      uris,
      ...(options?.markdownDoc ? { content: options.markdownDoc } : {}),
      ...(options?.updates ? { updates: options.updates } : {}),
      ...(options?.space ? { space: options.space } : {}),
      ...(options?.reviewEvidence ? { review_evidence: options.reviewEvidence } : {})
    });
    const { qdrantService } = this.runtime;
    return this.run(() => executeTune(qdrantService, input));
  }

  async delete(uris: string[]): Promise<DeleteOutput> {
    const input = deleteInputSchema.parse({ uris });
    const { qdrantService } = this.runtime;
    return this.run(() => executeDelete(qdrantService, input));
  }

  async reward(
    uri: string,
    outcome: 'success' | 'failure',
    feedback: string,
    options?: RewardOptions
  ): Promise<RewardOutput> {
    const input = rewardInputSchema.parse({
      uri,
      outcome,
      ...(feedback ? { feedback } : {}),
      ...(options?.score !== undefined ? { score: options.score } : {}),
      ...(options?.rater ? { rater: options.rater } : {}),
      ...(options?.rubricVersion ? { rubric_version: options.rubricVersion } : {}),
      ...(options?.llmModelId ? { llm_model_id: options.llmModelId } : {})
    });
    const { qdrantService } = this.runtime;
    return this.run(() => executeReward(qdrantService, input));
  }

  async spaces(options?: SpacesOptions): Promise<SpacesOutput> {
    const includeAdapterTitles = Boolean(options?.include_adapter_titles);
    const includeArtifacts = Boolean(options?.include_artifacts);
    const { memoryStore } = this.runtime;
    return this.run(() =>
      executeSpaces(memoryStore, {
        include_adapter_titles: includeAdapterTitles || includeArtifacts,
        include_artifacts: includeArtifacts
      })
    );
  }

  async export(input: ExportInput): Promise<ExportOutput> {
    const parsed = exportInputSchema.parse(input);
    const { memoryStore, qdrantService } = this.runtime;
    // No download base URL in local mode: skill_zip is returned inline (base64).
    return this.run(() => executeExport(memoryStore, qdrantService, parsed, {}));
  }
}
