/**
 * CLI `train` command (single file, artifact, fork, or directory batch).
 *
 * Single-file/fork/artifact trains render through the uniform output model. A directory batch
 * is machine-facing: it never dumps adapter/content bytes to stdout, prints a compact per-item
 * summary, and `--format json` emits a manifest of what was stored.
 */

import { Command } from 'commander';
import { statSync } from 'fs';
import { basename, resolve } from 'path';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { emitResult, writeError } from '../output.js';
import { resolveOutputFormat } from '../format.js';
import { renderTrainPretty, renderTrainText } from '../render.js';
import { readMarkdownUploadFromFile } from '../upload-guards.js';
import { createBackendFromProgram } from '../backend/resolve-backend.js';
import type { ReviewEvidence, TrainJsonBody, TrainRawOptions } from '../backend/action-backend.js';
import { inferArtifactMimeFromName } from '../../tools/artifact-mime.js';
import { runTrainBatch, readUtf8RegularFile } from '../train-batch.js';

/** Parse the SQUADRULES_REVIEW_EVIDENCE env blob (integration tests inject critic-loop proof). */
function reviewEvidenceFromEnv(): ReviewEvidence | undefined {
  const raw = process.env['SQUADRULES_REVIEW_EVIDENCE'];
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.verdict_file === 'string' &&
      typeof parsed.exit_code === 'number' &&
      typeof parsed.stdout === 'string'
    ) {
      return parsed as ReviewEvidence;
    }
  } catch { /* ignore malformed env review_evidence */ }
  return undefined;
}

