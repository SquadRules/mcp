/**
 * Real-inference child for the golden-vector equivalence gate (issue #252).
 *
 * ADR 0004: ONNX must never run inside a Jest vm-realm worker, so the parent
 * test (golden-vectors.test.ts) spawns this script with plain node. It imports
 * the BUILT provider from dist/, embeds the fixed corpus in tests/fixtures/,
 * and prints exactly one JSON document on stdout. Boot/log output is
 * forced to stderr by the parent env (LOG_LEVEL=error, SQUADRULES_LOG_STDERR=1).
 *
 * Output: { provider, modelId, texts, queries, truncationTokenCount, cacheBytes }
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, '../../fixtures/embedding-golden-corpus.json'), 'utf8'));

const cfg = await import(pathToFileURL(join(root, 'dist/config.js')).href);
const { env, AutoTokenizer } = await import('@huggingface/transformers');
env.cacheDir = cfg.TRANSFORMERS_CACHE_DIR;
env.allowRemoteModels = !cfg.TRANSFORMERS_OFFLINE;

const { postEmbeddingsTransformers } = await import(
  pathToFileURL(join(root, 'dist/services/embedding/transformers-provider.js')).href
);

// One batch for all texts (longest-in-batch padding, ADR 0041 D2); queries
// individually, matching the provider call shape consumers use.
const texts = await postEmbeddingsTransformers(corpus.texts);
const queries = {};
for (const query of corpus.queries) {
  const [vector] = await postEmbeddingsTransformers([query.text]);
  queries[query.id] = vector;
}

// Truncation gate (ADR 0041 D4): the 600-word probe must truncate to 512 tokens.
const tokenizer = await AutoTokenizer.from_pretrained(cfg.TRANSFORMERS_MODEL, {
  revision: cfg.TRANSFORMERS_MODEL_REVISION,
});
const encoded = tokenizer(corpus.texts[10], { truncation: true, max_length: 512, padding: false });
const ids = encoded.input_ids ?? encoded;
const truncationTokenCount = ids.dims[ids.dims.length - 1];

/** Recursive on-disk byte size of the model cache (0 when absent). */
function dirBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirBytes(full);
    else {
      try {
        total += statSync(full).size;
      } catch {
        /* raced file; ignore */
      }
    }
  }
  return total;
}

process.stdout.write(JSON.stringify({
  provider: 'transformers',
  modelId: cfg.TRANSFORMERS_MODEL_ID,
  texts,
  queries,
  truncationTokenCount,
  cacheBytes: dirBytes(cfg.TRANSFORMERS_CACHE_DIR),
}));