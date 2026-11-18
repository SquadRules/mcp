/**
 * Unit tests for embedding provider selection (issues #11, #252 — local
 * Transformers.js default, 'fastembed' kept as a deprecated alias).
 *
 * Covers the single selection rule that `postEmbeddings()` and
 * `EmbeddingService.getProvider()`/`getConfig()` must agree on:
 *   explicit EMBEDDING_PROVIDER -> OpenAI (incl. Ollama) -> TEI -> transformers default.
 *
 * The transformers path is exercised with a mocked `@huggingface/transformers`
 * module so the key-free probe is proven end-to-end without a real model download.
 * The mock mirrors the real v4 API shape (verified against the 4.3.2 dist/types):
 * `pipeline('feature-extraction', repo, { revision, dtype })` resolves to a callable
 * extractor; calling it with (texts, { pooling, normalize }) resolves to a Tensor
 * exposing `.type`, `.data` (typed array) and `.dims` ([batch, hidden] after CLS
 * pooling + normalization).
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTestEmbeddingDimension } from '../utils/embedding-test-utils.js';

const EMBEDDING_ENV_KEYS = [
  'EMBEDDING_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_EMBEDDING_MODEL',
  'OPENAI_API_URL',
  'TEI_BASE_URL',
  'TEI_MODEL',
  'TEI_API_KEY',
  'TRANSFORMERS_MODEL',
  'TRANSFORMERS_MODEL_REVISION',
  'TRANSFORMERS_DTYPE',
  'TRANSFORMERS_CACHE_DIR',
  'TRANSFORMERS_OFFLINE',
  'FASTEMBED_MODEL',
  'FASTEMBED_CACHE_DIR',
] as const;

type EnvMap = Partial<Record<(typeof EMBEDDING_ENV_KEYS)[number], string>>;

const savedEnv: Record<string, string | undefined> = {};

const DEFAULT_REPO = 'Xenova/bge-small-en-v1.5';
const PINNED_REVISION = 'ea104dacec62c0de699686887e3f920caeb4f3e3';
/** Model id reported by config/audit: repo + short revision + dtype (ADR 0041 D2; see embedding-transformers.ts). */
const DEFAULT_MODEL_ID = `${DEFAULT_REPO}@${PINNED_REVISION.slice(0, 7)}:fp16`;

