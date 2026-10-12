/**
 * CLI Output Utility
 * Uses process.stdout/stderr directly to avoid console.* linting restrictions.
 *
 * Data commands render through {@link emitResult}, which applies the resolved global
 * `--format` (see format.ts): `json` prints the canonical response object, `pretty`
 * prints a human rendering on stdout with the next-call hint on stderr, and `text`
 * prints a minimal plain-text summary. Auth/util commands use the raw writers below.
 */
import type { ResolvedFormat } from './format.js';

export function writeStdout(message: string): void {
    const line = message + '\n';
    if (!process.stdout.write(line)) {
        process.stdout.once('drain', () => {});
    }
}

export function writeStderr(message: string): void {
    process.stderr.write(message + '\n');
}

export function writeError(message: string): void {
    writeStderr(`Error: ${message}`);
}

export function writeJson(data: unknown): void {
    writeStdout(JSON.stringify(data, null, 2));
}

/**
 * Per-command rendering hooks. `pretty`/`text` return stdout bodies; `nextCall` returns
 * a short human hint that pretty mode prints on stderr (JSON mode keeps the structured
 * `next_call` in the body instead, so no hint is emitted there).
 */
export interface ResultView<T> {
    pretty(data: T): string;
    text(data: T): string;
    nextCall?(data: T): string | null;
}

/** Render a command result to stdout/stderr according to the resolved output format. */
export function emitResult<T>(format: ResolvedFormat, data: T, view: ResultView<T>): void {
    if (format === 'json') {
        writeJson(data);
        return;
    }
    if (format === 'text') {
        writeStdout(view.text(data));
        return;
    }
    writeStdout(view.pretty(data));
    const hint = view.nextCall?.(data) ?? null;
    if (hint) writeStderr(hint);
}
