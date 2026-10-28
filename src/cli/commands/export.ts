/**
 * export command — machine-facing bulk export.
 *
 * Export never dumps adapter/content bytes to stdout. Artifacts are written to `--out <dir>`
 * (or `--zip-out <file>` for skill_zip) and the command prints a compact summary. The global
 * `--format json` emits a machine manifest of what was written so an agent can run bulk exports
 * without polluting its context. The content format flag is `--as` (the global `--format` is the
 * output-rendering flag, shared with every other command).
 */
import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import type { ExportInput, ExportOutput } from '../../tools/export_schema.js';
import { emitResult } from '../output.js';
import { resolveOutputFormat } from '../format.js';
import { resolveSkillZipOutputPath, writeExportedSkillZipToFile } from '../skill-zip-local-write.js';
import { createBackendFromProgram } from '../backend/resolve-backend.js';
import type { ActionBackend } from '../backend/action-backend.js';

interface ExportCliOptions {
    as?: string;
    out?: string;
    zipOut?: string;
    to?: string;
    adapters?: string[];
    allAdapters?: boolean;
    space?: string;
}

interface WrittenArtifact {
    path: string;
    bytes: number;
    format: string;
}

function appendRepeatable(value: string, previous?: string[]): string[] {
    return [...(previous ?? []), value];
}

/**
 * Build the same selection union as MCP/HTTP from CLI flags. Mutually exclusive with the
 * positional `<uri>`; passing more (or fewer) than one selection mode is rejected here so the
 * server returns a clean message instead of a Zod parse error.
 */
export function buildExportInput(uri: string | undefined, options: ExportCliOptions): ExportInput {
    const format = (options.as ?? 'skill_zip').trim();
    const trimmedUri = typeof uri === 'string' ? uri.trim() : '';
    const hasUri = trimmedUri.length > 0;
    const hasAdapters = (options.adapters?.length ?? 0) > 0;
    const hasAll = options.allAdapters === true;

    const modes = (hasUri ? 1 : 0) + (hasAdapters ? 1 : 0) + (hasAll ? 1 : 0);
    if (modes === 0) {
        throw new Error(
            'Export requires a selection: <uri> positional, --adapters <uri-or-slug> (repeatable), or --all-adapters --space <name>.'
        );
    }
    if (modes > 1) {
        throw new Error(
            'Choose exactly one selection mode: <uri> positional, --adapters, or --all-adapters. They cannot be combined.'
        );
    }

    if (hasAll) {
        const sn = options.space?.trim() ?? '';
        if (sn.length === 0) {
            throw new Error('--all-adapters requires --space <name>.');
        }
    } else if (options.space !== undefined) {
        throw new Error('--space is only valid with --all-adapters.');
    }

    const baseFormat = format as ExportInput['format'];

    const toFile = (options.to ?? '').trim();
    if (toFile.length > 0) {
        if (!hasUri) {
            throw new Error('--to <file> requires a single <uri> selection.');
        }
        if (baseFormat === 'skill_zip') {
            throw new Error('--to <file> cannot be combined with skill_zip; use --zip-out <file>.');
        }
        if ((options.zipOut ?? '').trim().length > 0) {
            throw new Error('--to <file> cannot be combined with --zip-out.');
        }
        if ((options.out ?? '').trim().length > 0) {
            throw new Error('--to <file> cannot be combined with --out <dir>.');
        }
    }

    if (hasUri) {
        return { uri: trimmedUri, format: baseFormat, include_reward: true };
    }
    if (hasAdapters) {
        return { adapters: options.adapters!, format: baseFormat, include_reward: true };
    }
    return {
        all_adapters: true,
        space_name: options.space!.trim(),
        format: baseFormat,
        include_reward: true
    };
}

function extensionForFormat(format: string): string {
    switch (format) {
        case 'markdown': return 'md';
        case 'skill_zip': return 'zip';
        case 'skill_tree': return 'json';
        case 'trace_jsonl':
        case 'reward_jsonl':
        case 'sft_jsonl':
        case 'preference_jsonl': return 'jsonl';
        default: return 'txt';
    }
}

function sanitizeFileBase(raw: string): string {
    const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
    const clean = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
    return clean || 'export';
}

function baseNameFor(response: ExportOutput): string {
    const name = response.adapter_name?.trim();
    if (name) return sanitizeFileBase(name);
    const match = (response.uri || '').match(/squadrules:\/\/(?:adapter|layer|artifact)\/([^/?]+)/);
    if (match?.[1]) return sanitizeFileBase(match[1]);
    return 'export';
}

function resolveOutDir(out?: string): string {
    const trimmed = (out ?? '').trim();
    return path.resolve(process.cwd(), trimmed.length > 0 ? trimmed : '.');
}

