// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Helpers for turning opaque undici network failures into actionable messages.
 *
 * undici reports network problems as `TypeError: fetch failed` and stores the real reason on
 * `err.cause` (e.g. ECONNREFUSED / ENOTFOUND / certificate). Surfacing that cause is the whole
 * point — a bare "fetch failed" gives the user nothing to act on.
 */

/**
 * Append undici's underlying `cause` to an opaque "fetch failed" message so the user sees the real
 * reason instead of a bare "fetch failed". Message-only — never alters control flow.
 */
export function describeFetchError(err: unknown): string {
    if (!(err instanceof Error)) return 'network error';
    let detail = err.message || 'network error';
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) {
        const code = (cause as NodeJS.ErrnoException).code;
        const causeText = code ? `${code} ${cause.message}` : cause.message;
        if (causeText && !detail.includes(causeText)) detail = `${detail} (${causeText})`;
    } else if (typeof cause === 'string' && cause && !detail.includes(cause)) {
        detail = `${detail} (${cause})`;
    }
    return detail;
}

/**
 * Build a network Error whose message carries the underlying cause plus a reachability hint, and
 * whose `cause` preserves the original error for programmatic access.
 */
export function networkErrorWithHint(prefix: string, err: unknown): Error {
    const detailed = new Error(
        `${prefix}: ${describeFetchError(err)}. ` +
        `Verify the server is reachable and the URL/port is correct (--url / KAIROS_API_URL).`,
    );
    (detailed as { cause?: unknown }).cause = err;
    return detailed;
}
