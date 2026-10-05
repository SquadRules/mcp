/**
 * Embedding Service using OpenAI embeddings
 *
 * Implements pure OpenAI embedding support.
 * Uses environment variables:
 *  - OPENAI_API_KEY
 *  - OPENAI_EMBEDDING_MODEL (default text-embedding-3-small)
 *  - Dimension is auto-detected at startup via probeEmbeddingDimension().
 *
 * Supports OpenAI and TEI (Text Embeddings Inference) providers. Selection:
 *  - If OPENAI_API_KEY is set, OpenAI is used.
 *  - Otherwise, TEI_BASE_URL + TEI_MODEL will be used if configured.
 */

import { logger } from '../../utils/structured-logger.js';
import { EMBEDDING_PROVIDER, OPENAI_API_KEY, TEI_BASE_URL, TEI_MODEL, FASTEMBED_MODEL } from '../../config.js';
import { OPENAI_EMBEDDING_MODEL, getResolvedEmbeddingDimension } from './config.js';
import { postEmbeddings } from './providers.js';
import type { EmbeddingResult, BatchEmbeddingResult } from './types.js';
import {
  embeddingRequests,
  embeddingDuration,
  embeddingErrors,
  embeddingVectorSize,
  embeddingBatchSize
} from '../metrics/embedding-metrics.js';
import { getRequestIdFromStorage, getTenantId } from '../../utils/tenant-context.js';
import {
  detectEmbeddingAnomalies,
  logEmbeddingAuditError,
  logEmbeddingAuditSuccess
} from './audit.js';
import { runEmbeddingHealthCheck } from './health.js';

// Re-export types
export type { EmbeddingResult, BatchEmbeddingResult } from './types.js';

export class EmbeddingService {
    private get embeddingDimension(): number {
        return getResolvedEmbeddingDimension();
    }

    private getModelName(provider: 'openai' | 'tei' | 'fastembed'): string {
        if (provider === 'tei') return TEI_MODEL;
        if (provider === 'fastembed') return FASTEMBED_MODEL;
        return OPENAI_EMBEDDING_MODEL;
    }

    async generateEmbedding(text: string): Promise<EmbeddingResult> {
        const tenantId = getTenantId();
        const requestId = getRequestIdFromStorage();
        const provider = this.getProvider();
        const model = this.getModelName(provider);
        const timer = embeddingDuration.startTimer({ provider, tenant_id: tenantId });
        const startedAt = Date.now();
        const normalizedText = text?.trim() || '';
        const inputCharLength = normalizedText.length;
        
        try {
            if (!normalizedText) throw new Error('Text cannot be empty for embedding generation');
            const vectors = await postEmbeddings(normalizedText);
            const embedding = vectors?.[0];
            if (!Array.isArray(embedding)) throw new Error('OpenAI returned no embedding');
            const latencyMs = Date.now() - startedAt;
            const anomaly = detectEmbeddingAnomalies({
                tenantId,
                requestId,
                provider,
                model,
                latencyMs,
                expectedDimension: this.embeddingDimension,
                actualDimension: embedding.length,
                sampleEmbedding: embedding
            });
            if (anomaly.hasCritical) throw new Error(`Embedding dimension mismatch: got ${embedding.length}, expected ${this.embeddingDimension}`);
            
            embeddingRequests.inc({ 
                provider, 
                status: 'success',
                tenant_id: tenantId 
            });
            
            // Track vector size (assuming float32, 4 bytes per float)
            const vectorSize = embedding.length * 4;
            embeddingVectorSize.observe({ provider, tenant_id: tenantId }, vectorSize);
            logEmbeddingAuditSuccess({
                tenantId,
                requestId,
                provider,
                model,
                inputCount: 1,
                inputCharLength,
                outputDimension: embedding.length,
                latencyMs
            });
            
            timer({ provider, tenant_id: tenantId });
            
            return {
                embedding,
                model,
                usage: { prompt_tokens: 0, total_tokens: 0 },
            };
        } catch (error) {
            embeddingRequests.inc({ 
                provider, 
                status: 'error',
                tenant_id: tenantId 
            });
            embeddingErrors.inc({ 
                provider, 
                status: 'error',
                tenant_id: tenantId 
            });
            logEmbeddingAuditError({
                tenantId,
                requestId,
                provider,
                model,
                inputCount: 1,
                inputCharLength,
                outputDimension: 0,
                latencyMs: Date.now() - startedAt,
                errorMessage: error instanceof Error ? error.message : String(error)
            });
            timer({ provider, tenant_id: tenantId });
            throw error;
        }
    }

