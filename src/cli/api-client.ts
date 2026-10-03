/**
 * API Client for SQUADRULES REST API.
 * Returns canonical response shapes (no metadata wrapper).
 */

import { AuthRequiredError, isBrowserDisabled } from './auth-error.js';
import { getApiUrl } from './config.js';
import { getDefaultApiUrlFromFile, readConfig, writeConfig } from './config-file.js';
import { describeFetchError, networkErrorWithHint } from './fetch-error.js';
import { loginWithBrowser } from './commands/login.js';
import { jwtExpiresInSeconds, refreshAccessToken } from './oauth-refresh.js';
import { rewriteLoginUrlRedirectToApiBase } from './rewrite-login-url.js';
import { normalizeAndValidateApiBaseUrl, type SafeMarkdownUpload } from './upload-guards.js';
import type { ActivateOutput } from '../tools/activate_schema.js';
import type { ForwardOutput } from '../tools/forward_schema.js';
import type { RewardOutput } from '../tools/reward_schema.js';
import type { TrainOutput } from '../tools/train_schema.js';
import type { TuneOutput } from '../tools/tune_schema.js';
import type { ExportInput, ExportOutput } from '../tools/export_schema.js';
import type { DeleteOutput } from '../tools/delete_schema.js';
import { downloadExportRef } from './download-export-ref.js';

const PROACTIVE_REFRESH_SKEW_SEC = 60;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;

export interface ApiClientOptions {
    baseUrl?: string | undefined;
    openInBrowser?: boolean | undefined;
    /** Request timeout in milliseconds (default: 15 000). */
    timeoutMs?: number | undefined;
    /** Max retries on transient network errors (default: 2). Set 0 to disable. */
    maxRetries?: number | undefined;
}

type SpacesOutput = {
    spaces: Array<{
        name: string;
        space_id: string;
        type: 'personal' | 'group' | 'app' | 'other';
        adapter_count: number;
        adapters?: Array<{ adapter_id: string; title: string; layer_count: number; artifacts?: Array<{ name: string; slug: string; uri: string; uuid_uri: string; content_type: string; sha256: string; relative_path: string | null }> }>;
    }>;
};

function isRetryableNetworkError(err: unknown): boolean {
    if (err instanceof Error) {
        if (err.name === 'AbortError') return true;
        const code = (err as NodeJS.ErrnoException).code;
        if (code && ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
            return true;
        }
        if (err.name === 'TypeError' && /fetch|network/i.test(err.message)) return true;
    }
    return false;
}

export class ApiClient {
    private baseUrl: string;
    private openInBrowser: boolean;
    private timeoutMs: number;
    private maxRetries: number;
    /** Coalesces concurrent refresh_token exchanges for this client instance. */
    private refreshInFlight: Promise<boolean> | null = null;

