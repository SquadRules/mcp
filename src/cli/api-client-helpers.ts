/**
 * Shared constants, option/response shapes, and pure message building for the
 * SQUADRULES CLI API client.
 *
 * Extracted from `api-client.ts` to keep per-file line counts within the
 * ESLint `max-lines` budget; behavior is unchanged.
 */

export const PROACTIVE_REFRESH_SKEW_SEC = 60;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RETRIES = 2;

export interface ApiClientOptions {
    baseUrl?: string | undefined;
    openInBrowser?: boolean | undefined;
    /** Request timeout in milliseconds (default: 15 000). */
    timeoutMs?: number | undefined;
    /** Max retries on transient network errors (default: 2). Set 0 to disable. */
    maxRetries?: number | undefined;
}

export type SpacesOutput = {
    spaces: Array<{
        name: string;
        space_id: string;
        type: 'personal' | 'group' | 'app' | 'other';
        adapter_count: number;
        adapters?: Array<{ adapter_id: string; title: string; layer_count: number; artifacts?: Array<{ name: string; slug: string; uri: string; uuid_uri: string; content_type: string; sha256: string; relative_path: string | null }> }>;
    }>;
};

/** Error payload fields the client reads off non-OK responses. */
export type ApiErrorData = {
    message?: string;
    error?: string;
    login_url?: string;
    available_spaces?: unknown;
};

/**
 * Human-readable failure message for a non-OK response, enriched with the
 * writable-space hint for space-scoping errors.
 */
export function buildApiErrorMessage(
    errorData: ApiErrorData,
    status: number,
    statusText: string
): string {
    let msg = errorData.message || errorData.error || `HTTP ${status}: ${statusText}`;
    if (
        (errorData.error === 'SPACE_NOT_FOUND' || errorData.error === 'SPACE_READ_ONLY') &&
        Array.isArray(errorData.available_spaces)
    ) {
        const availableSpaces = errorData.available_spaces.filter((entry): entry is string => typeof entry === 'string');
        if (availableSpaces.length > 0) {
            msg += `\nAvailable writable spaces: ${availableSpaces.join(', ')}`;
        }
    }
    return msg;
}