export function trainCliCommand(program: Command): void {
  program
    .command('train')
    .description('Register a new SQUADRULES adapter from markdown, or attach a text artifact to an adapter')
    .argument(
      '[path]',
      'Path to a markdown/artifact file, or a directory of .md files (omit when using --source-adapter-uri)'
    )
    .option('--model <model>', 'LLM model ID for attribution (e.g., "gpt-4", "claude-3")')
    .option('--force', 'Force update if an adapter with the same label already exists')
    .option('--recursive', 'When path is a directory, include nested .md files')
    .option(
      '--source-adapter-uri <uri>',
      'Fork from an existing adapter via POST /api/train (requires --model); optional --space for target space'
    )
    .option('--space <space>', 'Target space for train or fork (personal or group display name)')
    .option('--adapter <uri>', 'Artifact mode: parent adapter URI (squadrules://adapter/{slug})')
    .option('--artifact-name <name>', 'Artifact mode: artifact filename override (defaults to input basename)')
    .option('--mime <mime>', 'Artifact mode: MIME override (otherwise inferred from filename extension)')
    .option('--relative-path <path>', 'Artifact mode: optional skill-root-relative path for export bundles')
    .option('--allow-sensitive-upload', 'Allow uploads that contain token-like or private-key-like text')
    .action(
      async (
        target: string | undefined,
        options: {
          model?: string;
          force?: boolean;
          recursive?: boolean;
          allowSensitiveUpload?: boolean;
          sourceAdapterUri?: string;
          space?: string;
          adapter?: string;
          artifactName?: string;
          mime?: string;
          relativePath?: string;
        }
      ) => {
        try {
          const backend = await createBackendFromProgram(program);
          const format = resolveOutputFormat(program);
          const trainView = { pretty: renderTrainPretty, text: renderTrainText };
          const src = typeof options.sourceAdapterUri === 'string' ? options.sourceAdapterUri.trim() : '';
          if (src.length > 0) {
            if (target) {
              writeError('Do not pass a path when using --source-adapter-uri');
              process.exit(1);
              return;
            }
            const model = options.model?.trim();
            if (!model) {
              writeError('--model is required when using --source-adapter-uri');
              process.exit(1);
              return;
            }
            const spaceOpt = typeof options.space === 'string' ? options.space.trim() : '';
            const response = await backend.trainJson({
              llm_model_id: model,
              force_update: Boolean(options.force),
              source_adapter_uri: src,
              ...(spaceOpt.length > 0 ? { space: spaceOpt } : {})
            });
            emitResult(format, response, trainView);
            return;
          }

          if (!target) {
            writeError('Missing path: provide a markdown file/directory or use --source-adapter-uri');
            process.exit(1);
            return;
          }

          const abs = resolve(target);
          const st = statSync(abs, { throwIfNoEntry: false });
          if (!st) {
            writeError(`File not found: ${target}`);
            process.exit(1);
          }

          const trainOptions: TrainRawOptions = {};
          if (options.model) trainOptions.llmModelId = options.model;
          if (options.force) trainOptions.force = options.force;
          if (typeof options.space === 'string' && options.space.trim().length > 0) {
            trainOptions.space = options.space.trim();
          }
          const envReviewEvidence = reviewEvidenceFromEnv();
          if (envReviewEvidence) trainOptions.reviewEvidence = envReviewEvidence;

          if (st.isDirectory()) {
            await runTrainBatch(backend, abs, options, trainOptions, format);
            return;
          }

          if (!st.isFile()) {
            writeError(`Not a regular file: ${target}`);
            process.exit(1);
          }

          const explicitMime = typeof options.mime === 'string' ? options.mime.trim() : '';
          const inferredFileMime = inferArtifactMimeFromName(basename(abs));
          const hasArtifactFlags =
            typeof options.adapter === 'string' ||
            typeof options.artifactName === 'string' ||
            typeof options.mime === 'string' ||
            typeof options.relativePath === 'string';
          const inferredArtifactByExt =
            explicitMime.length === 0 && inferredFileMime !== null && !abs.toLowerCase().endsWith('.md');
          const isArtifactMode =
            hasArtifactFlags ||
            (explicitMime.length > 0 && explicitMime !== 'text/markdown') ||
            inferredArtifactByExt;

          if (isArtifactMode) {
            const adapterUri = typeof options.adapter === 'string' ? options.adapter.trim() : '';
            if (!adapterUri) {
              writeError('Artifact mode requires --adapter squadrules://adapter/{slug}');
              process.exit(1);
              return;
            }
            const model = options.model?.trim();
            if (!model) {
              writeError('--model is required for artifact mode');
              process.exit(1);
              return;
            }
            const artifactName =
              typeof options.artifactName === 'string' && options.artifactName.trim().length > 0
                ? options.artifactName.trim()
                : basename(abs);
            const artifactMime = explicitMime || inferArtifactMimeFromName(artifactName);
            if (!artifactMime) {
              writeError('Cannot infer artifact MIME from filename; pass --mime explicitly');
              process.exit(1);
              return;
            }
            const content = readUtf8RegularFile(abs);
            const payload: TrainJsonBody = {
              llm_model_id: model,
              content,
              force_update: Boolean(options.force),
              mime: artifactMime,
              artifact_name: artifactName,
              adapter_uri: adapterUri
            };
            if (typeof options.space === 'string' && options.space.trim().length > 0) {
              payload.space = options.space.trim();
            }
            if (typeof options.relativePath === 'string' && options.relativePath.trim().length > 0) {
              payload.relative_path = options.relativePath.trim();
            }
            const response = await backend.trainJson(payload);
            emitResult(format, response, trainView);
            return;
          }

          const markdown = readMarkdownUploadFromFile(abs, 'train', Boolean(options.allowSensitiveUpload));
          const response = await backend.train(markdown, trainOptions);
          emitResult(format, response, trainView);
        } catch (error) {
          const err = error as { code?: string; message?: string };
          if (err.code === 'ENOTREG') {
            writeError(`Not a regular file: ${target}`);
            process.exit(1);
          }
          if (error instanceof Error && error.message.includes('ENOENT')) {
            writeError(`File not found: ${target}`);
            process.exit(1);
          }
          handleApiError(error, !isBrowserDisabled());
        }
      }
    );
}