function applyEnv(overrides: EnvMap): void {
  for (const key of EMBEDDING_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
}

/** Re-import config + service so module-scope constants recompute from process.env. */
async function freshService() {
  jest.resetModules();
  return await import('../../src/services/embedding/service.js');
}

/**
 * Fresh service with the embedding dimension primed (getConfig() reads it via the
 * `embeddingDimension` getter, which throws until a probe resolves it).
 */
async function freshServiceWithDimension(dim = getTestEmbeddingDimension()) {
  const svc = await freshService();
  const cfgMod = await import('../../src/services/embedding/config.js');
  cfgMod.setResolvedEmbeddingDimension(dim);
  return svc;
}

/**
 * Mock @huggingface/transformers with the real v4 call shape (no native load, no
 * download). Returns recorders for the pipeline() and extractor() calls so tests
 * can assert the pinned revision/dtype and the pooling/normalize options.
 */
function mockTransformers() {
  const pipelineCalls: Array<{ task: string; model: string; options: Record<string, unknown> }> = [];
  const extractorCalls: Array<{ texts: string[]; options: Record<string, unknown> }> = [];
  const env: Record<string, unknown> = {};
  jest.unstable_mockModule('@huggingface/transformers', () => ({
    env,
    pipeline: jest.fn(async (task: string, model: string, options: Record<string, unknown> = {}) => {
      pipelineCalls.push({ task, model, options });
      // The resolved pipeline is itself callable: (texts, options) => Promise<Tensor>.
      return async (texts: string | string[], options: Record<string, unknown> = {}) => {
        const batch = Array.isArray(texts) ? texts : [texts];
        extractorCalls.push({ texts: batch, options });
        const dim = getTestEmbeddingDimension();
        const data = new Float32Array(batch.length * dim);
        for (let i = 0; i < data.length; i++) data[i] = 0.001 * (i % dim);
        return { type: 'float32', data, dims: [batch.length, dim] };
      };
    }),
  }));
  return { pipelineCalls, extractorCalls, env };
}

describe('embedding provider selection (issues #11, #252)', () => {
  beforeEach(() => {
    for (const key of EMBEDDING_ENV_KEYS) {
      if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of EMBEDDING_ENV_KEYS) process.env[key] = savedEnv[key];
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe('getProvider()', () => {
    test('resolves to transformers with zero external configuration (simple mode)', async () => {
      applyEnv({});
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('transformers');
    });

    test("explicit 'fastembed' resolves to transformers (deprecated alias) with a one-time warning", async () => {
      applyEnv({ EMBEDDING_PROVIDER: 'fastembed' });
      const { embeddingService } = await freshService();
      const { logger } = await import('../../src/utils/structured-logger.js');
      const warnSpy = jest.spyOn(logger, 'warn');
      expect(embeddingService.getProvider()).toBe('transformers');
      expect(embeddingService.getProvider()).toBe('transformers');
      const aliasWarnings = warnSpy.mock.calls.filter((call) => String(call[call.length - 1]).includes('deprecated alias'));
      expect(aliasWarnings.length).toBe(1);
      const aliasCall = aliasWarnings[0]!;
      expect(String(aliasCall[aliasCall.length - 1])).toContain('fastembed');
    });

    test('prefers OpenAI when OPENAI_API_KEY is set (additive default — no forced re-index)', async () => {
      applyEnv({ OPENAI_API_KEY: 'sk-test' });
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('openai');
    });

    test('Ollama (OpenAI client at a local URL, no key) still resolves to openai', async () => {
      applyEnv({ OPENAI_API_URL: 'http://localhost:11434/v1' });
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('openai');
    });

    test('falls back to TEI when only TEI is configured', async () => {
      applyEnv({ TEI_BASE_URL: 'http://tei:8080', TEI_MODEL: 'Alibaba-NLP/gte-large-en-v1.5' });
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('tei');
    });

    test('an explicit EMBEDDING_PROVIDER wins over auto-discovery', async () => {
      applyEnv({ OPENAI_API_KEY: 'sk-test', EMBEDDING_PROVIDER: 'transformers' });
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('transformers');
    });
  });

  describe('getConfig()', () => {
    test('reports the shipped Transformers.js default model when TRANSFORMERS_MODEL is unset', async () => {
      applyEnv({});
      const { embeddingService } = await freshServiceWithDimension();
      const cfg = embeddingService.getConfig();
      expect(cfg.provider).toBe('transformers');
      // getModelName must not leak the OpenAI model on the transformers path.
      expect(cfg.model).toBe(DEFAULT_MODEL_ID);
      expect(cfg.apiKeyConfigured).toBe(false);
    });

    test('reports an explicit TRANSFORMERS_MODEL override (repo id + pinned short revision)', async () => {
      applyEnv({ TRANSFORMERS_MODEL: 'org/custom-embed-model' });
      const { embeddingService } = await freshServiceWithDimension();
      const cfg = embeddingService.getConfig();
      expect(cfg.provider).toBe('transformers');
      expect(cfg.model).toBe(`org/custom-embed-model@${PINNED_REVISION.slice(0, 7)}:fp16`);
    });

    test('maps the older FASTEMBED_MODEL default to the Transformers.js default', async () => {
      applyEnv({ FASTEMBED_MODEL: 'fast-bge-small-en-v1.5' });
      const { embeddingService } = await freshServiceWithDimension();
      const cfg = embeddingService.getConfig();
      expect(cfg.provider).toBe('transformers');
      expect(cfg.model).toBe(DEFAULT_MODEL_ID);
    });

    test('rejects an unsupported older FASTEMBED_MODEL value with an actionable error', async () => {
      applyEnv({ FASTEMBED_MODEL: 'fast-bge-base-en-v1.5' });
      let err: unknown;
      try {
        await freshService();
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('fast-bge-base-en-v1.5');
      expect((err as Error).message).toContain('TRANSFORMERS_MODEL');
    });

    test('reports the OpenAI model on the openai path', async () => {
      applyEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small' });
      const { embeddingService } = await freshServiceWithDimension(1536);
      const cfg = embeddingService.getConfig();
      expect(cfg.provider).toBe('openai');
      expect(cfg.model).toBe('text-embedding-3-small');
      expect(cfg.apiKeyConfigured).toBe(true);
    });

    test('deprecated FASTEMBED_* config exports alias the Transformers.js values', async () => {
      applyEnv({});
      jest.resetModules();
      const cfg = await import('../../src/config.js');
      expect(cfg.FASTEMBED_MODEL).toBe(cfg.TRANSFORMERS_MODEL);
      expect(cfg.FASTEMBED_CACHE_DIR).toBe(cfg.TRANSFORMERS_CACHE_DIR);
    });
  });

  describe('probeEmbeddingDimension() with the transformers default (key-free)', () => {
    test('resolves dimension without any API key via the mocked pipeline', async () => {
      applyEnv({});
      jest.resetModules();
      const { pipelineCalls, extractorCalls } = mockTransformers();
      const { probeEmbeddingDimension } = await import('../../src/services/embedding/service.js');
      await expect(probeEmbeddingDimension()).resolves.toBe(384);
      expect(pipelineCalls.length).toBe(1);
      expect(pipelineCalls[0]!.task).toBe('feature-extraction');
      expect(pipelineCalls[0]!.model).toBe(DEFAULT_REPO);
      expect(pipelineCalls[0]!.options).toMatchObject({ revision: PINNED_REVISION, dtype: 'fp16' });
      expect(extractorCalls[0]!.options).toMatchObject({ pooling: 'cls', normalize: true });
    });

    test('honors TRANSFORMERS_DTYPE / TRANSFORMERS_MODEL_REVISION overrides', async () => {
      applyEnv({ TRANSFORMERS_DTYPE: 'q8', TRANSFORMERS_MODEL_REVISION: 'main' });
      jest.resetModules();
      const { pipelineCalls } = mockTransformers();
      const { probeEmbeddingDimension } = await import('../../src/services/embedding/service.js');
      await expect(probeEmbeddingDimension()).resolves.toBe(384);
      expect(pipelineCalls[0]!.options).toMatchObject({ revision: 'main', dtype: 'q8' });
    });

    test('allows remote downloads by default and refuses them when TRANSFORMERS_OFFLINE is set', async () => {
      applyEnv({});
      jest.resetModules();
      const online = mockTransformers();
      const svc = await import('../../src/services/embedding/service.js');
      await expect(svc.probeEmbeddingDimension()).resolves.toBe(384);
      expect(online.env.allowRemoteModels).toBe(true);

      applyEnv({ TRANSFORMERS_OFFLINE: '1' });
      jest.resetModules();
      const offline = mockTransformers();
      const svc2 = await import('../../src/services/embedding/service.js');
      await expect(svc2.probeEmbeddingDimension()).resolves.toBe(384);
      expect(offline.env.allowRemoteModels).toBe(false);
    });

    test('emits a one-time deprecation warning when the older FASTEMBED_MODEL is mapped', async () => {
      applyEnv({ FASTEMBED_MODEL: 'fast-bge-small-en-v1.5' });
      jest.resetModules();
      mockTransformers();
      const { logger } = await import('../../src/utils/structured-logger.js');
      const warnSpy = jest.spyOn(logger, 'warn');
      const { probeEmbeddingDimension } = await import('../../src/services/embedding/service.js');
      await expect(probeEmbeddingDimension()).resolves.toBe(384);
      await probeEmbeddingDimension();
      const priorEnvWarnings = warnSpy.mock.calls.filter((call) => String(call[call.length - 1]).includes('FASTEMBED_MODEL'));
      expect(priorEnvWarnings.length).toBe(1);
      const priorEnvCall = priorEnvWarnings[0]!;
      expect(String(priorEnvCall[priorEnvCall.length - 1])).toContain('deprecated');
    });

    test('chunks large inputs into bounded batches of 64', async () => {
      applyEnv({});
      jest.resetModules();
      const { extractorCalls } = mockTransformers();
      const { postEmbeddings } = await import('../../src/services/embedding/providers.js');
      const texts = Array.from({ length: 130 }, (_, i) => `text ${i}`);
      const vectors = await postEmbeddings(texts);
      expect(vectors.length).toBe(130);
      expect(extractorCalls.map((call) => call.texts.length)).toEqual([64, 64, 2]);
    });
  });
});