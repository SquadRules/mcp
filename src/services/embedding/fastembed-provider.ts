/**
 * Local fastembed embedding provider (issue #11) — the zero-dependency default.
 *
 * Produces embeddings in-process via ONNX (no API key, no inference service), so
 * simple mode and `npx @squadrules/mcp serve` run fully self-contained. Model
 * weights are fetched on first use by fastembed's own downloader into
 * FASTEMBED_CACHE_DIR (a shared per-user dir). The SDK is imported lazily so the
 * ONNX/tokenizers native bindings load only when fastembed is actually selected
 * (mirroring the embedded LanceDB precedent).
 */
import { logger } from '../../utils/structured-logger.js';
import { FASTEMBED_MODEL, FASTEMBED_CACHE_DIR } from '../../config.js';
import { setResolvedEmbeddingDimension } from './config.js';
import { auditProviderCall } from './provider-audit.js';

/** Lazily-initialised fastembed model instance (memoized at module scope). */
type FastEmbedModel = Awaited<ReturnType<typeof import('fastembed').FlagEmbedding.init>>;
let fastEmbedModelPromise: Promise<FastEmbedModel> | null = null;

/**
 * Initialise fastembed once, downloading the model on first use into
 * FASTEMBED_CACHE_DIR. A failed init clears the memo so a transient first-run
 * error (e.g. a network hiccup during download) can be retried on the next call.
 */
async function getFastEmbedModel(): Promise<FastEmbedModel> {
    if (fastEmbedModelPromise) return fastEmbedModelPromise;
    fastEmbedModelPromise = (async () => {
        const fastembed = await import('fastembed');
        return await fastembed.FlagEmbedding.init({
            model: FASTEMBED_MODEL as Exclude<import('fastembed').EmbeddingModel, import('fastembed').EmbeddingModel.CUSTOM>,
            cacheDir: FASTEMBED_CACHE_DIR,
        });
    })().catch((err) => {
        fastEmbedModelPromise = null;
        throw err;
    });
    return fastEmbedModelPromise;
}

export async function postEmbeddingsFastEmbed(input: string[] | string): Promise<number[][]> {
    const inputArray = Array.isArray(input) ? input : [input];
    const inputCharLength = inputArray.reduce((sum, value) => sum + value.length, 0);
    const startedAt = Date.now();
    try {
        const model = await getFastEmbedModel();
        const embeddings: number[][] = [];
        for await (const batch of model.embed(inputArray)) {
            embeddings.push(...batch);
        }
        if (embeddings.length === 0 || !Array.isArray(embeddings[0])) {
            throw new Error('fastembed returned no embeddings');
        }
        const dim = embeddings[0].length;
        setResolvedEmbeddingDimension(dim);
        auditProviderCall({
            provider: 'fastembed',
            model: FASTEMBED_MODEL,
            status: 'success',
            inputCount: inputArray.length,
            inputCharLength,
            outputDimension: dim,
            latencyMs: Date.now() - startedAt
        });
        logger.debug(`[EmbeddingService] Received ${embeddings.length} embeddings (dim=${dim}) [provider=fastembed]`);
        return embeddings;
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        auditProviderCall({
            provider: 'fastembed',
            model: FASTEMBED_MODEL,
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
