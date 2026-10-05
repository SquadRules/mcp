import { logger } from '../../utils/structured-logger.js';
import { OPENAI_API_KEY, EMBEDDING_PROVIDER, TEI_BASE_URL, TEI_MODEL, TEI_API_KEY, EMBEDDING_MAX_RETRIES, EMBEDDING_RETRY_BASE_DELAY_MS, EMBEDDING_RETRY_MAX_DELAY_MS, EMBEDDING_RETRY_AFTER_CAP_MS, EMBEDDING_RETRY_BUDGET_MS } from '../../config.js';
import { OPENAI_EMBEDDING_MODEL, OPENAI_ENDPOINT, TEI_EMBEDDING_ENDPOINT, setResolvedEmbeddingDimension } from './config.js';
import { auditProviderCall } from './provider-audit.js';
import { postEmbeddingsFastEmbed } from './fastembed-provider.js';

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
const RETRIABLE_NETWORK_TOKENS = ['fetch failed', 'timed out', 'econnreset', 'econnrefused', 'enotfound', 'eai_again'];
function isRetriableNetworkError(error: unknown): boolean {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return RETRIABLE_NETWORK_TOKENS.some((t) => msg.includes(t));
}
/** Transient provider HTTP conditions eligible for retry. */
function isRetriableHttpStatus(status: number): boolean { return status === 429 || status === 502 || status === 503 || status === 504; }

/** Typed error for provider rate limiting (429 exhausted or insufficient_quota). */
export class EmbeddingRateLimitError extends Error {
    readonly provider: 'openai' | 'tei';
    readonly httpStatus: number;
    readonly code: string | undefined;
    constructor(provider: 'openai' | 'tei', httpStatus: number, message: string, code?: string) {
        super(message);
        this.name = 'EmbeddingRateLimitError';
        this.provider = provider;
        this.httpStatus = httpStatus;
        this.code = code;
    }
}
/** Parse Retry-After / retry-after-ms headers into ms delay. Returns null when absent. */
export function parseRetryAfterMs(headers: Headers): number | null {
    const msHeader = headers.get('retry-after-ms');
    if (msHeader) {
        const ms = Number(msHeader);
        if (Number.isFinite(ms) && ms > 0) return ms;
    }
    const secondsHeader = headers.get('retry-after');
    if (secondsHeader) {
        const seconds = Number(secondsHeader);
        if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
        const dateMs = Date.parse(secondsHeader);
        if (Number.isFinite(dateMs)) {
            const diff = dateMs - Date.now();
            if (diff > 0) return diff;
        }
    }
    return null;
}
/** Exponential backoff with full jitter, capped at maxDelayMs. */
export function computeBackoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    const exp = baseDelayMs * Math.pow(2, attempt);
    const cap = Math.min(exp, maxDelayMs);
    return Math.floor(Math.random() * cap);
}
/** Resolve retry delay: honors Retry-After (capped) or falls back to exponential backoff+jitter. */
export function computeRetryDelayMs(attempt: number, headers: Headers | undefined): number {
    if (headers) {
        const advised = parseRetryAfterMs(headers);
        if (advised !== null) {
            return Math.min(advised, EMBEDDING_RETRY_AFTER_CAP_MS);
        }
    }
    return computeBackoffMs(attempt, EMBEDDING_RETRY_BASE_DELAY_MS, EMBEDDING_RETRY_MAX_DELAY_MS);
}
/** True when OpenAI 429 is `insufficient_quota` (billing problem, non-transient). */
export function isOpenAiNonRetriableQuota(data: any): boolean {
    const code = data?.error?.code;
    const type = data?.error?.type;
    return code === 'insufficient_quota' || type === 'insufficient_quota';
}
/** True if wall-clock retry budget is exhausted. */
export function isBudgetExceeded(deadline: number): boolean { return Date.now() >= deadline; }
/** Compute a retry deadline from now + budget. */
export function computeDeadline(): number { return Date.now() + EMBEDDING_RETRY_BUDGET_MS; }

