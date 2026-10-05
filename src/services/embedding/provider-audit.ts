/**
 * Structured audit logging shared by every embedding provider backend.
 *
 * Extracted from `providers.ts` so the HTTP (OpenAI/TEI) and local (fastembed)
 * providers can emit an identical `audit.embedding` record without a circular
 * import, and to keep each provider file under the ESLint max-lines budget.
 */
import { structuredLogger } from '../../utils/structured-logger.js';
import { getRequestIdFromStorage, getTenantId } from '../../utils/tenant-context.js';

export type EmbeddingProviderName = 'openai' | 'tei' | 'fastembed';

export type AuditPayload = {
    provider: EmbeddingProviderName;
    model: string;
    status: 'success' | 'error';
    inputCount: number;
    inputCharLength: number;
    outputDimension: number;
    latencyMs: number;
    httpStatus?: number;
    errorMessage?: string;
};

/** Emit one structured audit line describing a single embedding provider call. */
export function auditProviderCall(payload: AuditPayload): void {
    structuredLogger.info({
        category: 'audit.embedding',
        stage: 'provider',
        provider: payload.provider,
        model: payload.model,
        tenant_id: getTenantId(),
        request_id: getRequestIdFromStorage(),
        status: payload.status,
        input_count: payload.inputCount,
        input_char_length: payload.inputCharLength,
        output_dimension: payload.outputDimension,
        latency_ms: payload.latencyMs,
        ...(payload.httpStatus !== undefined && { http_status: payload.httpStatus }),
        ...(payload.errorMessage && { error_message: payload.errorMessage })
    }, `Embedding provider ${payload.provider} ${payload.status}`);
}