    async generateBatchEmbeddings(texts: string[]): Promise<BatchEmbeddingResult> {
        const tenantId = getTenantId();
        const requestId = getRequestIdFromStorage();
        const provider = this.getProvider();
        const model = this.getModelName(provider);
        const timer = embeddingDuration.startTimer({ provider, tenant_id: tenantId });
        const startedAt = Date.now();
        let inputCount = 0;
        let inputCharLength = 0;
        
        try {
            const valid = texts.filter(t => t && t.trim().length > 0);
            if (valid.length === 0) throw new Error('No valid texts provided for batch embedding');
            inputCount = valid.length;
            inputCharLength = valid.reduce((sum, value) => sum + value.trim().length, 0);
            
            // Track batch size
            embeddingBatchSize.observe({ tenant_id: tenantId }, valid.length);
            
            const vectors = await postEmbeddings(valid);
            const outputDimension = Array.isArray(vectors[0]) ? vectors[0].length : 0;
            const latencyMs = Date.now() - startedAt;
            const wrongDim = vectors.some(v => !Array.isArray(v) || v.length !== this.embeddingDimension);
            if (wrongDim) logger.error('[EmbeddingService] One or more embeddings returned with unexpected dimension');
            const anomaly = detectEmbeddingAnomalies({
                tenantId,
                requestId,
                provider,
                model,
                latencyMs,
                expectedDimension: this.embeddingDimension,
                actualDimension: wrongDim ? -1 : outputDimension,
                sampleEmbedding: Array.isArray(vectors[0]) ? vectors[0] : []
            });
            if (wrongDim || anomaly.hasCritical) throw new Error('One or more embeddings have unexpected dimension from provider');
            
            embeddingRequests.inc({ 
                provider, 
                status: 'success',
                tenant_id: tenantId 
            });
            
            // Track vector size for each embedding
            for (const embedding of vectors) {
                if (Array.isArray(embedding)) {
                    const vectorSize = embedding.length * 4; // float32 = 4 bytes
                    embeddingVectorSize.observe({ provider, tenant_id: tenantId }, vectorSize);
                }
            }
            logEmbeddingAuditSuccess({
                tenantId,
                requestId,
                provider,
                model,
                inputCount,
                inputCharLength,
                outputDimension,
                latencyMs
            });
            
            timer({ provider, tenant_id: tenantId });
            
            return {
                embeddings: vectors,
                model,
                usage: { prompt_tokens: 0, total_tokens: 0 },
            };
        } catch (error) {
            embeddingRequests.inc({ 
                provider, 
                status: 'error',
                tenant_id: tenantId 
            });
            embeddingErrors.inc({ 
                provider, 
                status: 'error',
                tenant_id: tenantId 
            });
            logEmbeddingAuditError({
                tenantId,
                requestId,
                provider,
                model,
                inputCount,
                inputCharLength,
                outputDimension: 0,
                latencyMs: Date.now() - startedAt,
                errorMessage: error instanceof Error ? error.message : String(error)
            });
            timer({ provider, tenant_id: tenantId });
            throw error;
        }
    }

    calculateCosineSimilarity(embedding1: number[] | undefined, embedding2: number[] | undefined): number {
        if (!embedding1 || !embedding2) return 0;
        if (embedding1.length !== embedding2.length) throw new Error('Embeddings must have the same dimensions');
        let dot = 0, n1 = 0, n2 = 0;
        for (let i = 0; i < embedding1.length; i++) {
            const a = embedding1[i] || 0;
            const b = embedding2[i] || 0;
            dot += a * b; n1 += a * a; n2 += b * b;
        }
        const mag = Math.sqrt(n1) * Math.sqrt(n2);
        return mag === 0 ? 0 : dot / mag;
    }

    async generateMemoryEmbedding(memory: any): Promise<number[]> {
        const textToEmbed = [
            (memory as any)?.content || '',
            `Resource: ${(memory as any)?.resource || ''}`,
            `Task: ${(memory as any)?.task || ''}`,
            `Tags: ${((memory as any)?.tags || []).join(', ')}`,
            `Type: ${(memory as any)?.type || ''}`
        ].filter(text => text.trim().length > 0).join('\n');

        const result = await this.generateEmbedding(textToEmbed);
        return result.embedding;
    }

    estimateCost(): number {
        // Cost estimation could be added later; return 0 for now.
        return 0;
    }

    async healthCheck(): Promise<{ healthy: boolean; message: string }> {
        return runEmbeddingHealthCheck();
    }

    getProvider(): 'openai' | 'tei' | 'fastembed' {
        const pref = EMBEDDING_PROVIDER;
        if (pref === 'openai') return 'openai';
        if (pref === 'tei') return 'tei';
        if (pref === 'fastembed') return 'fastembed';
        if (OPENAI_API_KEY && OPENAI_EMBEDDING_MODEL) return 'openai';
        if (TEI_BASE_URL && TEI_MODEL) return 'tei';
        return 'fastembed'; // local default (no key, no service)
    }

    getConfig() {
        const provider = this.getProvider();

        return {
            model: this.getModelName(provider),
            dimension: this.embeddingDimension,
            provider,
            apiKeyConfigured: !!OPENAI_API_KEY && !!OPENAI_EMBEDDING_MODEL,
            teiConfigured: !!TEI_BASE_URL && !!TEI_MODEL,
            providerPref: EMBEDDING_PROVIDER
        };
    }
}

export const embeddingService = new EmbeddingService();

/** Run one minimal embed to resolve and cache dimension; call at startup before memoryStore.init(). */
export async function probeEmbeddingDimension(): Promise<number> {
    await postEmbeddings('probe');
    return getResolvedEmbeddingDimension();
}