async function fetchWithRetries(url: string, init: RequestInit, provider: 'openai' | 'tei', deadline: number): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= EMBEDDING_MAX_RETRIES; attempt++) {
        try {
            return await fetch(url, init);
        } catch (error) {
            lastError = error;
            if (!isRetriableNetworkError(error) || attempt === EMBEDDING_MAX_RETRIES || isBudgetExceeded(deadline)) {
                throw error;
            }
            const delayMs = computeBackoffMs(attempt, EMBEDDING_RETRY_BASE_DELAY_MS, EMBEDDING_RETRY_MAX_DELAY_MS);
            logger.warn(`[EmbeddingService] ${provider} fetch failed (attempt ${attempt + 1}), retrying in ${delayMs}ms: ${error instanceof Error ? error.message : String(error)}`);
            await sleep(delayMs);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
async function postEmbeddingsOpenAI(input: string[] | string): Promise<number[][]> {
    if (!OPENAI_API_KEY || !OPENAI_EMBEDDING_MODEL) throw new Error('OpenAI requires OPENAI_API_KEY and OPENAI_EMBEDDING_MODEL to be configured');
    const inputArray = Array.isArray(input) ? input : [input];
    const inputCharLength = inputArray.reduce((sum, value) => sum + value.length, 0);
    const body = { model: OPENAI_EMBEDDING_MODEL, input: inputArray };
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` };
    let lastFailure = '';
    const deadline = computeDeadline();

    for (let attempt = 0; attempt <= EMBEDDING_MAX_RETRIES; attempt++) {
        const startedAt = Date.now();
        const res = await fetchWithRetries(OPENAI_ENDPOINT, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        }, 'openai', deadline);
        const raw = await res.text();
        let data: any;
        try {
            data = raw.length ? JSON.parse(raw) : {};
        } catch (parseErr) {
            logger.error('[EmbeddingService] Failed to parse OpenAI response as JSON', parseErr);
            lastFailure = `non-JSON body (HTTP ${res.status})`;
            if (isRetriableHttpStatus(res.status) && attempt < EMBEDDING_MAX_RETRIES && !isBudgetExceeded(deadline)) {
                const delayMs = computeRetryDelayMs(attempt, res.headers);
                logger.warn(`[EmbeddingService] OpenAI ${lastFailure}, retrying in ${delayMs}ms`);
                await sleep(delayMs);
                continue;
            }
            throw new Error(`OpenAI embeddings returned non-JSON response (HTTP ${res.status})`);
        }

        if (!res.ok) {
            const errMsg = (data as any)?.error?.message || (data as any)?.message || `OpenAI embeddings HTTP ${res.status}`;
            const errCode = typeof (data as any)?.error?.code === 'string' ? (data as any).error.code : undefined;
            auditProviderCall({
                provider: 'openai',
                model: OPENAI_EMBEDDING_MODEL,
                status: 'error',
                inputCount: inputArray.length,
                inputCharLength,
                outputDimension: 0,
                latencyMs: Date.now() - startedAt,
                httpStatus: res.status,
                errorMessage: errMsg
            });
            if (res.status === 401) throw new Error(`OpenAI authentication failed (401). Check OPENAI_API_KEY: ${errMsg}`);
            // Non-retriable quota (billing problem): fail fast.
            if (res.status === 429 && isOpenAiNonRetriableQuota(data)) {
                throw new EmbeddingRateLimitError(
                    'openai',
                    429,
                    `OpenAI rate limit (429): insufficient quota - add billing/quota to the OpenAI account. ${errMsg}`,
                    errCode ?? 'insufficient_quota'
                );
            }
            lastFailure = errMsg;
            if (isRetriableHttpStatus(res.status) && attempt < EMBEDDING_MAX_RETRIES && !isBudgetExceeded(deadline)) {
                const delayMs = computeRetryDelayMs(attempt, res.headers);
                logger.warn(`[EmbeddingService] OpenAI HTTP ${res.status}: ${errMsg}, retrying in ${delayMs}ms`);
                await sleep(delayMs);
                continue;
            }
            if (res.status === 429) {
                throw new EmbeddingRateLimitError(
                    'openai',
                    429,
                    `OpenAI rate limit (429) after ${attempt + 1} attempt(s): ${errMsg}`,
                    errCode
                );
            }
            throw new Error(`OpenAI embeddings error (HTTP ${res.status}): ${errMsg}`);
        }
        if (!Array.isArray((data as any)?.data)) {
            logger.error('[EmbeddingService] Unexpected OpenAI response shape', data);
            throw new Error('Unexpected OpenAI embeddings response shape');
        }

        const embeddings: number[][] = (data as any).data.map((d: any) => {
            if (!Array.isArray(d?.embedding)) throw new Error('OpenAI returned invalid embedding shape');
            return d.embedding as number[];
        });
        if (embeddings.length > 0 && embeddings[0]) setResolvedEmbeddingDimension(embeddings[0].length);
        const dim = embeddings.length > 0 && embeddings[0] ? embeddings[0].length : 0;
        auditProviderCall({
            provider: 'openai',
            model: OPENAI_EMBEDDING_MODEL,
            status: 'success',
            inputCount: inputArray.length,
            inputCharLength,
            outputDimension: dim,
            latencyMs: Date.now() - startedAt,
            httpStatus: res.status
        });
        logger.debug(`[EmbeddingService] Received ${embeddings.length} embeddings (dim=${dim}) [provider=openai]`);
        return embeddings;
    }
    throw new Error(`OpenAI embeddings failed after ${EMBEDDING_MAX_RETRIES + 1} attempt(s): ${lastFailure || 'unknown'}`);
}
async function postEmbeddingsTEI(input: string[] | string): Promise<number[][]> {
    if (!TEI_BASE_URL || !TEI_MODEL) throw new Error('TEI requires TEI_BASE_URL and TEI_MODEL to be configured');
    const inputArray = Array.isArray(input) ? input : [input];
    const inputCharLength = inputArray.reduce((sum, value) => sum + value.length, 0);
    const body: any = { input: inputArray, model: TEI_MODEL };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (TEI_API_KEY) headers['x-api-key'] = TEI_API_KEY;
    const url = TEI_EMBEDDING_ENDPOINT || TEI_BASE_URL;
    let lastFailure = '';
    const deadline = computeDeadline();

    for (let attempt = 0; attempt <= EMBEDDING_MAX_RETRIES; attempt++) {
        const startedAt = Date.now();
        const res = await fetchWithRetries(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        }, 'tei', deadline);
        let data: any;
        const raw = await res.text();
        try {
            data = raw.length ? JSON.parse(raw) : {};
        } catch (parseErr) {
            logger.error('[EmbeddingService] Failed to parse TEI response as JSON', parseErr);
            lastFailure = `non-JSON body (HTTP ${res.status})`;
            if (isRetriableHttpStatus(res.status) && attempt < EMBEDDING_MAX_RETRIES && !isBudgetExceeded(deadline)) {
                const delayMs = computeRetryDelayMs(attempt, res.headers);
                logger.warn(`[EmbeddingService] TEI ${lastFailure}, retrying in ${delayMs}ms`);
                await sleep(delayMs);
                continue;
            }
            throw new Error(`TEI embeddings returned non-JSON response (HTTP ${res.status})`);
        }
        if (!res.ok) {
            const errRaw = (data as any)?.error?.message ?? (data as any)?.error ?? (data as any)?.message ?? `TEI embeddings HTTP ${res.status}`;
            const errMsg = typeof errRaw === 'string' ? errRaw : JSON.stringify(errRaw);
            auditProviderCall({
                provider: 'tei',
                model: TEI_MODEL,
                status: 'error',
                inputCount: inputArray.length,
                inputCharLength,
                outputDimension: 0,
                latencyMs: Date.now() - startedAt,
                httpStatus: res.status,
                errorMessage: errMsg
            });
            if (res.status === 401) throw new Error('TEI authentication failed (401)');
            lastFailure = errMsg;
            if (isRetriableHttpStatus(res.status) && attempt < EMBEDDING_MAX_RETRIES && !isBudgetExceeded(deadline)) {
                const delayMs = computeRetryDelayMs(attempt, res.headers);
                logger.warn(`[EmbeddingService] TEI HTTP ${res.status}: ${errMsg}, retrying in ${delayMs}ms`);
                await sleep(delayMs);
                continue;
            }
            if (res.status === 429) {
                throw new EmbeddingRateLimitError('tei', 429, `TEI rate limit (429) after ${attempt + 1} attempt(s): ${errMsg}`);
            }
            throw new Error(`TEI embeddings error (HTTP ${res.status}): ${errMsg}`);
        }
        // Different TEI servers return different shapes
        let embeddings: number[][] | null = null;
        if (Array.isArray((data as any)?.embeddings)) {
            embeddings = (data as any).embeddings.map((e: any) => Array.isArray(e) ? e : e?.embedding || e);
        } else if (Array.isArray((data as any)?.data)) {
            embeddings = (data as any).data.map((d: any) => d?.embedding ?? d);
        } else if (Array.isArray((data as any)?.result)) {
            embeddings = (data as any).result;
        } else if (Array.isArray(data)) {
            embeddings = data;
        }
        if (!embeddings || embeddings.length === 0 || !Array.isArray(embeddings[0])) {
            logger.error('[EmbeddingService] TEI returned unexpected embedding shape', data);
            throw new Error('TEI returned unexpected embedding shape');
        }
        const dim = embeddings[0].length;
        setResolvedEmbeddingDimension(dim);
        auditProviderCall({
            provider: 'tei',
            model: TEI_MODEL,
            status: 'success',
            inputCount: inputArray.length,
            inputCharLength,
            outputDimension: dim,
            latencyMs: Date.now() - startedAt,
            httpStatus: res.status
        });
        logger.debug(`[EmbeddingService] Received ${embeddings.length} embeddings (dim=${dim}) [provider=tei]`);
        return embeddings as number[][];
    }
    throw new Error(`TEI embeddings failed after ${EMBEDDING_MAX_RETRIES + 1} attempt(s): ${lastFailure || 'unknown'}`);
}
async function postEmbeddings(input: string[] | string): Promise<number[][]> {
    // Choose provider based on explicit ENV override or auto-discovery
    const providerPref = EMBEDDING_PROVIDER; // 'auto' | 'openai' | 'tei' | 'fastembed'
    if (providerPref === 'openai') {
        if (!OPENAI_API_KEY || !OPENAI_EMBEDDING_MODEL) throw new Error('OpenAI requires OPENAI_API_KEY and OPENAI_EMBEDDING_MODEL to be configured');
        return await postEmbeddingsOpenAI(input);
    }
    if (providerPref === 'tei') {
        if (!TEI_BASE_URL || !TEI_MODEL) throw new Error('TEI requires TEI_BASE_URL and TEI_MODEL to be configured');
        warnTeiDeprecated();
        return await postEmbeddingsTEI(input);
    }
    if (providerPref === 'fastembed') {
        return await postEmbeddingsFastEmbed(input);
    }
    // Auto detection: prefer OpenAI if both OPENAI vars present, otherwise TEI,
    // otherwise fall back to the local fastembed default (no key, no service).
    if (OPENAI_API_KEY && OPENAI_EMBEDDING_MODEL) {
        try {
            return await postEmbeddingsOpenAI(input);
        } catch (err) {
            logger.warn('[EmbeddingService] OpenAI failed, attempting TEI fallback: ' + (err instanceof Error ? err.message : String(err)));
            if (TEI_BASE_URL && TEI_MODEL) {
                warnTeiDeprecated();
                return await postEmbeddingsTEI(input);
            }
            throw err;
        }
    }
    if (TEI_BASE_URL && TEI_MODEL) {
        warnTeiDeprecated();
        return await postEmbeddingsTEI(input);
    }
    return await postEmbeddingsFastEmbed(input);
}

/** One-time (per process) TEI soft-deprecation notice. Removal is a later breaking change. */
let teiDeprecationWarned = false;
function warnTeiDeprecated(): void {
    if (teiDeprecationWarned) return;
    teiDeprecationWarned = true;
    logger.warn('[EmbeddingService] TEI provider is deprecated (issue #11) and will be removed in a future release. OpenAI/Ollama or the local fastembed default are the supported alternatives.');
}

export { postEmbeddings, postEmbeddingsOpenAI, postEmbeddingsTEI, postEmbeddingsFastEmbed };