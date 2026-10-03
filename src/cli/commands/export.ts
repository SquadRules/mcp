import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import type { ExportInput } from '../../tools/export_schema.js';
import { writeJson, writeMarkdown, writeStderr } from '../output.js';
import { resolveSkillZipOutputPath, writeExportedSkillZipToFile } from '../skill-zip-local-write.js';
import { createClientFromProgram } from '../client-factory.js';

interface ExportCliOptions {
    format?: string;
    output?: string;
    zipOut?: string;
    adapters?: string[];
    allAdapters?: boolean;
    spaceName?: string;
    jsonOnly?: boolean;
    noDownload?: boolean;
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
    const format = (options.format ?? 'markdown').trim();
    const trimmedUri = typeof uri === 'string' ? uri.trim() : '';
    const hasUri = trimmedUri.length > 0;
    const hasAdapters = (options.adapters?.length ?? 0) > 0;
    const hasAll = options.allAdapters === true;

    const modes = (hasUri ? 1 : 0) + (hasAdapters ? 1 : 0) + (hasAll ? 1 : 0);
    if (modes === 0) {
        throw new Error(
            'Export requires a selection: <uri> positional, --adapters <uri-or-slug> (repeatable), or --all-adapters --space-name <name>.'
        );
    }
    if (modes > 1) {
        throw new Error(
            'Choose exactly one selection mode: <uri> positional, --adapters, or --all-adapters. They cannot be combined.'
        );
    }

    if (hasAll) {
        const sn = options.spaceName?.trim() ?? '';
        if (sn.length === 0) {
            throw new Error('--all-adapters requires --space-name <name>.');
        }
    } else if (options.spaceName !== undefined) {
        throw new Error('--space-name is only valid with --all-adapters.');
    }

    const baseFormat = format as ExportInput['format'];

    if (hasUri) {
        return { uri: trimmedUri, format: baseFormat, include_reward: true };
    }
    if (hasAdapters) {
        return { adapters: options.adapters!, format: baseFormat, include_reward: true };
    }
    return {
        all_adapters: true,
        space_name: options.spaceName!.trim(),
        format: baseFormat,
        include_reward: true
    };
}

export function exportCommand(program: Command): void {
    program
        .command('export')
        .description('Export a SQUADRULES adapter (flat markdown, skill zip/tree, training JSONL, or source)')
        .argument('[uri]', 'SQUADRULES adapter or layer URI (single-selection mode)')
        .option(
            '--adapters <uri-or-slug>',
            'Adapter URI or slug (repeat the flag to select multiple)',
            appendRepeatable
        )
        .option('--all-adapters', 'Export every adapter in --space-name')
        .option('--space-name <name>', 'Space name (human label, not raw id) — required with --all-adapters')
        .option(
            '--format <format>',
            'markdown (flat single-file adapter Markdown), skill_zip, skill_tree, source, trace_jsonl, reward_jsonl, sft_jsonl, preference_jsonl',
            'markdown'
        )
        .option('--output <mode>', 'text to print raw exported content, json to print full response', 'text')
        .option(
            '--zip-out <file>',
            'when format is skill_zip and --output text, write downloaded ZIP bytes to this path'
        )
        .option('--json-only', 'for skill_zip, print JSON response and do not follow download_ref')
        .option('--no-download', 'for skill_zip, do not follow download_ref (alias for --json-only)')
        .action(
            async (
                uri: string | undefined,
                options: ExportCliOptions
            ) => {
                try {
                    const input = buildExportInput(uri, options);
                    const client = createClientFromProgram(program);
                    const response = await client.export(input);
                    if (options.output === 'json' || options.jsonOnly || options.noDownload) {
                        writeJson(response);
                        return;
                    }
                    if (response.format === 'skill_zip' && response.download_ref?.url) {
                        const downloaded = await client.downloadExportRef(response.download_ref.url);
                        const outputPath = resolveSkillZipOutputPath(options.zipOut, {
                            ...(downloaded.filename !== undefined
                                ? { downloadBasename: downloaded.filename }
                                : {}),
                            ...(response.download_ref.filename !== undefined
                                ? { refBasename: response.download_ref.filename }
                                : {})
                        });
                        writeExportedSkillZipToFile(outputPath, downloaded.data);
                        return;
                    }
                    if (
                        response.format === 'skill_zip' &&
                        response.content_encoding === 'base64' &&
                        (options.zipOut || response.content.length > 0)
                    ) {
                        const buf = Buffer.from(response.content, 'base64');
                        const outputPath = resolveSkillZipOutputPath(options.zipOut, {});
                        writeExportedSkillZipToFile(outputPath, buf);
                        return;
                    }
                    if (response.format === 'skill_zip' && response.content_encoding === 'base64') {
                        writeStderr(
                            'skill_zip returned inline binary data but no content was available; use --output json to inspect the response.'
                        );
                        process.exitCode = 1;
                        return;
                    }
                    if (response.format === 'skill_zip') {
                        writeStderr(
                            'skill_zip response did not include download_ref or inline content; use --output json to inspect the response.'
                        );
                        process.exitCode = 1;
                        return;
                    }
                    writeMarkdown(response.content);
                } catch (error) {
                    handleApiError(error, !isBrowserDisabled());
                }
            }
        );
}
