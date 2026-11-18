/**
 * Local Transformers.js embedding provider (issues #11, #252) — the key-free default.
 *
 * Produces embeddings in-process via ONNX (no API key, no inference service) using
 * `@huggingface/transformers`, replacing the archived fastembed runtime, so simple
 * mode and `npx @squadrules/mcp serve` run fully self-contained. Model weights are
 * fetched on first use into TRANSFORMERS_CACHE_DIR (a shared per-user dir) and reused
 * offline afterwards (revision-pinned cache keys). The library is imported lazily so
 * the ONNX native bindings load only when this provider is actually selected
 * (mirroring the embedded LanceDB precedent).
 *
 * Preprocessing parity with shipped fastembed: CLS pooling + L2 normalization, no
 * query/passage prefixes, truncation to 512 tokens. Empty strings pass through to
 * the pipeline unchanged (a [CLS][SEP] unit vector, same as fastembed).
 */
import { logger } from '../../utils/structured-logger.js';
import {
    TRANSFORMERS_MODEL,
    TRANSFORMERS_MODEL_REVISION,
    TRANSFORMERS_DTYPE,
    TRANSFORMERS_CACHE_DIR,
    TRANSFORMERS_MODEL_ID,
    TRANSFORMERS_POOLING,
    TRANSFORMERS_NORMALIZE
} from '../../config.js';
import { getLegacyFastEmbedEnvWarnings } from '../../config/embedding-transformers.js';
import { setResolvedEmbeddingDimension } from './config.js';
import { auditProviderCall } from './provider-audit.js';
import { setSuccessfulProvider } from './provider-resolver.js';
import type { FeatureExtractionPipeline, DataType } from '@huggingface/transformers';

/**
 * Bounded batch size for local inference. Replaces fastembed's internal 256-item
 * generator batching: each batch pads to its longest sequence (up to 512 tokens),
 * so 64 keeps peak activation memory bounded for large input arrays.
 */
const TRANSFORMERS_BATCH_SIZE = 64;

/** Lazily-initialised feature-extraction pipeline (memoized at module scope). */
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let legacyEnvWarned = false;

/**
 * Initialise the pipeline once, downloading the model on first use into
 * TRANSFORMERS_CACHE_DIR. A failed init clears the memo so a transient first-run
 * error (e.g. a network hiccup during download) can be retried on the next call.
 * v4 does not memoize rejected session promises on the Node path, so clearing
 * this memo is sufficient for retry (no in-process poisoning).
 */
async function getTransformersExtractor(): Promise<FeatureExtractionPipeline> {
    if (extractorPromise) return extractorPromise;
    extractorPromise = (async () => {
        if (!legacyEnvWarned) {
            legacyEnvWarned = true;
            for (const warning of getLegacyFastEmbedEnvWarnings()) {
                logger.warn({ category: 'embedding.deprecated-env' }, warning);
            }
        }
        const { env, pipeline } = await import('@huggingface/transformers');
        env.cacheDir = TRANSFORMERS_CACHE_DIR;
        // allowRemoteModels keeps its default (true): download on first use,
        // offline reuse of the revision-pinned cache afterwards.
        return await pipeline('feature-extraction', TRANSFORMERS_MODEL, {
            revision: TRANSFORMERS_MODEL_REVISION,
            dtype: TRANSFORMERS_DTYPE as DataType,
        });
    })().catch((err) => {
        extractorPromise = null;
        throw err;
    });
    return extractorPromise;
}

export async function postEmbeddingsTransformers(input: string[] | string): Promise<number[][]> {
    const inputArray = Array.isArray(input) ? input : [input];
    const inputCharLength = inputArray.reduce((sum, value) => sum + value.length, 0);
    const startedAt = Date.now();
    try {
        const extractor = await getTransformersExtractor();
        const embeddings: number[][] = [];
        for (let start = 0; start < inputArray.length; start += TRANSFORMERS_BATCH_SIZE) {
            const batch = inputArray.slice(start, start + TRANSFORMERS_BATCH_SIZE);
            const tensor = await extractor(batch, {
                pooling: TRANSFORMERS_POOLING,
                normalize: TRANSFORMERS_NORMALIZE,
            });
            const dims = tensor.dims;
            const dim = dims.length === 2 ? dims[1] : undefined;
            if (dim === undefined || dim <= 0 || dims[0] !== batch.length) {
                throw new Error(`transformers returned unexpected embedding shape [${dims.join(', ')}] for ${batch.length} input(s)`);
            }
            // fp16 graphs can surface raw float16 bits as Uint16Array on some runtimes;
            // convert to float32 numbers before reading (a no-op for float32 tensors).
            const data = tensor.type === 'float16' && tensor.data instanceof Uint16Array
                ? tensor.to('float32').data
                : tensor.data;
            for (let i = 0; i < batch.length; i++) {
                embeddings.push(Array.from(data.slice(i * dim, (i + 1) * dim), Number));
            }
        }
        if (embeddings.length === 0 || !Array.isArray(embeddings[0])) {
            throw new Error('transformers returned no embeddings');
        }
        const dim = embeddings[0].length;
        setResolvedEmbeddingDimension(dim);
        setSuccessfulProvider('transformers', TRANSFORMERS_MODEL_ID, dim);
        auditProviderCall({
            provider: 'transformers',
            model: TRANSFORMERS_MODEL_ID,
            status: 'success',
            inputCount: inputArray.length,
            inputCharLength,
            outputDimension: dim,
            latencyMs: Date.now() - startedAt
        });
        logger.debug(`[EmbeddingService] Received ${embeddings.length} embeddings (dim=${dim}) [provider=transformers]`);
        return embeddings;
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        auditProviderCall({
            provider: 'transformers',
            model: TRANSFORMERS_MODEL_ID,
            status: 'error',
            inputCount: inputArray.length,
            inputCharLength,
            outputDimension: 0,
            latencyMs: Date.now() - startedAt,
            errorMessage: errMsg
        });
        throw err;
    }
}