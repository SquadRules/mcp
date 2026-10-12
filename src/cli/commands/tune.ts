/**
 * tune command — update one or more adapter layers.
 */

import { Command } from 'commander';
import { handleApiError, isBrowserDisabled } from '../auth-error.js';
import { emitResult, writeError } from '../output.js';
import { resolveOutputFormat } from '../format.js';
import { renderTunePretty, renderTuneText } from '../render.js';
import { readMarkdownUploadFromFile, type SafeMarkdownUpload } from '../upload-guards.js';
import { createBackendFromProgram } from '../backend/resolve-backend.js';
import type { ReviewEvidence, TuneOptions } from '../backend/action-backend.js';

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

export function tuneCommand(program: Command): void {
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
                const backend = await createBackendFromProgram(program);
                const format = resolveOutputFormat(program);
                let markdownDoc: SafeMarkdownUpload[] | undefined;
                let updates: Record<string, unknown> | undefined;
                const rawSpace = typeof options.space === 'string' ? options.space.trim() : '';

                if (rawSpace.length > 0 && !options.file && !options.files && !options.updates) {
                    const response = await backend.tune(uris, { space: rawSpace });
                    emitResult(format, response, { pretty: renderTunePretty, text: renderTuneText });
                    return;
                }

                if (options.files) {
                    if (options.files.length !== uris.length) {
                        writeError('Number of files must match number of URIs');
                        process.exit(1);
                        return;
                    }
                    markdownDoc = options.files.map((file) =>
                        readMarkdownUploadFromFile(file, 'tune', Boolean(options.allowSensitiveUpload))
                    );
                } else if (options.file) {
                    const content = readMarkdownUploadFromFile(
                        options.file,
                        'tune',
                        Boolean(options.allowSensitiveUpload)
                    );
                    markdownDoc = uris.map(() => content);
                } else if (options.updates) {
                    try {
                        updates = JSON.parse(options.updates);
                    } catch {
                        writeError('Invalid JSON in --updates option');
                        process.exit(1);
                        return;
                    }
                } else {
                    writeError('Must provide either --file, --updates, or --space alone for move-only');
                    process.exit(1);
                    return;
                }

                const tuneOpts: TuneOptions = {};
                if (markdownDoc) tuneOpts.markdownDoc = markdownDoc;
                if (updates) tuneOpts.updates = updates;
                if (rawSpace.length > 0) tuneOpts.space = rawSpace;
                const envReviewEvidence = reviewEvidenceFromEnv();
                if (envReviewEvidence) tuneOpts.reviewEvidence = envReviewEvidence;

                const response = await backend.tune(uris, tuneOpts);
                emitResult(format, response, { pretty: renderTunePretty, text: renderTuneText });
            } catch (error) {
                if (error instanceof Error && error.message.includes('ENOENT')) {
                    writeError('File not found');
                    process.exit(1);
                }
                handleApiError(error, !isBrowserDisabled());
            }
        });
}
