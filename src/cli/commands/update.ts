/**
 * tune command
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { writeError, writeJson } from '../output.js';
import { readMarkdownUploadFromFile, type SafeMarkdownUpload } from '../upload-guards.js';
import { createClientFromProgram } from '../client-factory.js';

export function updateCommand(program: Command): void {
    program
        .command('tune')
        .description('Update one or more SQUADRULES adapter layers')
        .argument('<uris...>', 'SQUADRULES adapter or layer URIs')
        .option('--file <file>', 'Path to markdown file to apply to all specified URIs')
        .option('--files <files...>', 'Paths to markdown files, one per URI (must match number of URIs)')
        .option('--updates <json>', 'Updates object as JSON string (alternative to --file/--files)')
        .option(
            '--space <space>',
            'Move all layers of each target adapter to this space (e.g. personal or a group name). Use without --file for move-only.'
        )
        .option('--allow-sensitive-upload', 'Allow uploads that contain token-like or private-key-like text')
        .action(async (
            uris: string[],
            options: {
                file?: string;
                files?: string[];
                updates?: string;
                space?: string;
                allowSensitiveUpload?: boolean;
            }
        ) => {
            try {
                const client = createClientFromProgram(program);
                let markdownDoc: SafeMarkdownUpload[] | undefined;
                let updates: Record<string, any> | undefined;
                const rawSpace = typeof options.space === 'string' ? options.space.trim() : '';

                if (rawSpace.length > 0 && !options.file && !options.files && !options.updates) {
                    const response = await client.tune(uris, { space: rawSpace });
                    writeJson(response);
                    return;
                }

                if (options.files) {
                    // Multiple files, one per URI
                    if (options.files.length !== uris.length) {
                        writeError('Number of files must match number of URIs');
                        process.exit(1);
                        return;
                    }
                    markdownDoc = options.files.map((file) =>
                        readMarkdownUploadFromFile(file, 'tune', Boolean(options.allowSensitiveUpload))
                    );
                } else if (options.file) {
                    // Single file for all URIs
                    const content = readMarkdownUploadFromFile(
                        options.file,
                        'tune',
                        Boolean(options.allowSensitiveUpload)
                    );
                    markdownDoc = uris.map(() => content);
                } else if (options.updates) {
                    try {
                        updates = JSON.parse(options.updates);
                    } catch (_e) {
                        writeError('Invalid JSON in --updates option');
                        process.exit(1);
                        return;
                    }
                } else {
                    writeError('Must provide either --file, --updates, or --space alone for move-only');
                    process.exit(1);
                    return;
                }

                const tuneOpts: {
                    markdownDoc?: SafeMarkdownUpload[];
                    updates?: Record<string, unknown>;
                    space?: string;
                    reviewEvidence?: { verdict_file: string; exit_code: number; stdout: string };
                } = {};
                if (markdownDoc) tuneOpts.markdownDoc = markdownDoc;
                if (updates) tuneOpts.updates = updates;
                if (rawSpace.length > 0) tuneOpts.space = rawSpace;
                // Auto-inject review_evidence from env (used by integration tests)
                const envReviewEvidence = process.env['SQUADRULES_REVIEW_EVIDENCE'];
                if (envReviewEvidence) {
                    try {
                        const parsed = JSON.parse(envReviewEvidence);
                        if (parsed && typeof parsed.verdict_file === 'string' && typeof parsed.exit_code === 'number' && typeof parsed.stdout === 'string') {
                            tuneOpts.reviewEvidence = parsed;
                        }
                    } catch { /* ignore malformed env review_evidence */ }
                }
                const response = await client.tune(uris, tuneOpts);
                writeJson(response);
            } catch (error) {
                if (error instanceof Error && error.message.includes('ENOENT')) {
                    writeError('File not found');
                    process.exit(1);
                }
                handleApiError(error, !isBrowserDisabled());
            }
        });
}

