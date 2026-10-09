import {
  EMBEDDING_LATENCY_WARN_MS,
  EMBEDDING_NORM_MAX,
  EMBEDDING_NORM_MIN,
  SEARCH_SCORE_WARN_THRESHOLD
} from '../../config.js';
import { anomalyEvents } from '../metrics/anomaly-metrics.js';
import { structuredLogger } from '../../utils/structured-logger.js';

export interface EmbeddingAuditPayload {
  tenantId: string;
  requestId: string;
  provider: string;
  model: string;
  inputCount: number;
  inputCharLength: number;
  outputDimension: number;
  latencyMs: number;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function vectorNorm(vector: number[]): number {
  if (vector.length === 0) return 0;
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  return Math.sqrt(sumSquares);
}

function recordAnomaly(params: {
  tenantId: string;
  requestId: string;
  type: string;
  severity: 'warn' | 'error';
  message: string;
  details: Record<string, unknown>;
}): void {
  anomalyEvents.inc({
    type: params.type,
    severity: params.severity,
    tenant_id: params.tenantId
  });
  const bindings = {
    category: 'audit.anomaly',
    anomaly_type: params.type,
    severity: params.severity,
    tenant_id: params.tenantId,
    request_id: params.requestId,
    ...params.details
  };
  if (params.severity === 'error') {
    structuredLogger.error(params.message, undefined, bindings);
    return;
  }
  structuredLogger.warn(bindings, params.message);
}

export function logEmbeddingAuditSuccess(payload: EmbeddingAuditPayload): void {
  structuredLogger.debug({
    category: 'audit.embedding',
    status: 'success',
    tenant_id: payload.tenantId,
    request_id: payload.requestId,
    provider: payload.provider,
    model: payload.model,
    input_count: payload.inputCount,
    input_char_length: payload.inputCharLength,
    output_dimension: payload.outputDimension,
    latency_ms: payload.latencyMs
  }, 'Embedding request completed');
}

export function logEmbeddingAuditError(payload: Omit<EmbeddingAuditPayload, 'outputDimension'> & {
  outputDimension?: number;
  errorMessage: string;
}): void {
  structuredLogger.error('Embedding request failed', undefined, {
    category: 'audit.embedding',
    status: 'error',
    tenant_id: payload.tenantId,
    request_id: payload.requestId,
    provider: payload.provider,
    model: payload.model,
    input_count: payload.inputCount,
    input_char_length: payload.inputCharLength,
    output_dimension: payload.outputDimension ?? 0,
    latency_ms: payload.latencyMs,
    error_message: payload.errorMessage
  });
}

export function detectEmbeddingAnomalies(params: {
  tenantId: string;
  requestId: string;
  provider: string;
  model: string;
  latencyMs: number;
  expectedDimension: number;
  actualDimension: number;
  sampleEmbedding: number[];
}): { hasCritical: boolean } {
  let hasCritical = false;
  if (params.latencyMs > EMBEDDING_LATENCY_WARN_MS) {
    recordAnomaly({
      tenantId: params.tenantId,
      requestId: params.requestId,
      type: 'embedding_high_latency',
      severity: 'warn',
      message: 'Embedding latency exceeded warning threshold',
      details: {
        provider: params.provider,
        model: params.model,
        latency_ms: params.latencyMs,
        threshold_ms: EMBEDDING_LATENCY_WARN_MS
      }
    });
  }

  const norm = vectorNorm(params.sampleEmbedding);
  if (norm < EMBEDDING_NORM_MIN || norm > EMBEDDING_NORM_MAX) {
    recordAnomaly({
      tenantId: params.tenantId,
      requestId: params.requestId,
      type: 'embedding_unusual_norm',
      severity: 'warn',
      message: 'Embedding vector norm is outside expected range',
      details: {
        provider: params.provider,
        model: params.model,
        norm: round(norm),
        min_norm: EMBEDDING_NORM_MIN,
        max_norm: EMBEDDING_NORM_MAX
      }
    });
  }

  if (params.actualDimension !== params.expectedDimension) {
    hasCritical = true;
    recordAnomaly({
      tenantId: params.tenantId,
      requestId: params.requestId,
      type: 'embedding_dimension_mismatch',
      severity: 'error',
      message: 'Embedding dimension mismatch detected',
      details: {
        provider: params.provider,
        model: params.model,
        expected_dimension: params.expectedDimension,
        actual_dimension: params.actualDimension
      }
    });
  }

  return { hasCritical };
}

export function logSearchAnomaly(params: {
  tenantId: string;
  requestId: string;
  resultCount: number;
  queryLength: number;
  topScore: number | null;
}): void {
  if (params.resultCount === 0 && params.queryLength >= 8) {
    recordAnomaly({
      tenantId: params.tenantId,
      requestId: params.requestId,
      type: 'search_zero_results',
      severity: 'warn',
      message: 'Search returned zero results for a non-trivial query',
      details: {
        query_length: params.queryLength,
        result_count: params.resultCount
      }
    });
  }

  if (typeof params.topScore === 'number' && params.queryLength >= 8 && params.topScore < SEARCH_SCORE_WARN_THRESHOLD) {
    recordAnomaly({
      tenantId: params.tenantId,
      requestId: params.requestId,
      type: 'search_low_score',
      severity: 'warn',
      message: 'Search top score is below warning threshold',
      details: {
        query_length: params.queryLength,
        result_count: params.resultCount,
        top_score: round(params.topScore),
        threshold: SEARCH_SCORE_WARN_THRESHOLD
      }
    });
  }
}

