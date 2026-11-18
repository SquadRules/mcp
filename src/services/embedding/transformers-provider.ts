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
import { cpSync, existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { logger } from '../../utils/structured-logger.js';
import {
    TRANSFORMERS_MODEL,
    TRANSFORMERS_MODEL_REVISION,
    TRANSFORMERS_DTYPE,
    TRANSFORMERS_CACHE_DIR,
    TRANSFORMERS_MODEL_ID,
    TRANSFORMERS_POOLING,
    TRANSFORMERS_NORMALIZE,
    TRANSFORMERS_OFFLINE
} from '../../config.js';
import { getPriorFastEmbedEnvWarnings } from '../../config/embedding-transformers.js';
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
let priorEnvWarned = false;

/**
 * Expose the revision-pinned model cache through the flat `<repo>/<file>`
 * layout that `env.localModelPath` expects, and return that layout root.
 *
 * Why this is needed (transformers 4.3.2): the pipeline's tokenizer detection
 * (`get_tokenizer_files` -> `get_file_metadata`) probes file existence with
 * revision 'main' regardless of the pinned revision, so with
 * `env.allowRemoteModels=false` it misses the revision-pinned FileCache keys
 * (`<repo>/<revision>/<file>`) and silently reports "no tokenizer files";
 * `pipeline()` then builds a FeatureExtractionPipeline without a tokenizer
 * ("this.tokenizer is not a function"). The library's documented offline
 * mechanism is `env.localModelPath` (see its env docs and the local branch of
 * hub loadResourceFile), which both the probe and file loading honor. A
 * per-repo directory link points at the pinned cache without duplicating
 * files; a recursive copy is the fallback where symlinks are unsupported.
 */
function prepareOfflineModelLayout(): string {
    const revisionDir = TRANSFORMERS_MODEL_REVISION === 'main'
        ? resolve(TRANSFORMERS_CACHE_DIR, TRANSFORMERS_MODEL)
        : resolve(TRANSFORMERS_CACHE_DIR, TRANSFORMERS_MODEL, TRANSFORMERS_MODEL_REVISION);
    if (TRANSFORMERS_OFFLINE && !existsSync(revisionDir)) {
        throw new Error(
            `TRANSFORMERS_OFFLINE is set but the model cache is not warmed (${revisionDir} is missing). ` +
            `Run once with network access to download ${TRANSFORMERS_MODEL_ID}, then retry offline.`
        );
    }
    const localRoot = join(TRANSFORMERS_CACHE_DIR, 'local');
    const linkPath = join(localRoot, TRANSFORMERS_MODEL);
    mkdirSync(dirname(linkPath), { recursive: true });
    let currentTarget: string | null = null;
    try {
        // Windows junctions may report a \\?\ prefix; normalize before comparing.
        currentTarget = resolve(dirname(linkPath), readlinkSync(linkPath).replace(/^\\\\\?\\/, ''));
    } catch {
        // Not a link yet (missing, or a real directory from the copy fallback).
    }
    if (currentTarget !== revisionDir) {
        rmSync(linkPath, { recursive: true, force: true });
        try {
            symlinkSync(revisionDir, linkPath, 'junction');
        } catch {
            cpSync(revisionDir, linkPath, { recursive: true });
        }
    }
    return localRoot;
}

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
        if (!priorEnvWarned) {
            priorEnvWarned = true;
            for (const warning of getPriorFastEmbedEnvWarnings()) {
                logger.warn({ category: 'embedding.deprecated-env' }, warning);
            }
        }
        const { env, pipeline } = await import('@huggingface/transformers');
        env.cacheDir = TRANSFORMERS_CACHE_DIR;
        // Default (offline unset): download on first use, offline reuse of the
        // revision-pinned cache afterwards. TRANSFORMERS_OFFLINE refuses downloads.
        env.allowRemoteModels = !TRANSFORMERS_OFFLINE;
        if (TRANSFORMERS_OFFLINE) {
            // Must be set before pipeline(): the component-existence probes run
            // during construction (see prepareOfflineModelLayout). Online runs
            // keep the library default so a stale link can never shadow a newly
            // pinned revision on a cache miss.
            env.localModelPath = prepareOfflineModelLayout();
        }
        const extractor = await pipeline('feature-extraction', TRANSFORMERS_MODEL, {
            revision: TRANSFORMERS_MODEL_REVISION,
            dtype: TRANSFORMERS_DTYPE as DataType,
        });
        if (!TRANSFORMERS_OFFLINE) {
            // Warm the offline layout for later air-gapped runs. Best-effort:
            // a failure here must not break online embedding, but offline reuse
            // would then fail loudly on its next init.
            try {
                prepareOfflineModelLayout();
            } catch (err) {
                logger.warn(
                    { category: 'embedding.offline-layout' },
                    `Could not prepare the offline model layout: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }
        return extractor;
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