/** Write the export payload to disk and return what was written. Never prints content bytes. */
async function writeExport(
    backend: ActionBackend,
    response: ExportOutput,
    options: ExportCliOptions
): Promise<WrittenArtifact[]> {
    const outDir = resolveOutDir(options.out);

    if (response.format === 'skill_zip') {
        let data: Buffer;
        let filenameHint: string | undefined;
        if (response.download_ref?.url && backend.downloadExportRef) {
            const downloaded = await backend.downloadExportRef(response.download_ref.url);
            data = downloaded.data;
            filenameHint = downloaded.filename ?? response.download_ref.filename;
        } else if (response.content_encoding === 'base64' && response.content.length > 0) {
            data = Buffer.from(response.content, 'base64');
            filenameHint = response.download_ref?.filename;
        } else {
            throw new Error('skill_zip export returned neither a download_ref nor inline base64 content.');
        }
        const zipPath = resolveSkillZipOutputPath(options.zipOut, { downloadBasename: filenameHint }, outDir);
        mkdirSync(path.dirname(zipPath), { recursive: true });
        writeExportedSkillZipToFile(zipPath, data);
        return [{ path: zipPath, bytes: data.length, format: 'skill_zip' }];
    }

    const buf = response.content_encoding === 'base64'
        ? Buffer.from(response.content ?? '', 'base64')
        : Buffer.from(response.content ?? '', 'utf8');

    const toFile = (options.to ?? '').trim();
    if (toFile.length > 0) {
        const targetPath = path.resolve(process.cwd(), toFile);
        mkdirSync(path.dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, buf);
        return [{ path: targetPath, bytes: buf.length, format: response.format }];
    }

    const filePath = path.join(outDir, `${baseNameFor(response)}.${extensionForFormat(response.format)}`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(filePath, buf);
    return [{ path: filePath, bytes: buf.length, format: response.format }];
}

/** Machine manifest of what was written (JSON mode); excludes the raw content bytes. */
function buildManifest(response: ExportOutput, written: WrittenArtifact[]): Record<string, unknown> {
    return {
        uri: response.uri,
        format: response.format,
        content_type: response.content_type,
        adapter_name: response.adapter_name ?? null,
        adapter_version: response.adapter_version ?? null,
        space_name: response.space_name ?? null,
        ...(response.item_count !== undefined ? { item_count: response.item_count } : {}),
        ...(response.export_adapter_count !== undefined ? { export_adapter_count: response.export_adapter_count } : {}),
        ...(response.bundle_sha256 !== undefined ? { bundle_sha256: response.bundle_sha256 } : {}),
        written
    };
}

function buildSummary(response: ExportOutput, written: WrittenArtifact[]): string {
    const lines: string[] = [];
    for (const artifact of written) {
        lines.push(`export: ${artifact.format} → ${artifact.path} (${artifact.bytes} bytes)`);
    }
    if (response.adapter_name) lines.push(`  adapter: ${response.adapter_name}`);
    if (response.export_adapter_count !== undefined) lines.push(`  adapters: ${response.export_adapter_count}`);
    if (response.item_count !== undefined) lines.push(`  items: ${response.item_count}`);
    if (response.bundle_sha256) lines.push(`  sha256: ${response.bundle_sha256}`);
    return lines.join('\n');
}

export function exportCommand(program: Command): void {
    program
        .command('export')
        .description('Export a SQUADRULES adapter (flat markdown, skill zip/tree, training JSONL, or source) to disk')
        .argument('[uri]', 'SQUADRULES adapter or layer URI (single-selection mode)')
        .option(
            '--adapters <uri-or-slug>',
            'Adapter URI or slug (repeat the flag to select multiple)',
            appendRepeatable
        )
        .option('--all-adapters', 'Export every adapter in --space')
        .option('--space <name>', 'Space name (human label, not raw id) — required with --all-adapters')
        .option(
            '--as <format>',
            'export content format: skill_zip (default), markdown, skill_tree, source, trace_jsonl, reward_jsonl, sft_jsonl, preference_jsonl',
            'skill_zip'
        )
        .option('--out <dir>', 'write exported artifact(s) into this directory (default: current directory)')
        .option('--to <file>', 'write the single <uri> payload to this exact file path (any non-skill_zip --as format)')
        .option('--zip-out <file>', 'write skill_zip bytes to this explicit file path')
        .action(
            async (
                uri: string | undefined,
                options: ExportCliOptions
            ) => {
                try {
                    const input = buildExportInput(uri, options);
                    const backend = await createBackendFromProgram(program);
                    const response = await backend.export(input);
                    const written = await writeExport(backend, response, options);
                    const manifest = buildManifest(response, written);
                    emitResult(resolveOutputFormat(program), manifest, {
                        pretty: () => buildSummary(response, written),
                        text: () => written.map((artifact) => artifact.path).join('\n')
                    });
                } catch (error) {
                    handleApiError(error, !isBrowserDisabled());
                }
            }
        );
}
