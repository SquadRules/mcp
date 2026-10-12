/**
 * Directory-batch `train` support (extracted from cli-train.ts to keep that command file small).
 *
 * A directory batch is machine-facing: it never dumps adapter/content bytes to stdout, prints a
 * compact per-item summary, and `--format json` emits a manifest of what was stored. Each `.md`
 * file is trained as an adapter and any sibling artifacts are attached to it.
 */
import { closeSync, fstatSync, openSync, readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { emitResult, writeError } from './output.js';
import type { ResolvedFormat } from './format.js';
import { readMarkdownUploadFromFile } from './upload-guards.js';
import { inferArtifactMimeFromName } from '../tools/artifact-mime.js';
import type { ActionBackend, TrainRawOptions } from './backend/action-backend.js';

/** Directory batch skips `README.md` (human docs); single-file `train path/to/README.md` still works. */
function isReadmeMarkdownFileName(name: string): boolean {
  return /^readme\.md$/i.test(name);
}

interface SkillFileEntry {
  mdPath: string;
  artifacts: Array<{ absPath: string; name: string; mime: string }>;
}

function listSkillFiles(dir: string, recursive: boolean): SkillFileEntry[] {
  const base = resolve(dir);
  const out: SkillFileEntry[] = [];

  const processDir = (current: string): void => {
    const mdPaths: string[] = [];
    const artifactEntries: Array<{ absPath: string; name: string; mime: string }> = [];

    for (const ent of readdirSync(current, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (recursive) processDir(join(current, ent.name));
      } else if (ent.isFile()) {
        const full = join(current, ent.name);
        if (ent.name.endsWith('.md') && !isReadmeMarkdownFileName(ent.name)) {
          mdPaths.push(full);
        } else {
          const mime = inferArtifactMimeFromName(ent.name);
          if (mime) artifactEntries.push({ absPath: full, name: ent.name, mime });
        }
      }
    }

    for (const mdPath of mdPaths) {
      out.push({ mdPath, artifacts: artifactEntries });
    }
  };

  processDir(base);
  return out.sort((a, b) =>
    relative(base, a.mdPath).localeCompare(relative(base, b.mdPath))
  );
}

export function readUtf8RegularFile(absPath: string): string {
  const fd = openSync(absPath, 'r');
  try {
    if (!fstatSync(fd).isFile()) {
      throw Object.assign(new Error('Path is not a regular file'), { code: 'ENOTREG' });
    }
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

interface BatchArtifactResult {
  path: string;
  ok: boolean;
  status?: string;
  items?: unknown[];
  error?: string;
}

interface BatchItemResult {
  path: string;
  ok: boolean;
  status?: string;
  adapter_uri?: string;
  items?: unknown[];
  error?: string;
  artifacts?: BatchArtifactResult[];
}

interface BatchManifest {
  batch: true;
  root: string;
  total: number;
  ok: number;
  failed: number;
  results: BatchItemResult[];
}

function renderBatchPretty(manifest: BatchManifest): string {
  const lines: string[] = [
    `train batch: ${manifest.root}`,
    `  ${manifest.ok} ok, ${manifest.failed} failed (of ${manifest.total})`
  ];
  for (const row of manifest.results) {
    if (row.ok) {
      lines.push(`  ok  ${row.path}${row.adapter_uri ? ` → ${row.adapter_uri}` : ''}`);
    } else {
      lines.push(`  ERR ${row.path}: ${row.error ?? 'unknown error'}`);
    }
  }
  return lines.join('\n');
}

function renderBatchText(manifest: BatchManifest): string {
  return manifest.results
    .map((row) => `${row.ok ? 'ok' : 'err'}\t${row.path}\t${row.ok ? row.adapter_uri ?? '' : row.error ?? ''}`)
    .join('\n');
}

/** The subset of `train` flags the directory batch path consumes. */
export interface TrainBatchFlags {
  recursive?: boolean;
  allowSensitiveUpload?: boolean;
  force?: boolean;
  model?: string;
  adapter?: string;
  artifactName?: string;
  mime?: string;
  relativePath?: string;
}

/**
 * Train every `.md` file under `abs` (recursively when `--recursive`), attaching sibling artifacts.
 * Emits the batch manifest through the uniform output model. Artifact flags are single-file-only.
 */
export async function runTrainBatch(
  backend: ActionBackend,
  abs: string,
  flags: TrainBatchFlags,
  trainOptions: TrainRawOptions,
  format: ResolvedFormat
): Promise<void> {
  if (
    typeof flags.adapter === 'string' ||
    typeof flags.artifactName === 'string' ||
    typeof flags.mime === 'string' ||
    typeof flags.relativePath === 'string'
  ) {
    writeError('Artifact flags (--adapter/--artifact-name/--mime/--relative-path) are only supported for single-file train');
    process.exit(1);
    return;
  }
  const files = listSkillFiles(abs, Boolean(flags.recursive));
  if (files.length === 0) {
    writeError('No .md files found in directory');
    process.exit(1);
    return;
  }
  const results: BatchItemResult[] = [];
  for (const entry of files) {
    const fp = entry.mdPath;
    const rel = relative(abs, fp).replace(/\\/g, '/');
    try {
      const markdown = readMarkdownUploadFromFile(fp, 'train', Boolean(flags.allowSensitiveUpload));
      const response = await backend.train(markdown, trainOptions);
      const adapterUriValue = (response.items[0] as { adapter_uri?: string } | undefined)?.adapter_uri;
      const resultEntry: BatchItemResult = {
        path: rel,
        ok: true,
        status: response.status,
        ...(adapterUriValue ? { adapter_uri: adapterUriValue } : {}),
        items: response.items
      };

      if (entry.artifacts.length > 0) {
        const model = flags.model?.trim();
        const adapterUri = resultEntry.adapter_uri;
        const artifactResults: BatchArtifactResult[] = [];

        for (const af of entry.artifacts) {
          const afRel = relative(abs, af.absPath).replace(/\\/g, '/');
          if (!model) {
            writeError(`artifact_skipped: ${afRel} — add --model <id> to upload artifacts`);
            continue;
          }
          if (!adapterUri) {
            writeError(`artifact_skipped: ${afRel} — adapter_uri missing (add slug to frontmatter or use --force)`);
            continue;
          }
          try {
            const content = readUtf8RegularFile(af.absPath);
            const ar = await backend.trainJson({
              llm_model_id: model,
              content,
              force_update: Boolean(flags.force),
              mime: af.mime,
              artifact_name: af.name,
              adapter_uri: adapterUri,
              relative_path: afRel,
              ...(trainOptions.space ? { space: trainOptions.space } : {})
            });
            artifactResults.push({ path: afRel, ok: true, status: ar.status, items: ar.items });
          } catch (e) {
            artifactResults.push({ path: afRel, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        if (artifactResults.length > 0) resultEntry.artifacts = artifactResults;
      }

      results.push(resultEntry);
    } catch (e) {
      results.push({
        path: rel,
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }
  const manifest: BatchManifest = {
    batch: true,
    root: abs,
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };
  emitResult(format, manifest, { pretty: renderBatchPretty, text: renderBatchText });
}