    constructor(baseUrlOrOpts?: string | ApiClientOptions, openInBrowser?: boolean) {
        let opts: ApiClientOptions;
        if (typeof baseUrlOrOpts === 'string' || baseUrlOrOpts === undefined) {
            opts = { baseUrl: baseUrlOrOpts, openInBrowser };
        } else {
            opts = baseUrlOrOpts;
        }
        const explicit = opts.baseUrl?.trim();
        const configUrl = getDefaultApiUrlFromFile();
        const resolvedBaseUrl =
            explicit ||
            (process.env['SQUADRULES_API_URL'] || '').trim() ||
            configUrl ||
            getApiUrl();
        this.baseUrl = normalizeAndValidateApiBaseUrl(resolvedBaseUrl);
        this.openInBrowser = !isBrowserDisabled() && (opts.openInBrowser !== false);
        this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private runRefreshWithSingleflight(refreshToken: string): Promise<boolean> {
        if (this.refreshInFlight) return this.refreshInFlight;
        const p = (async (): Promise<boolean> => {
            try {
                const result = await refreshAccessToken(this.baseUrl, refreshToken);
                if (!result) return false;
                const nextRefresh = result.refresh_token ?? refreshToken;
                await writeConfig({
                    apiUrl: this.baseUrl,
                    bearerToken: result.access_token,
                    refreshToken: nextRefresh,
                });
                return true;
            } catch {
                return false;
            } finally {
                this.refreshInFlight = null;
            }
        })();
        this.refreshInFlight = p;
        return p;
    }

    private async request<T>(
        endpoint: string,
        options: RequestInit = {},
        isRetryAfterLogin = false,
        isRetryAfterRefresh = false,
        preLoginIfTokenMissing = true,
        rateLimitRetryCount = 0
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;
        const defaultHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        let cfg = await readConfig(this.baseUrl);
        let bearer = cfg.bearerToken;
        if (cfg.refreshToken && bearer && !isRetryAfterRefresh) {
            const left = jwtExpiresInSeconds(bearer);
            if (left !== null && left <= PROACTIVE_REFRESH_SKEW_SEC) {
                await this.runRefreshWithSingleflight(cfg.refreshToken);
                cfg = await readConfig(this.baseUrl);
                bearer = cfg.bearerToken;
            }
        }
        if (!bearer && preLoginIfTokenMissing && this.openInBrowser && !isRetryAfterLogin) {
            const ok = await loginWithBrowser(this.baseUrl);
            if (ok) return this.request(endpoint, options, true, false, preLoginIfTokenMissing, rateLimitRetryCount);
        }
        if (bearer) {
            defaultHeaders['Authorization'] = `Bearer ${bearer}`;
        }

        const requestTimeoutMs = this.timeoutMs;
        let lastErr: unknown;
        const maxAttempts = 1 + this.maxRetries;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const ac = new AbortController();
            const timeoutId = setTimeout(() => ac.abort(), requestTimeoutMs);
            let response: Response;
            try {
                response = await fetch(url, {
                    ...options,
                    signal: ac.signal,
                    headers: {
                        ...defaultHeaders,
                        ...(options.headers as Record<string, string> || {}),
                    },
                });
            } catch (err) {
                clearTimeout(timeoutId);
                if (isRetryableNetworkError(err) && attempt < maxAttempts) {
                    const delayMs = Math.min(1000 * 2 ** (attempt - 1), 10_000) + Math.random() * 200;
                    const label = err instanceof Error && err.name === 'AbortError'
                        ? `timed out after ${requestTimeoutMs / 1000}s`
                        : describeFetchError(err);
                    process.stderr.write(
                        `[squadrules] retry ${attempt}/${this.maxRetries}: ${label} — waiting ${(delayMs / 1000).toFixed(1)}s\n`
                    );
                    await this.sleep(delayMs);
                    lastErr = err;
                    continue;
                }
                if (err instanceof Error && err.name === 'AbortError') {
                    throw new Error(`Request to ${url} timed out after ${requestTimeoutMs / 1000}s`);
                }
                if (isRetryableNetworkError(err)) {
                    throw networkErrorWithHint(`Request to ${url} failed`, err);
                }
                throw err;
            }
            clearTimeout(timeoutId);

            if (response.status === 429 && rateLimitRetryCount < 2) {
                const retryAfterSeconds = Number(response.headers.get('Retry-After') ?? '1');
                const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                    ? retryAfterSeconds * 1000
                    : 1000;
                await this.sleep(retryDelayMs);
                return this.request<T>(
                    endpoint,
                    options,
                    isRetryAfterLogin,
                    isRetryAfterRefresh,
                    preLoginIfTokenMissing,
                    rateLimitRetryCount + 1
                );
            }

            const data = await response.json().catch(() => {
                throw new Error(`Failed to parse response from ${url}`);
            });

            if (!response.ok) {
                const errorData = data as {
                    message?: string;
                    error?: string;
                    login_url?: string;
                    available_spaces?: unknown;
                };
                let msg = errorData.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`;
                if (
                    (errorData.error === 'SPACE_NOT_FOUND' || errorData.error === 'SPACE_READ_ONLY') &&
                    Array.isArray(errorData.available_spaces)
                ) {
                    const availableSpaces = errorData.available_spaces.filter((entry): entry is string => typeof entry === 'string');
                    if (availableSpaces.length > 0) {
                        msg += `\nAvailable writable spaces: ${availableSpaces.join(', ')}`;
                    }
                }
                if (response.status === 401) {
                    const cfg401 = await readConfig(this.baseUrl);
                    if (!isRetryAfterRefresh && cfg401.refreshToken) {
                        const refreshed = await this.runRefreshWithSingleflight(cfg401.refreshToken);
                        if (refreshed) {
                            return this.request<T>(
                                endpoint,
                                options,
                                isRetryAfterLogin,
                                true,
                                preLoginIfTokenMissing,
                                rateLimitRetryCount
                            );
                        }
                    }
                    if (this.openInBrowser && !isRetryAfterLogin) {
                        const ok = await loginWithBrowser(this.baseUrl);
                        if (ok) {
                            return this.request<T>(
                                endpoint,
                                options,
                                true,
                                false,
                                preLoginIfTokenMissing,
                                rateLimitRetryCount
                            );
                        }
                    }
                    if (errorData.login_url) {
                        const loginUrl = rewriteLoginUrlRedirectToApiBase(errorData.login_url, this.baseUrl);
                        throw new AuthRequiredError(`${msg}\n\nLog in at:\n${loginUrl}`, loginUrl);
                    }
                    throw new Error(msg);
                }
                throw new Error(msg);
            }

            return data as T;
        }
        throw lastErr instanceof Error
            ? networkErrorWithHint(`Request to ${url} failed after ${maxAttempts} attempts`, lastErr)
            : new Error(`Request to ${url} failed after ${maxAttempts} attempts`);
    }
    async activate(query: string): Promise<ActivateOutput> {
        return this.request<ActivateOutput>('/api/activate', { method: 'POST', body: JSON.stringify({ query }) });
    }

    async forward(uri: string, solution?: unknown): Promise<ForwardOutput> {
        return this.request<ForwardOutput>('/api/forward', { method: 'POST', body: JSON.stringify({ uri, solution }) });
    }

    async train(
        markdown: SafeMarkdownUpload,
        options?: { llmModelId?: string; force?: boolean; space?: string; reviewEvidence?: { verdict_file: string; exit_code: number; stdout: string } },
        isRetryAfterLogin = false
    ): Promise<TrainOutput> {
        const headers: Record<string, string> = { 'Content-Type': 'text/markdown' };
        if (options?.llmModelId) headers['x-llm-model-id'] = options.llmModelId;
        if (options?.force) headers['x-force-update'] = 'true';
        if (typeof options?.space === 'string' && options.space.trim().length > 0) {
            headers['x-space'] = options.space.trim();
        }
        if (options?.reviewEvidence) {
            headers['x-review-evidence'] = JSON.stringify(options.reviewEvidence);
        }
        return this.request<TrainOutput>('/api/train/raw', { method: 'POST', headers, body: markdown }, isRetryAfterLogin, false, false);
    }

    async tune(
        uris: string[],
        opts?: { markdownDoc?: SafeMarkdownUpload[]; updates?: Record<string, unknown>; space?: string; reviewEvidence?: { verdict_file: string; exit_code: number; stdout: string } }
    ): Promise<TuneOutput> {
        const body: Record<string, unknown> = { uris };
        if (opts?.markdownDoc) body['content'] = opts.markdownDoc;
        if (opts?.updates) body['updates'] = opts.updates;
        const sp = typeof opts?.space === 'string' ? opts.space.trim() : '';
        if (sp.length > 0) body['space'] = sp;
        if (opts?.reviewEvidence) body['review_evidence'] = opts.reviewEvidence;
        return this.request<TuneOutput>('/api/tune', { method: 'POST', body: JSON.stringify(body) });
    }

    async trainJson(body: {
        llm_model_id: string;
        force_update?: boolean;
        space?: string;
        source_adapter_uri?: string;
        content?: string;
        protocol_version?: string;
        mime?: string;
        artifact_name?: string;
        adapter_uri?: string;
        relative_path?: string;
        review_evidence?: { verdict_file: string; exit_code: number; stdout: string };
    }): Promise<TrainOutput> {
        return this.request<TrainOutput>('/api/train', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }

    async delete(uris: string[]): Promise<DeleteOutput> {
        return this.request<DeleteOutput>('/api/delete', { method: 'POST', body: JSON.stringify({ uris }) });
    }

    async spaces(options?: { include_adapter_titles?: boolean; include_artifacts?: boolean }): Promise<SpacesOutput> {
        const body: Record<string, unknown> = {};
        if (options?.include_adapter_titles === true) body['include_adapter_titles'] = true;
        if (options?.include_artifacts === true) body['include_artifacts'] = true;
        return this.request<SpacesOutput>('/api/spaces', { method: 'POST', body: JSON.stringify(body) });
    }

    async reward(
        uri: string, outcome: 'success' | 'failure', feedback: string,
        options?: { score?: number; rater?: string; rubricVersion?: string; llmModelId?: string }
    ): Promise<RewardOutput> {
        return this.request<RewardOutput>('/api/reward', {
            method: 'POST',
            body: JSON.stringify({
                uri, outcome, feedback,
                score: options?.score, rater: options?.rater,
                rubric_version: options?.rubricVersion, llm_model_id: options?.llmModelId,
            }),
        });
    }

    async export(input: ExportInput): Promise<ExportOutput> {
        return this.request<ExportOutput>('/api/export', { method: 'POST', body: JSON.stringify(input) });
    }

    async downloadExportRef(urlOrPath: string): Promise<{ data: Buffer; filename?: string; contentType?: string }> {
        return downloadExportRef(this.baseUrl, urlOrPath);
    }
}
